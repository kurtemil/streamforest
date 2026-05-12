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
const FFMPEG_LOGLEVEL = process.env.FFMPEG_LOGLEVEL || 'warning'
const VIDEO_MAX_WIDTH = Number(process.env.VIDEO_MAX_WIDTH) || 1280
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '1500k'
const VIDEO_MAX_BITRATE = process.env.VIDEO_MAX_BITRATE || '2000k'
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '128k'
const SUB_CACHE_DIR = process.env.SUB_CACHE_DIR || path.join(os.tmpdir(), 'streamforest-subs')
const SUB_CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS) || 7 * 24 * 60 * 60 * 1000

fs.mkdirSync(SUB_CACHE_DIR, { recursive: true })

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
    res.writeHead(403).end('Host not allowed')
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
    const movflags = live
      ? 'frag_keyframe+empty_moov+default_base_moof'
      : 'frag_keyframe+empty_moov+default_base_moof+faststart'
    args.push('-c', 'copy')
    if (live) args.push('-bsf:a', 'aac_adtstoasc')
    args.push(
      '-movflags', movflags,
      '-f', 'mp4',
      'pipe:1',
    )
  } else if (H264_ENCODER === 'h264_vaapi') {
    args.push(
      '-c:v', 'h264_vaapi',
      '-vf', `scale='min(iw,${VIDEO_MAX_WIDTH})':-2,format=nv12,hwupload`,
      '-b:v', VIDEO_BITRATE,
      '-maxrate', VIDEO_MAX_BITRATE,
      '-bufsize', `${parseInt(VIDEO_MAX_BITRATE) * 2}k`,
      '-c:a', 'aac',
      '-b:a', AUDIO_BITRATE,
      '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
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
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
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

  ff.stderr.on('data', (chunk) => {
    const line = chunk.toString()
    process.stderr.write(line)
    if (/Server returned|No such file|Invalid data|could not find/i.test(line)) {
      sawStderrError = true
    }
  })

  ff.stdout.once('data', (chunk) => {
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
    console.error('ffmpeg spawn error:', err)
    if (!headersSent) {
      headersSent = true
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`ffmpeg spawn failed: ${err.message}`)
    } else {
      res.destroy()
    }
  })

  ff.on('exit', (code, signal) => {
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

  ff.on('error', (e) => {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message }))
  })

  ff.on('exit', (code) => {
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
  const seekTo = seekBucket > 0 ? Math.max(0, seekBucket - 60) : 0
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

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`)
  process.stderr.write(`[req] ${req.method} ${reqUrl.pathname}\n`)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')

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

  if (reqUrl.pathname === '/subtitle') {
    handleSubtitle(reqUrl, res)
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
