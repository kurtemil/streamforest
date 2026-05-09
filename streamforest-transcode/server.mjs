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
// Video encoder: libx264 (software, universal) on dev.
// On Raspberry Pi 4, set H264_ENCODER=h264_v4l2m2m to use the hardware encoder.
// Other options: h264_nvenc (NVIDIA), h264_qsv (Intel Quick Sync), h264_vaapi (AMD/Intel VAAPI).
const H264_ENCODER = process.env.H264_ENCODER || 'libx264'
const H264_PRESET = process.env.H264_PRESET || 'ultrafast'
const FFMPEG_LOGLEVEL = process.env.FFMPEG_LOGLEVEL || 'warning'
// Output width cap (height scales to preserve aspect ratio).
// 720 = 1280 wide target. Drop to 960 (540p) or 640 (360p) if upload-bound.
const VIDEO_MAX_WIDTH = Number(process.env.VIDEO_MAX_WIDTH) || 1280
// Target video bitrate. Keep headroom below your home upload speed —
// typical residential upload is 10-20Mbps but can drop under load.
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '1500k'
const VIDEO_MAX_BITRATE = process.env.VIDEO_MAX_BITRATE || '2000k'
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '128k'
const SUB_CACHE_DIR = process.env.SUB_CACHE_DIR || path.join(os.tmpdir(), 'streamforest-subs')
const SUB_CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS) || 7 * 24 * 60 * 60 * 1000

fs.mkdirSync(SUB_CACHE_DIR, { recursive: true })

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
  // mode=copy: stream-copy remux only (no re-encode). Cheap on CPU and holds a
  // single upstream socket — used when the upstream codecs are browser-compatible
  // and we just need the proxy as a connection bottleneck against IPTV providers
  // that rate-limit concurrent requests.
  const mode = reqUrl.searchParams.get('mode') === 'copy' ? 'copy' : 'transcode'
  // live=1: continuous MPEG-TS source (Xtream Codes live channels). Disables
  // -ss (no seeking into a live stream) and drops +faststart (a no-op for
  // fragmented MP4 anyway, but pointless for live). +genpts/+discardcorrupt
  // help ffmpeg recover from upstream timestamp glitches that are common with
  // unstable IPTV feeds.
  const live = reqUrl.searchParams.get('live') === '1'

  const args = ['-hide_banner', '-loglevel', FFMPEG_LOGLEVEL]
  if (live) {
    args.push('-fflags', '+genpts+discardcorrupt')
  }
  // Seeking strategy differs by mode:
  // • transcode: two-pass (fast input seek + accurate output seek). The re-encoder
  //   can start at any frame, so output begins at exactly `start` → frame-accurate
  //   subtitle sync.
  // • copy: single-pass fast seek only. The output-level -ss in copy mode overshoots
  //   to the NEXT keyframe (≥ start), making subtitles appear a few seconds early.
  //   Single-pass lands at the keyframe just BEFORE start, making subs slightly late —
  //   which is less jarring perceptually than early.
  if (start > 0 && !live) {
    args.push('-ss', String(mode === 'transcode' ? Math.max(0, start - 5) : start))
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
    // MPEG-TS stores AAC as ADTS; MP4 needs ASC. The bitstream filter
    // converts in-place. Required for stream-copying MPEG-TS → MP4 — without
    // it ffmpeg fails with "Malformed AAC bitstream detected". MKV inputs
    // already carry AAC in ASC, so we only apply this for live.
    if (live) args.push('-bsf:a', 'aac_adtstoasc')
    args.push(
      '-movflags', movflags,
      '-f', 'mp4',
      'pipe:1',
    )
  } else {
    args.push(
      // Full re-encode. Stream-copy would be cheaper, but on seek (`-ss N`) it
      // must land on a video keyframe before N while audio seeks accurately —
      // that's an inherent up-to-several-second A/V desync for sources with
      // sparse keyframes. Re-encoding puts both streams on a shared filter-graph
      // clock and inserts a keyframe exactly at the seek point.
      '-c:v', H264_ENCODER,
      '-preset', H264_PRESET,
      // Kill encoder lookahead / B-frame queue so output streams as fast as
      // frames go in. Without this x264 buffers ~8 frames before first output
      // which adds latency and can stall Chrome's MSE buffer.
      '-tune', 'zerolatency',
      // Scale down cap (config-driven). Keeps encode CPU and output bandwidth
      // within the pipeline's weakest link (often home upload to Cloudflare).
      '-vf', `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`,
      // Cap bitrate for predictable output rate. Needs to fit inside home upload
      // speed with headroom for audio + overhead.
      '-b:v', VIDEO_BITRATE,
      '-maxrate', VIDEO_MAX_BITRATE,
      '-bufsize', `${parseInt(VIDEO_MAX_BITRATE) * 2}k`,
      '-pix_fmt', 'yuv420p',
      // Keyframe every 1 second + frag_keyframe below = one video-bearing
      // fragment every second. Keeps MSE video buffer fed continuously.
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-c:a', 'aac',
      '-b:a', AUDIO_BITRATE,
      '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    )
  }

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
  })

  const cleanup = () => {
    if (!ff.killed) ff.kill('SIGKILL')
  }
  res.on('close', cleanup)
}

