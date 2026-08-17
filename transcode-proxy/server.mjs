import http from 'node:http'
import { spawn } from 'node:child_process'
import { URL } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = Number(process.env.PORT) || 8787
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'iptvworld.xyz')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE_PATH = process.env.FFPROBE_PATH || FFMPEG_PATH.replace(/ffmpeg(\.exe)?$/i, (m, ext) => 'ffprobe' + (ext ?? ''))
const H264_ENCODER = process.env.H264_ENCODER || 'libx264'
const H264_PRESET = process.env.H264_PRESET || 'ultrafast'
const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128'
const VAAPI_QP = process.env.VAAPI_QP || '23'
const FFMPEG_LOGLEVEL = process.env.FFMPEG_LOGLEVEL || 'warning'
const VIDEO_MAX_WIDTH = Number(process.env.VIDEO_MAX_WIDTH) || 1280
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '1500k'
const VIDEO_MAX_BITRATE = process.env.VIDEO_MAX_BITRATE || '2000k'
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '128k'
const SUB_CACHE_DIR = process.env.SUB_CACHE_DIR || path.join(os.tmpdir(), 'streamforest-subs')
const SUB_CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS) || 7 * 24 * 60 * 60 * 1000
const EPG_CACHE_DIR = process.env.EPG_CACHE_DIR || path.join(os.tmpdir(), 'streamforest-epg')
const EPG_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const TMDB_CACHE_DIR = process.env.TMDB_CACHE_DIR || path.join(os.tmpdir(), 'streamforest-tmdb')
const TMDB_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000  // 90 days
const CLIENT_LOG_FILE = process.env.CLIENT_LOG_FILE || path.join(os.tmpdir(), 'streamforest-client.log')
const CLIENT_LOG_MAX_BYTES = Number(process.env.CLIENT_LOG_MAX_BYTES) || 8 * 1024 * 1024  // 8 MB, then rotate
// Shared secret for GET /clientlog. Unset = reads are refused outright; the log
// carries device fingerprints and viewing activity, so it must never be public.
const CLIENT_LOG_TOKEN = process.env.CLIENT_LOG_TOKEN || ''

const HLS_DIR = path.join(os.tmpdir(), 'streamforest-hls')

fs.mkdirSync(SUB_CACHE_DIR, { recursive: true })
fs.mkdirSync(EPG_CACHE_DIR, { recursive: true })
fs.mkdirSync(TMDB_CACHE_DIR, { recursive: true })
fs.mkdirSync(HLS_DIR, { recursive: true })

// iOS HLS generation sessions: hash → { proc, dir, lastAccess, live }
const hlsSessions = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [hash, sess] of hlsSessions.entries()) {
    if (now - sess.lastAccess > 2 * 60_000) {
      try { sess.proc?.kill() } catch {}
      hlsSessions.delete(hash)
      fs.rmSync(sess.dir, { recursive: true, force: true })
      process.stderr.write(`[hls] cleanup ${hash.slice(0, 8)}\n`)
    }
  }
}, 60_000).unref()

// Active transcode registry.
// key: sha1(url|seekBucket)
// value: { ff, subtitleStreams: Map<index, SubStream>, alive }
// SubStream: { chunks: Buffer[], ended: bool, readers: Set<ServerResponse> }
const activeTranscodes = new Map()

function hostAllowed(targetUrl) {
  return ALLOWED_HOSTS.some((h) => targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h))
}

function parseTargetUrl(reqUrl, res) {
  const target = reqUrl.searchParams.get('url')
  if (!target) {
    res.writeHead(400).end('Missing url')
    return null
  }
  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    res.writeHead(400).end('Invalid url')
    return null
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    res.writeHead(400).end('Only http/https allowed')
    return null
  }
  if (!hostAllowed(targetUrl)) {
    process.stderr.write(`[host-blocked] ${targetUrl.hostname} — allowed: ${ALLOWED_HOSTS.join(',')}\n`)
    res.writeHead(403).end(`Host not allowed: ${targetUrl.hostname}`)
    return null
  }
  return target
}

