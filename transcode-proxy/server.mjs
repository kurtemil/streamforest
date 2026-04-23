import http from 'node:http'
import { spawn } from 'node:child_process'
import { URL } from 'node:url'

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

  const args = ['-hide_banner', '-loglevel', FFMPEG_LOGLEVEL]
  if (start > 0) args.push('-ss', String(start))
  args.push(
    '-i', target,
    '-map', '0:v:0',
    '-map', '0:a:0?',
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
    // Scale down to max 720p keeping aspect ratio. 1080p at ultrafast is only
    // ~2-3× realtime on a consumer CPU — a single OS hiccup drops below realtime
    // and the MSE video buffer starves. 720p gives comfortable headroom.
    '-vf', "scale='min(1280,iw)':-2",
    // Cap bitrate for predictable output rate. Prevents bursts that overwhelm
    // Chrome's buffer on high-motion scenes.
    '-b:v', '2500k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-pix_fmt', 'yuv420p',
    // Keyframe every 1 second + frag_keyframe below = one video-bearing
    // fragment every second. Keeps MSE video buffer fed continuously.
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  )

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

function handleProbe(reqUrl, res) {
  const target = parseTargetUrl(reqUrl, res)
  if (!target) return

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-show_entries', 'format=duration:stream=index,codec_type,codec_name',
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
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : []
      const audio = streams.find((s) => s.codec_type === 'audio')
      const video = streams.find((s) => s.codec_type === 'video')
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
      }).end(JSON.stringify({
        duration: Number.isFinite(duration) ? duration : null,
        audioCodec: audio?.codec_name ?? null,
        videoCodec: video?.codec_name ?? null,
      }))
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'bad ffprobe output' }))
    }
  })

  res.on('close', () => {
    if (!ff.killed) ff.kill('SIGKILL')
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

  res.writeHead(404).end('Not found')
})

server.listen(PORT, () => {
  console.log(`[transcode-proxy] listening on :${PORT}`)
  console.log(`[transcode-proxy] allowed hosts: ${ALLOWED_HOSTS.join(', ')}`)
  console.log(`[transcode-proxy] ffmpeg: ${FFMPEG_PATH}`)
  console.log(`[transcode-proxy] ffprobe: ${FFPROBE_PATH}`)
})