// Subtitle codecs ffmpeg can convert directly to WebVTT.
// Image-based subs (PGS/DVB/VobSub) need OCR — out of scope.
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

function subCachePath(url, index, vstart) {
  const hash = createHash('sha1').update(`${url}|${index}|${vstart}`).digest('hex')
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

function handleSubtitle(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const indexParam = reqUrl.searchParams.get('index')
  if (indexParam === null || !/^\d+$/.test(indexParam)) {
    res.writeHead(400).end('Missing or invalid index')
    return
  }
  const index = Number(indexParam)
  // vstart: the video stream's format-level start_time in seconds (from /probe).
  // Non-zero when the source container has a PTS origin offset (common with
  // IPTV-remuxed MPEG-TS sources). We apply -itsoffset -{vstart} so the VTT
  // cue timestamps are relative to the video's re-based timeline (starting at
  // 0), rather than the container's raw PTS. Without this, subtitles are
  // consistently N seconds off whenever the source has a non-zero start_time.
  const vstartParam = Number(reqUrl.searchParams.get('vstart') || 0)
  const vstart = Number.isFinite(vstartParam) && vstartParam > 0 ? vstartParam : 0
  const cacheFile = subCachePath(target, index, vstart)

  // Cache hit — serve immediately.
  try {
    const stat = fs.statSync(cacheFile)
    if (Date.now() - stat.mtimeMs < SUB_CACHE_TTL_MS) {
      console.log(`[subtitle] cache HIT index=${index} size=${stat.size} age=${Math.round((Date.now()-stat.mtimeMs)/60000)}min`)
      serveCachedSubtitle(cacheFile, res, 'HIT')
      return
    }
    console.log(`[subtitle] cache EXPIRED index=${index} — re-extracting`)
    fs.unlinkSync(cacheFile)
  } catch {
    // ENOENT — proceed to extract
  }

  // Cache miss: pipe ffmpeg's WebVTT output to BOTH the client and a tmp file
  // simultaneously. The client gets cues incrementally (first cue typically in
  // 1–5 s once the MKV's first cluster lands), and the tmp file becomes the
  // cache once ffmpeg exits. ffmpeg keeps running even if the client
  // disconnects, so subsequent requests are instant cache hits.
  const tmpFile = `${cacheFile}.${process.pid}.${Date.now()}.tmp`
  const args = ['-hide_banner', '-loglevel', 'error']
  // Shift all input timestamps by -vstart to normalise subtitle cue times
  // to match the video's re-based (0-origin) timeline.
  if (vstart > 0) args.push('-itsoffset', String(-vstart))
  args.push(
    '-i', target,
    '-map', `0:${index}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    'pipe:1',
  )

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const startedAt = Date.now()
  console.log(`[subtitle] start index=${index} vstart=${vstart} url=${target.slice(0, 80)}`)
  const writer = fs.createWriteStream(tmpFile)
  let headersSent = false
  let stderrBuf = ''
  let clientAlive = true
  let lastFfmpegOutputAt = Date.now()
  let bytesFromFfmpeg = 0

  res.on('close', () => { clientAlive = false })

  ff.stderr.on('data', (c) => { stderrBuf += c.toString() })

  // Keepalive: ffmpeg's WebVTT output is completely silent between subtitle cues —
  // action scenes, music, long pauses can easily exceed 60 s with no output. Without
  // keepalives, the client-side stall timer fires, aborts the fetch, and the proxy's
  // ffmpeg continues reading the source until the IPTV server closes the connection
  // (~56 min in practice), then exits 0 and saves a *partial* cache. Every subsequent
  // load would hit that partial cache. The fix: send a VTT NOTE comment to the client
  // only (not the file writer — cache stays clean) every ~20 s of silence so the
  // client's lastByteAt stays fresh and the stall timer never fires.
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
    console.log(`[subtitle] exit code=${code} elapsed=${elapsed}s bytes=${bytesFromFfmpeg} stderr=${stderrBuf.slice(0, 300).replace(/\n/g, ' ')}`)
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