function handleTranscode(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const startParam = Number(reqUrl.searchParams.get('start') || 0)
  const start = Number.isFinite(startParam) && startParam > 0 ? startParam : 0
  const audioParam = reqUrl.searchParams.get('audio')
  const audioIdx = audioParam !== null && /^\d+$/.test(audioParam) ? Number(audioParam) : null
  const mode = reqUrl.searchParams.get('mode') === 'copy' ? 'copy' : 'transcode'
  const live = reqUrl.searchParams.get('live') === '1'

  const subsParam = reqUrl.searchParams.get('subs')
  const subtitleIndices = (!live && subsParam)
    ? subsParam.split(',').map(Number).filter(n => Number.isInteger(n) && n >= 0)
    : []

  const vstartParam = Number(reqUrl.searchParams.get('vstart') || 0)
  const vstart = Number.isFinite(vstartParam) && vstartParam > 0.01 ? vstartParam : 0

  const seekBucket = start > 0 ? Math.floor(start / 300) * 300 : 0
  const transKey = createHash('sha1').update(`${target}|${seekBucket}`).digest('hex')

  const args = ['-hide_banner', '-loglevel', FFMPEG_LOGLEVEL]
  if (live) {
    args.push('-fflags', '+genpts+discardcorrupt')
  }
  if (start > 0 && !live) {
    args.push('-ss', String(mode === 'transcode' ? Math.max(0, start - 5) : start))
  }
  if (vstart > 0 && !live) {
    args.push('-itsoffset', String(-vstart))
  }
  if (H264_ENCODER === 'h264_vaapi' && mode === 'transcode') {
    args.push('-vaapi_device', VAAPI_DEVICE)
  }
  args.push('-i', target,
    '-map', '0:v:0',
    '-map', audioIdx !== null ? `0:${audioIdx}` : '0:a:0?',
  )
  if (start > 0 && !live && mode === 'transcode') args.push('-ss', String(start))

  if (mode === 'copy') {
    // faststart requires a seekable output and doesn't work on pipe:1 — omit it.
    // aac_adtstoasc converts ADTS-framed AAC (common in MPEG-TS) to the ASC format
    // required by MP4; safe to apply even when the source already uses ASC.
    args.push(
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', 'frag_keyframe+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    )
  } else if (H264_ENCODER === 'h264_vaapi') {
    args.push(
      '-c:v', 'h264_vaapi',
      '-vf', `scale='min(iw,${VIDEO_MAX_WIDTH})':-2,format=nv12,hwupload`,
      '-qp', VAAPI_QP,
      '-c:a', 'aac',
      '-b:a', AUDIO_BITRATE,
      '-ac', '2',
      '-movflags', 'frag_keyframe+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    )
  } else {
    args.push(
      '-c:v', H264_ENCODER,
      '-preset', H264_PRESET,
      '-tune', 'zerolatency',
      '-vf', `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`,
      '-b:v', VIDEO_BITRATE,
      '-maxrate', VIDEO_MAX_BITRATE,
      '-bufsize', `${parseInt(VIDEO_MAX_BITRATE) * 2}k`,
      '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'aac',
      '-b:a', AUDIO_BITRATE,
      '-ac', '2',
      '-movflags', 'frag_keyframe+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    )
  }

  // Co-extract subtitle streams to additional stdio pipes (pipe:3, pipe:4, ...).
  // Pipes flush immediately as ffmpeg encodes — no buffering delay like file outputs.
  const subtitlePipeEntries = [] // 'pipe' for each subtitle track → appended to stdio array
  for (let i = 0; i < subtitleIndices.length; i++) {
    const idx = subtitleIndices[i]
    const pipeN = 3 + i
    subtitlePipeEntries.push('pipe')
    args.push('-map', `0:${idx}?`, '-copyts', '-c:s', 'webvtt', '-f', 'webvtt', `pipe:${pipeN}`)
  }

  // Build in-memory subtitle stream buffers, registered BEFORE spawn so a
  // /subtitle request arriving during the race window still finds the entry.
  const subtitleStreams = new Map()
  if (subtitleIndices.length > 0) {
    for (const idx of subtitleIndices) {
      subtitleStreams.set(idx, { chunks: [], ended: false, readers: new Set() })
    }
    activeTranscodes.set(transKey, { ff: null, subtitleStreams, alive: true })
    process.stderr.write(
      `[transcode] co-extracting subs indices=[${subtitleIndices}] transKey=${transKey.slice(0, 8)} start=${start}\n`,
    )
  }

  const ff = spawn(FFMPEG_PATH, args, {
    stdio: ['ignore', 'pipe', 'pipe', ...subtitlePipeEntries],
  })

  if (subtitleIndices.length > 0) {
    const entry = activeTranscodes.get(transKey)
    entry.ff = ff

    for (let i = 0; i < subtitleIndices.length; i++) {
      const idx = subtitleIndices[i]
      const pipeStream = ff.stdio[3 + i]
      const stream = subtitleStreams.get(idx)

      pipeStream.on('data', (chunk) => {
        stream.chunks.push(chunk)
        for (const r of stream.readers) {
          try { r.write(chunk) } catch { stream.readers.delete(r) }
        }
      })

      const endStream = () => {
        stream.ended = true
        for (const r of stream.readers) {
          try { r.end() } catch {}
        }
        stream.readers.clear()
      }

      pipeStream.on('end', endStream)
      pipeStream.on('error', endStream)
    }
  }

  let headersSent = false
  let sawStderrError = false

  // First-byte timeout: if ffmpeg never produces output (upstream stream hangs or
  // is unreachable), Cloudflare Tunnel's own ~30 s timeout would fire first and
  // return a 502 without CORS headers. Kill ffmpeg ourselves and return a proper
  // error before that happens — mirroring the same fix applied to /probe.
  const firstByteTimeout = setTimeout(() => {
    if (!headersSent) {
      ff.kill('SIGKILL')
      headersSent = true
      res.writeHead(504, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'stream timeout — upstream did not respond' }))
    }
  }, 20000)

  ff.stderr.on('data', (chunk) => {
    const line = chunk.toString()
    process.stderr.write(line)
    if (/Server returned|No such file|Invalid data|could not find/i.test(line)) {
      sawStderrError = true
    }
  })

  ff.stdout.once('data', (chunk) => {
    clearTimeout(firstByteTimeout)
    if (headersSent) return
    headersSent = true
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
    })
    res.write(chunk)
    ff.stdout.pipe(res)
  })

  ff.on('error', (err) => {
    clearTimeout(firstByteTimeout)
    console.error('ffmpeg spawn error:', err)
    if (!headersSent) {
      headersSent = true
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`ffmpeg spawn failed: ${err.message}`)
    } else {
      res.destroy()
    }
  })

  ff.on('exit', (code, signal) => {
    clearTimeout(firstByteTimeout)
    if (!headersSent) {
      headersSent = true
      const msg = sawStderrError ? 'Upstream fetch failed' : `ffmpeg exited ${code ?? signal}`
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(msg)
    }
    if (code !== 0 && signal !== 'SIGKILL') {
      console.error('ffmpeg exit', { code, signal })
    }
    if (subtitleIndices.length > 0) {
      const entry = activeTranscodes.get(transKey)
      if (entry) {
        entry.alive = false
        if (code === 0) {
          // Promote accumulated subtitle buffers to permanent cache.
          for (const [idx, stream] of entry.subtitleStreams) {
            if (stream.chunks.length > 0) {
              const cacheFile = subCachePath(target, idx, vstart, seekBucket)
              try { fs.writeFileSync(cacheFile, Buffer.concat(stream.chunks)) } catch {}
            }
          }
        }
        setTimeout(() => activeTranscodes.delete(transKey), 15_000)
      }
    }
  })

  const cleanup = () => {
    if (!ff.killed) ff.kill('SIGKILL')
    if (subtitleIndices.length > 0) {
      const entry = activeTranscodes.get(transKey)
      if (entry) {
        entry.alive = false
        for (const stream of entry.subtitleStreams.values()) {
          stream.ended = true
          for (const r of stream.readers) { try { r.end() } catch {} }
          stream.readers.clear()
        }
        activeTranscodes.delete(transKey)
      }
    }
  }
  res.on('close', cleanup)
}

const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'])

function handleProbe(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-show_entries', 'format=duration,start_time:stream=index,codec_type,codec_name,channels:stream_tags=language,title',
    '-of', 'json',
    target,
  ]
  const ff = spawn(FFPROBE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  ff.stdout.on('data', (c) => { out += c.toString() })
  ff.stderr.on('data', (c) => { err += c.toString() })

  const probeTimeout = setTimeout(() => {
    ff.kill('SIGKILL')
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'probe timeout' }))
    }
  }, 20000)

  ff.on('error', (e) => {
    clearTimeout(probeTimeout)
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }))
  })

  ff.on('exit', (code) => {
    clearTimeout(probeTimeout)
    if (code !== 0) {
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err || `ffprobe exit ${code}` }))
      return
    }
    try {
      const parsed = JSON.parse(out)
      const duration = Number(parsed?.format?.duration)
      const rawStart = Number(parsed?.format?.start_time)
      const startTime = Number.isFinite(rawStart) && rawStart > 0.01 ? rawStart : 0
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
      const audio = streams.find((s) => s.codec_type === 'audio')
      const video = streams.find((s) => s.codec_type === 'video')
      const audioStreams = streams
        .filter((s) => s.codec_type === 'audio')
        .map((s) => ({
          index: s.index,
          codec: s.codec_name ?? null,
          channels: typeof s.channels === 'number' ? s.channels : null,
          lang: s.tags?.language ?? null,
          title: s.tags?.title ?? null,
        }))
      const subtitleStreams = streams
        .filter((s) => s.codec_type === 'subtitle' && TEXT_SUB_CODECS.has((s.codec_name ?? '').toLowerCase()))
        .map((s) => ({
          index: s.index,
          codec: s.codec_name ?? null,
          lang: s.tags?.language ?? null,
          title: s.tags?.title ?? null,
        }))
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      }).end(JSON.stringify({
        duration: Number.isFinite(duration) ? duration : null,
        startTime,
        audioCodec: audio?.codec_name ?? null,
        videoCodec: video?.codec_name ?? null,
        audioStreams,
        subtitleStreams,
      }))
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'bad ffprobe output' }))
    }
  })

  res.on('close', () => {
    if (!ff.killed) ff.kill('SIGKILL')
  })
}

// Return the actual I-frame (keyframe) time at or just before `start`.
// Used by the client to correct playbackOffset after a copy-mode seek, because
// -ss snaps to the nearest keyframe K ≤ start, causing subtitle drift of start-K.
function handleKeyframe(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return
  const startParam = Number(reqUrl.searchParams.get('start') || 0)
  const start = Number.isFinite(startParam) && startParam > 0 ? startParam : 0

  if (start === 0) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      .end(JSON.stringify({ keyframe: 0 }))
    return
  }

  const lookback = Math.max(0, start - 10)
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'packet=pts_time,flags',
    '-read_intervals', `${lookback.toFixed(3)}%${(start + 0.5).toFixed(3)}`,
    '-of', 'json',
    target,
  ]

  const ff = spawn(FFPROBE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''

  const timeout = setTimeout(() => {
    ff.kill('SIGKILL')
    process.stderr.write(`[keyframe] timeout start=${start} — falling back\n`)
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keyframe: start }))
    }
  }, 8000)

  ff.stdout.on('data', d => { out += d.toString() })

  ff.on('error', () => {
    clearTimeout(timeout)
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keyframe: start }))
    }
  })

  ff.on('exit', () => {
    clearTimeout(timeout)
    if (res.headersSent) return
    try {
      const data = JSON.parse(out)
      const candidates = (data?.packets ?? [])
        .filter(p => typeof p.pts_time === 'string' && p.flags?.includes('K'))
        .map(p => Number(p.pts_time))
        .filter(t => Number.isFinite(t) && t <= start + 0.1)
      const keyframe = candidates.length > 0 ? candidates[candidates.length - 1] : start
      process.stderr.write(`[keyframe] start=${start} → keyframe=${keyframe.toFixed(3)} (${candidates.length} candidates)\n`)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' })
        .end(JSON.stringify({ keyframe }))
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keyframe: start }))
    }
  })

  res.on('close', () => {
    clearTimeout(timeout)
    if (!ff.killed) ff.kill('SIGKILL')
  })
}

function subCachePath(url, index, vstart, seekBucket) {
  const hash = createHash('sha1').update(`${url}|${index}|${vstart}|${seekBucket}`).digest('hex')
  return path.join(SUB_CACHE_DIR, `${hash}.vtt`)
}

function serveCachedSubtitle(file, res, source) {
  res.writeHead(200, {
    'Content-Type': 'text/vtt; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
    'X-Sub-Cache': source,
  })
  fs.createReadStream(file).pipe(res)
}

// Stream subtitle data from an active co-extraction pipe buffer.
// Immediately sends all buffered chunks, then subscribes for future data.
function streamFromSubtitleBuffer(stream, res) {
  res.writeHead(200, {
    'Content-Type': 'text/vtt; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Sub-Cache': 'PIPE',
  })

  for (const chunk of stream.chunks) {
    res.write(chunk)
  }

  if (stream.ended) {
    res.end()
    return
  }

  stream.readers.add(res)
  res.on('close', () => stream.readers.delete(res))
}

function handleSubtitle(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const indexParam = reqUrl.searchParams.get('index')
  if (indexParam === null || !/^\d+$/.test(indexParam)) {
    res.writeHead(400).end('Missing or invalid index')
    return
  }
  const index = Number(indexParam)
  const vstartParam = Number(reqUrl.searchParams.get('vstart') || 0)
  const vstart = Number.isFinite(vstartParam) && vstartParam > 0 ? vstartParam : 0
  const startParam = Number(reqUrl.searchParams.get('start') || 0)
  const start = Number.isFinite(startParam) && startParam > 0 ? startParam : 0
  const seekBucket = start > 0 ? Math.floor(start / 300) * 300 : 0
  const seekTo = start > 0 ? Math.max(0, start - 5) : 0
  const cacheFile = subCachePath(target, index, vstart, seekBucket)

  // 1. Permanent cache hit.
  try {
    const stat = fs.statSync(cacheFile)
    if (Date.now() - stat.mtimeMs < SUB_CACHE_TTL_MS) {
      process.stderr.write(`[subtitle] cache HIT index=${index} bucket=${seekBucket} size=${stat.size} age=${Math.round((Date.now()-stat.mtimeMs)/60000)}min\n`)
      serveCachedSubtitle(cacheFile, res, 'HIT')
      return
    }
    process.stderr.write(`[subtitle] cache EXPIRED index=${index} bucket=${seekBucket} — re-extracting\n`)
    fs.unlinkSync(cacheFile)
  } catch { /* ENOENT */ }

  // 2. Active co-extraction pipe — stream directly from the in-memory buffer.
  //    On seek, the subtitle request may arrive before the new transcode registers.
  //    Poll for up to 3 s before falling back to standalone ffmpeg.
  const transKey = createHash('sha1').update(`${target}|${seekBucket}`).digest('hex')
  let cancelled = false
  res.on('close', () => { cancelled = true })

  const tryFollowOrFallback = (retriesLeft) => {
    if (cancelled) return
    const activeEntry = activeTranscodes.get(transKey)
    if (activeEntry && activeEntry.subtitleStreams?.has(index)) {
      process.stderr.write(`[subtitle] PIPE active transcode index=${index} transKey=${transKey.slice(0, 8)}\n`)
      streamFromSubtitleBuffer(activeEntry.subtitleStreams.get(index), res)
      return
    }
    if (retriesLeft > 0) {
      setTimeout(() => tryFollowOrFallback(retriesLeft - 1), 200)
      return
    }
    // 3. Fallback: standalone extraction (only when no video transcode is competing).
    process.stderr.write(`[subtitle] FALLBACK standalone index=${index} bucket=${seekBucket}\n`)
    startStandaloneSubtitle(target, index, vstart, seekTo, seekBucket, cacheFile, res)
  }

  tryFollowOrFallback(15)
}

function startStandaloneSubtitle(target, index, vstart, seekTo, seekBucket, cacheFile, res) {
  const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
  const args = ['-hide_banner', '-loglevel', 'error']
  if (seekTo > 0) args.push('-ss', String(seekTo))
  if (vstart > 0) args.push('-itsoffset', String(-vstart))
  args.push(
    '-i', target,
    '-copyts',
    '-map', `0:${index}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    'pipe:1',
  )

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const startedAt = Date.now()
  process.stderr.write(`[subtitle] start index=${index} bucket=${seekBucket} seekTo=${seekTo} vstart=${vstart} url=${target.slice(0, 80)}\n`)
  const writer = fs.createWriteStream(tmpFile)
  let headersSent = false
  let stderrBuf = ''
  let clientAlive = true
  let lastFfmpegOutputAt = Date.now()
  let bytesFromFfmpeg = 0

  res.on('close', () => {
    clientAlive = false
    if (!ff.killed) ff.kill('SIGKILL')
  })

  ff.stderr.on('data', (c) => { stderrBuf += c.toString() })

  const keepaliveTimer = setInterval(() => {
    if (!clientAlive || !headersSent) return
    if (Date.now() - lastFfmpegOutputAt >= 20_000) {
      res.write('\nNOTE\n\n')
      lastFfmpegOutputAt = Date.now()
    }
  }, 5_000)

  ff.stdout.on('data', (chunk) => {
    lastFfmpegOutputAt = Date.now()
    bytesFromFfmpeg += chunk.length
    writer.write(chunk)
    if (!headersSent) {
      headersSent = true
      res.writeHead(200, {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Sub-Cache': 'STREAM',
      })
    }
    if (clientAlive) res.write(chunk)
  })

  ff.on('error', (e) => {
    clearInterval(keepaliveTimer)
    writer.end(() => { try { fs.unlinkSync(tmpFile) } catch {} })
    if (clientAlive && !headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`ffmpeg spawn failed: ${e.message}`)
    } else if (clientAlive) {
      res.end()
    }
  })

  ff.on('exit', (code) => {
    clearInterval(keepaliveTimer)
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    process.stderr.write(`[subtitle] exit code=${code} elapsed=${elapsed}s bytes=${bytesFromFfmpeg} bucket=${seekBucket} stderr=${stderrBuf.slice(0, 200).replace(/\n/g, ' ')}\n`)
    writer.end(() => {
      if (code === 0) {
        try { fs.renameSync(tmpFile, cacheFile) } catch {}
      } else {
        try { fs.unlinkSync(tmpFile) } catch {}
      }
    })
    if (!clientAlive) return
    if (code === 0) {
      res.end()
    } else if (!headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(stderrBuf || `ffmpeg exit ${code}`)
    } else {
      res.end()
    }
  })
}

// ── EPG proxy + disk cache ─────────────────────────────────────────────────────

function epgCachePaths(cacheKey) {
  return {
    xml:  path.join(EPG_CACHE_DIR, `${cacheKey}.xml`),
    meta: path.join(EPG_CACHE_DIR, `${cacheKey}.meta.json`),
  }
}

async function fetchAndCacheEpg(target, cacheKey) {
  const { xml: cacheFile, meta: metaFile } = epgCachePaths(cacheKey)
  const tmpFile = `${cacheFile}.tmp`
  process.stderr.write(`[epg] fetching ${target}\n`)
  const upstream = await fetch(target, { headers: { 'User-Agent': 'StreamForest/1.0' } })
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`)
  const writer = fs.createWriteStream(tmpFile)
  const reader = upstream.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    writer.write(Buffer.from(value))
  }
  await new Promise((resolve, reject) => writer.end((err) => err ? reject(err) : resolve()))
  fs.renameSync(tmpFile, cacheFile)
  fs.writeFileSync(metaFile, JSON.stringify({ fetchedAt: Date.now(), url: target }))
  process.stderr.write(`[epg] cached ${cacheKey.slice(0, 8)} (${fs.statSync(cacheFile).size} bytes)\n`)
}

async function handleEpg(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return
  const force = reqUrl.searchParams.get('force') === '1'
  const cacheKey = createHash('sha1').update(target).digest('hex')
  const { xml: cacheFile, meta: metaFile } = epgCachePaths(cacheKey)

  let cacheHit = false
  if (!force) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
      if (Date.now() - meta.fetchedAt < EPG_CACHE_TTL_MS && fs.existsSync(cacheFile)) cacheHit = true
    } catch {}
  }

  if (!cacheHit) {
    try {
      await fetchAndCacheEpg(target, cacheKey)
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`EPG fetch failed: ${err.message}`)
      return
    }
  }

  process.stderr.write(`[epg] serving from ${cacheHit ? 'cache' : 'fresh'}: ${cacheKey.slice(0, 8)}\n`)
  res.writeHead(200, {
    'Content-Type': 'text/xml; charset=utf-8',
    'X-Cache': cacheHit ? 'HIT' : 'MISS',
  })
  fs.createReadStream(cacheFile).pipe(res)
}

// Refresh all cached EPG files (called daily at 07:00)
async function refreshAllCachedEpg() {
  try {
    const files = fs.readdirSync(EPG_CACHE_DIR).filter((f) => f.endsWith('.meta.json'))
    for (const file of files) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(EPG_CACHE_DIR, file), 'utf8'))
        if (meta.url) {
          const cacheKey = file.replace('.meta.json', '')
          await fetchAndCacheEpg(meta.url, cacheKey)
        }
      } catch (err) {
        process.stderr.write(`[epg] refresh error for ${file}: ${err.message}\n`)
      }
    }
  } catch (err) {
    process.stderr.write(`[epg] refresh scan error: ${err.message}\n`)
  }
}

function scheduleEpgRefresh() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(7, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delayMs = next - now
  process.stderr.write(`[epg] next auto-refresh at ${next.toISOString()} (${Math.round(delayMs / 60000)} min)\n`)
  setTimeout(async () => {
    await refreshAllCachedEpg()
    scheduleEpgRefresh()
  }, delayMs)
}

scheduleEpgRefresh()

// ── HLS live proxy (for iOS native HLS support) ───────────────────────────────
// The IPTV provider's HLS endpoint (http://host/live/USER/PASS/ID.m3u8) can't be
// loaded directly by a browser on an HTTPS page (mixed-content blocked). We
// proxy the M3U8, rewriting segment URLs to go through /live-segment, so iOS
// native HLS can play the stream without codec transcoding.

async function handleLiveHls(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  try {
    const upstream = await fetch(target, { headers: { 'User-Agent': 'StreamForest/1.0' } })
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain' }).end(`Upstream M3U8 ${upstream.status}`)
      return
    }

    const m3u8 = await upstream.text()
    const lastSlash = target.lastIndexOf('/')
    const baseUrl = target.slice(0, lastSlash + 1)
    const targetOrigin = (() => { try { const u = new URL(target); return `${u.protocol}//${u.host}` } catch { return '' } })()

    const rewritten = m3u8.split('\n').map(line => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return line
      // Resolve to absolute URL
      let abs
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        abs = trimmed
      } else if (trimmed.startsWith('/')) {
        abs = targetOrigin + trimmed
      } else {
        abs = baseUrl + trimmed
      }
      // Sub-playlist or segment
      if (abs.includes('.m3u8')) {
        return `/live-hls?url=${encodeURIComponent(abs)}`
      }
      return `/live-segment?url=${encodeURIComponent(abs)}`
    }).join('\n')

    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    }).end(rewritten)
  } catch (err) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`HLS proxy error: ${err.message}`)
  }
}

async function handleLiveSegment(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const segTimeout = setTimeout(() => {
    if (!res.headersSent) res.writeHead(504).end('Segment timeout')
  }, 15000)

  try {
    const upstream = await fetch(target, { headers: { 'User-Agent': 'StreamForest/1.0' } })
    clearTimeout(segTimeout)
    if (!upstream.ok) {
      if (!res.headersSent) res.writeHead(upstream.status).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'video/MP2T', 'Cache-Control': 'public, max-age=60' })
    const reader = upstream.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    clearTimeout(segTimeout)
    if (!res.headersSent) res.writeHead(502).end()
  }
}

// ── TMDB metadata disk cache ───────────────────────────────────────────────────

function tmdbCacheFile(id) {
  return path.join(TMDB_CACHE_DIR, createHash('sha1').update(id).digest('hex') + '.json')
}

function handleTmdbGet(reqUrl, res) {
  const id = reqUrl.searchParams.get('id')
  if (!id) {
    res.writeHead(400).end('Missing id')
    return
  }
  const cacheFile = tmdbCacheFile(id)
  try {
    const stat = fs.statSync(cacheFile)
    if (Date.now() - stat.mtimeMs < TMDB_CACHE_TTL_MS) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
        'X-Cache': 'HIT',
      })
      fs.createReadStream(cacheFile).pipe(res)
      return
    }
    fs.unlinkSync(cacheFile)
  } catch { /* ENOENT */ }
  res.writeHead(404).end('Not found')
}

function handleHlsStart(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return
  const mode = reqUrl.searchParams.get('mode') === 'transcode' ? 'transcode' : 'copy'
  const live = reqUrl.searchParams.get('live') === '1'
  const start = Number(reqUrl.searchParams.get('start') || 0)
  const audioParam = reqUrl.searchParams.get('audio')
  const audioIdx = audioParam !== null && /^\d+$/.test(audioParam) ? Number(audioParam) : null
  const hash = createHash('sha1').update(`hls|${target}|${mode}|${live ? 'live' : start}`).digest('hex').slice(0, 16)

  const existing = hlsSessions.get(hash)
  if (existing) {
    // Only reuse if ffmpeg is still running or exited cleanly (exit 0 = ENDLIST written).
    // Non-zero exit means provider truncated the stream — delete and start a fresh session.
    if (existing.proc.exitCode === null || existing.proc.exitCode === 0) {
      existing.lastAccess = Date.now()
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ hash }))
      return
    }
    process.stderr.write(`[hls] reuse-rejected hash=${hash.slice(0, 8)} exitCode=${existing.proc.exitCode} — starting fresh\n`)
    hlsSessions.delete(hash)
    try { fs.rmSync(existing.dir, { recursive: true, force: true }) } catch {}
    // Fall through to start a new session
  }

  const dir = path.join(HLS_DIR, hash)
  fs.mkdirSync(dir, { recursive: true })
  process.stderr.write(`[hls] dir_created exists=${fs.existsSync(dir)} path=${dir}\n`)

  // Use 'info' loglevel so we can see why ffmpeg fails (warning misses some input errors)
  const args = ['-hide_banner', '-loglevel', 'info']
  if (live) args.push('-fflags', '+genpts+discardcorrupt')
  if (!live && start > 0) args.push('-ss', String(mode === 'transcode' ? Math.max(0, start - 5) : start))
  if (mode === 'transcode' && H264_ENCODER === 'h264_vaapi') args.push('-vaapi_device', VAAPI_DEVICE)
  args.push('-i', target, '-map', '0:v:0', '-map', audioIdx !== null ? `0:${audioIdx}` : '0:a:0?')
  if (!live && start > 0 && mode === 'transcode') args.push('-ss', String(start))

  if (mode === 'copy') {
    args.push('-c:v', 'copy')
  } else if (H264_ENCODER === 'h264_vaapi') {
    args.push('-c:v', 'h264_vaapi', '-vf', `scale='min(iw,${VIDEO_MAX_WIDTH})':-2,format=nv12,hwupload`, '-qp', VAAPI_QP)
  } else {
    args.push('-c:v', H264_ENCODER, '-preset', H264_PRESET, '-vf', `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`, '-b:v', VIDEO_BITRATE, '-maxrate', VIDEO_MAX_BITRATE, '-bufsize', '3M', '-pix_fmt', 'yuv420p')
  }
  args.push(
    '-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '2', '-bsf:a', 'aac_adtstoasc',
    '-f', 'hls', '-hls_time', '4',
    '-hls_list_size', live ? '6' : '0',
    '-hls_flags', live ? 'delete_segments+append_list' : 'temp_file',
  )
  // A growing playlist with no type and no ENDLIST *is* a live playlist by the
  // HLS spec, and WebKit reads it that way: it starts at the live edge instead of
  // at zero and refuses to seek before the sliding window. In copy mode ffmpeg
  // races far ahead of real time, so that edge is deep inside the film.
  //
  // EVENT means append-only, seekable from the start, and never truncated at the
  // front — which is exactly what a VOD playlist still being written is.
  if (!live) args.push('-hls_playlist_type', 'event')
  args.push(
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    path.join(dir, 'playlist.m3u8'),
  )

  process.stderr.write(`[hls] start hash=${hash.slice(0, 8)} live=${live} mode=${mode} start=${start}\n`)
  const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  proc.stderr.on('data', (d) => process.stderr.write(`[hls:${hash.slice(0, 8)}] ${d}`))

  const sess = { proc, dir, lastAccess: Date.now(), live }
  hlsSessions.set(hash, sess)

  // Send 200 immediately and write keepalive whitespace every 5 s to prevent
  // Cloudflare Tunnel from dropping the connection before the first HLS segment
  // is ready (CF has a ~15 s first-byte timeout for proxied origins).
  res.writeHead(200, { 'Content-Type': 'application/json' })
  const keepalive = setInterval(() => { try { res.write(' ') } catch {} }, 5000)
  res.on('close', () => clearInterval(keepalive))

  proc.on('exit', (code) => {
    process.stderr.write(`[hls] exit hash=${hash.slice(0, 8)} code=${code}\n`)
    if (!live) {
      // If ffmpeg exited non-zero (provider truncated the stream), write #EXT-X-ENDLIST
      // so any iOS client already playing the playlist knows the stream is complete at
      // its current length. Without this, iOS treats the VOD as a live stream and keeps
      // polling for new segments — eventually timing out with a code 4 decode error.
      if (code !== 0) {
        const playlistPath = path.join(dir, 'playlist.m3u8')
        try {
          const content = fs.readFileSync(playlistPath, 'utf8')
          if (!content.includes('#EXT-X-ENDLIST')) {
            fs.appendFileSync(playlistPath, '\n#EXT-X-ENDLIST\n')
            process.stderr.write(`[hls] appended ENDLIST hash=${hash.slice(0, 8)}\n`)
          }
        } catch {}
      }
      // Only clean up if this session is still current — the poll-loop timeout may have
      // already deleted the Map entry and the dir, and a new session may have re-used
      // the same hash+dir. Deleting unconditionally would nuke the new session's dir.
      setTimeout(() => {
        if (hlsSessions.get(hash) === sess) {
          hlsSessions.delete(hash)
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }, 10 * 60_000)
    }
  })

  let waited = 0
  const poll = () => {
    try {
      if (fs.readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8').includes('.ts')) {
        clearInterval(keepalive)
        res.end(JSON.stringify({ hash }))
        return
      }
    } catch {}
    waited += 300
    if (waited >= 20_000) {
      try { proc.kill() } catch {}
      clearInterval(keepalive)
      if (hlsSessions.get(hash) === sess) {
        hlsSessions.delete(hash)
        fs.rmSync(dir, { recursive: true, force: true })
      }
      process.stderr.write(`[hls] poll-timeout hash=${hash.slice(0, 8)}\n`)
      res.end(JSON.stringify({ error: 'HLS timeout — ffmpeg did not produce output in 20 s' }))
      return
    }
    setTimeout(poll, 300)
  }
  setTimeout(poll, 300)
}

function handleHlsFile(pathname, res) {
  const rest = pathname.slice('/hls-file/'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) { res.writeHead(400).end('Bad path'); return }
  const hash = rest.slice(0, slash)
  const filename = rest.slice(slash + 1)
  if (!filename || filename.includes('..') || filename.includes('/')) { res.writeHead(400).end('Bad filename'); return }
  const sess = hlsSessions.get(hash)
  if (!sess) { res.writeHead(404).end('Session not found'); return }
  sess.lastAccess = Date.now()
  const ct = filename.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T'
  fs.readFile(path.join(sess.dir, filename), (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-cache' }).end(data)
  })
}

function handleTmdbPost(req, res) {
  let body = ''
  req.on('data', (c) => { body += c.toString() })
  req.on('end', () => {
    try {
      const meta = JSON.parse(body)
      if (!meta.id || meta.notFound) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
        return
      }
      const cacheFile = tmdbCacheFile(String(meta.id))
      fs.writeFileSync(cacheFile, JSON.stringify(meta))
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
    } catch {
      res.writeHead(400).end('Bad JSON')
    }
  })
}

// ── Client diagnostics log ────────────────────────────────────────────────────
// The client POSTs one JSON object per playback event. We can't attach a debugger
// to a phone in the living room, so this file is the only window into what the
// player actually did on a real device — hence the matching GET below.

const CLIENT_LOG_PREV = CLIENT_LOG_FILE + '.1'

// Rotate to a single .1 generation rather than truncating. Truncating threw away
// the history right when a long debugging session needed it most.
function rotateClientLogIfNeeded() {
  try {
    if (fs.statSync(CLIENT_LOG_FILE).size <= CLIENT_LOG_MAX_BYTES) return
    fs.rmSync(CLIENT_LOG_PREV, { force: true })
    fs.renameSync(CLIENT_LOG_FILE, CLIENT_LOG_PREV)
    process.stderr.write('[clientlog] rotated\n')
  } catch { /* ENOENT — nothing written yet */ }
}

function handleClientLogPost(req, res) {
  let body = ''
  let tooBig = false
  req.on('data', (chunk) => {
    body += chunk.toString()
    // A single event is a few hundred bytes; anything past 64 KB is not ours.
    if (body.length > 65536) { tooBig = true; req.destroy() }
  })
  req.on('end', () => {
    if (tooBig) { res.writeHead(413).end('too large'); return }
    try {
      const parsed = JSON.parse(body)
      // The client batches events, but a single object is still accepted so an
      // older build (or a curl by hand) keeps working.
      const events = Array.isArray(parsed) ? parsed : [parsed]
      const srv = Date.now()
      const ip = req.socket.remoteAddress
      const lines = events
        .filter((e) => e && typeof e === 'object')
        .map((e) => JSON.stringify({ ...e, _ip: ip, _srv: srv }))
      if (lines.length > 0) {
        rotateClientLogIfNeeded()
        fs.appendFile(CLIENT_LOG_FILE, lines.join('\n') + '\n', () => {})
      }
      // Errors go to the container log too so `docker logs` shows them without a fetch.
      for (const e of events) {
        if (e?.level === 'error' || /error|fail|reject/i.test(String(e?.ev ?? e?.message ?? ''))) {
          console.log(`[clientlog] ${JSON.stringify(e)}`)
        }
      }
    } catch { /* malformed body — drop it, never 500 on a diagnostic */ }
    res.writeHead(200).end('ok')
  })
}

// GET /clientlog?since=<epoch ms>&limit=<n>&sid=<session>  → NDJSON, newest last.
// Reads the rotated generation first so `since` can reach back past a rotation.
function handleClientLogGet(reqUrl, req, res) {
  if (!CLIENT_LOG_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
      .end('Log reads disabled — set CLIENT_LOG_TOKEN on the server')
    return
  }
  const auth = req.headers.authorization ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const supplied = bearer || reqUrl.searchParams.get('token') || ''
  if (supplied !== CLIENT_LOG_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized')
    return
  }

  const since = Number(reqUrl.searchParams.get('since') || 0)
  const limit = Math.min(Number(reqUrl.searchParams.get('limit')) || 2000, 20000)
  const sid = reqUrl.searchParams.get('sid')
  const ev = reqUrl.searchParams.get('ev')

  let lines = []
  for (const file of [CLIENT_LOG_PREV, CLIENT_LOG_FILE]) {
    try { lines.push(...fs.readFileSync(file, 'utf8').split('\n')) } catch { /* ENOENT */ }
  }

  const out = []
  for (const line of lines) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (since && Number(row.ts ?? row._srv ?? 0) < since) continue
    if (sid && row.sid !== sid) continue
    if (ev && row.ev !== ev) continue
    out.push(line)
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Total-Matched': String(out.length),
  }).end(out.slice(-limit).join('\n') + (out.length ? '\n' : ''))
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`)
  process.stderr.write(`[req] ${req.method} ${reqUrl.pathname}\n`)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
    return
  }

  if (reqUrl.pathname === '/transcode') {
    handleTranscode(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/probe') {
    handleProbe(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/keyframe') {
    handleKeyframe(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/subtitle') {
    handleSubtitle(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/epg') {
    handleEpg(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/live-hls') {
    handleLiveHls(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/live-segment') {
    handleLiveSegment(reqUrl, res)
    return
  }

  if (reqUrl.pathname === '/tmdb') {
    if (req.method === 'GET') {
      handleTmdbGet(reqUrl, res)
    } else if (req.method === 'POST') {
      handleTmdbPost(req, res)
    } else {
      res.writeHead(405).end('Method not allowed')
    }
    return
  }

  if (reqUrl.pathname === '/hls-start') {
    handleHlsStart(reqUrl, res)
    return
  }

  if (reqUrl.pathname.startsWith('/hls-file/')) {
    handleHlsFile(reqUrl.pathname, res)
    return
  }

  if (reqUrl.pathname === '/clientlog') {
    if (req.method === 'POST') { handleClientLogPost(req, res); return }
    if (req.method === 'GET')  { handleClientLogGet(reqUrl, req, res); return }
    res.writeHead(405).end('Method not allowed')
    return
  }

  res.writeHead(404).end('Not found')
})

server.listen(PORT, () => {
  console.log(`[transcode-proxy] listening on :${PORT}`)
  console.log(`[transcode-proxy] allowed hosts: ${ALLOWED_HOSTS.join(', ')}`)
  console.log(`[transcode-proxy] ffmpeg: ${FFMPEG_PATH}`)
  console.log(`[transcode-proxy] ffprobe: ${FFPROBE_PATH}`)
})
