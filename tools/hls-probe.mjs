#!/usr/bin/env node
// Harness for the iOS HLS path — answers findings A2, A5, A6 and A7 without a phone.
//
// Spins up a throwaway HTTP origin serving a locally generated test video, points
// a fresh transcode-proxy at it, asks for an HLS session, and inspects what ffmpeg
// actually produced. Self-contained on purpose: it costs the IPTV subscription
// nothing and gives the same answer every run.
//
//   node tools/hls-probe.mjs                    # local generated source
//   node tools/hls-probe.mjs --url <stream>     # a real provider URL
//   node tools/hls-probe.mjs --keep             # leave the session dir for inspection
//
// Exit code is non-zero when a check fails, so it doubles as a regression gate.

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const SERVER = path.join(REPO, 'transcode-proxy', 'server.mjs')
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

const ORIGIN_PORT = 8899
const PROXY_PORT = 8898
const WORK = path.join(os.tmpdir(), 'streamforest-hls-probe')

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : null
}
const externalUrl = argOf('--url')
const keep = args.includes('--keep')

// ── Reporting ─────────────────────────────────────────────────────────────────

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  const mark = pass === null ? '–' : pass ? '✓' : '✗'
  console.log(`  ${mark} ${name}${detail ? `  ${detail}` : ''}`)
}
function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Test origin ───────────────────────────────────────────────────────────────

// Serves one file with Range support. ffmpeg needs ranges to honour -ss on an
// http input, which is exactly what the seek path does.
function startOrigin(filePath) {
  const size = fs.statSync(filePath).size
  const server = http.createServer((req, res) => {
    const range = req.headers.range
    if (!range) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
      })
      fs.createReadStream(filePath).pipe(res)
      return
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    const start = m && m[1] ? Number(m[1]) : 0
    const end = m && m[2] ? Number(m[2]) : size - 1
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
    })
    fs.createReadStream(filePath, { start, end }).pipe(res)
  })
  return new Promise((resolve) => server.listen(ORIGIN_PORT, '127.0.0.1', () => resolve(server)))
}

function makeTestVideo(dest) {
  // 90 s is long enough that ffmpeg writes a couple of dozen 4 s segments, which
  // is what makes the playlist-type question observable.
  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=90',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '50',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    dest,
  ], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error('ffmpeg could not generate the test clip:\n', r.stderr)
    process.exit(1)
  }
}

// ── Proxy under test ──────────────────────────────────────────────────────────

function startProxy() {
  const proc = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PROXY_PORT),
      ALLOWED_HOSTS: externalUrl ? new URL(externalUrl).hostname : '127.0.0.1',
      FFMPEG_PATH: FFMPEG,
      FFPROBE_PATH: FFPROBE,
      H264_ENCODER: 'libx264',
      FFMPEG_LOGLEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  proc.stdout.on('data', (d) => log.push(d.toString()))
  proc.stderr.on('data', (d) => log.push(d.toString()))
  return { proc, log }
}

async function waitForProxy() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`)
      if (res.ok) return true
    } catch { /* not up yet */ }
    await sleep(150)
  }
  return false
}

async function startHlsSession(sourceUrl, extra = {}) {
  const params = new URLSearchParams({ url: sourceUrl, ...extra })
  const res = await fetch(`http://127.0.0.1:${PROXY_PORT}/hls-start?${params}`)
  const text = await res.text()
  try {
    return JSON.parse(text.trim())
  } catch {
    return { error: `unparseable response: ${text.slice(0, 200)}` }
  }
}

function dirSize(dir) {
  let total = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      try { total += fs.statSync(path.join(dir, f)).size } catch { /* raced with cleanup */ }
    }
  } catch { /* gone */ }
  return total
}

// ── Checks ────────────────────────────────────────────────────────────────────

function inspectPlaylist(text) {
  section('A2 — playlist type (does WebKit see a movie or a live stream?)')
  const header = text.split('\n').filter((l) => l.startsWith('#') && !l.startsWith('#EXTINF')).slice(0, 10)
  console.log(header.map((l) => `      ${l}`).join('\n'))

  const type = /#EXT-X-PLAYLIST-TYPE:(\w+)/.exec(text)?.[1] ?? null
  const hasEndlist = text.includes('#EXT-X-ENDLIST')
  const segments = (text.match(/\.ts|\.m4s/g) ?? []).length

  check(
    'EXT-X-PLAYLIST-TYPE present',
    type !== null,
    type ? `→ ${type}` : '→ absent: WebKit treats this as a LIVE stream',
  )
  // A missing ENDLIST is only a problem alongside a missing type. With EVENT the
  // playlist is declared append-only and seekable from zero while it is still
  // being written; ENDLIST arrives when ffmpeg finishes. Reporting that as a
  // failure would train us to ignore the one check that matters.
  check(
    'EXT-X-ENDLIST present',
    hasEndlist ? true : type ? null : false,
    hasEndlist ? '' : type ? '→ not yet — still writing, which EVENT allows' : '→ playlist still growing',
  )
  check('playlist has segments', segments > 0, `→ ${segments}`)

  if (type === null && !hasEndlist) {
    console.log(
      '\n      \x1b[33mA2 CONFIRMED\x1b[0m — a growing playlist with neither a type nor an\n' +
      '      ENDLIST is a live playlist by the HLS spec. Safari starts at the live\n' +
      '      edge and refuses to seek before the sliding window.',
    )
  }
  return { type, hasEndlist, segments }
}

function inspectSegment(dir) {
  section('A7 — segment container and codec tags')
  let segment = null
  try {
    segment = fs.readdirSync(dir).find((f) => f.endsWith('.ts') || f.endsWith('.m4s'))
  } catch { /* dir gone */ }
  if (!segment) {
    check('segment written', false, '→ none found')
    return
  }
  const r = spawnSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=format_name:stream=codec_type,codec_name,codec_tag_string',
    '-of', 'json',
    path.join(dir, segment),
  ], { encoding: 'utf8' })

  let parsed
  try { parsed = JSON.parse(r.stdout) } catch { parsed = null }
  if (!parsed) {
    check('segment is probeable', false, `→ ffprobe failed: ${r.stderr.slice(0, 120)}`)
    return
  }

  const format = parsed.format?.format_name ?? '?'
  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const audio = parsed.streams?.find((s) => s.codec_type === 'audio')

  check('segment container', true, `→ ${format} (${segment})`)
  check('video stream', !!video, video ? `→ ${video.codec_name} tag=${video.codec_tag_string || 'none'}` : '')
  check('audio stream', !!audio, audio ? `→ ${audio.codec_name}` : '')

  const isTs = format.includes('mpegts')
  const isHevc = video?.codec_name === 'hevc'
  check(
    'fMP4 segments (Apple-recommended for HLS)',
    !isTs,
    isTs ? '→ MPEG-TS; fMP4 is what -hls_segment_type fmp4 gives' : '',
  )
  if (isHevc && video.codec_tag_string !== 'hvc1') {
    check('HEVC carries the hvc1 tag iOS requires', false, `→ tag is "${video.codec_tag_string || 'none'}"`)
  }
}

async function checkSessionHashing(sourceUrl) {
  section('A5 — does the session key include the audio track?')
  const a = await startHlsSession(sourceUrl, { audio: '1' })
  const b = await startHlsSession(sourceUrl, { audio: '2' })
  if (!a.hash || !b.hash) {
    check('two audio variants both started', false, `→ ${a.error ?? ''} ${b.error ?? ''}`.trim())
    return
  }
  check(
    'different audio → different session',
    a.hash !== b.hash,
    a.hash === b.hash
      ? `→ both ${a.hash.slice(0, 8)}: an audio switch silently reuses the old track`
      : `→ ${a.hash.slice(0, 8)} vs ${b.hash.slice(0, 8)}`,
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(WORK, { recursive: true })

  let origin = null
  let sourceUrl = externalUrl

  if (!sourceUrl) {
    const clip = path.join(WORK, 'source.mp4')
    if (!fs.existsSync(clip)) {
      console.log('Generating a 90 s test clip with ffmpeg…')
      makeTestVideo(clip)
    }
    origin = await startOrigin(clip)
    sourceUrl = `http://127.0.0.1:${ORIGIN_PORT}/source.mp4`
    console.log(`Test origin serving ${(fs.statSync(clip).size / 1e6).toFixed(1)} MB at ${sourceUrl}`)
  } else {
    console.log(`Using supplied stream: ${sourceUrl.replace(/\/\/[^/]*\//, '//…/')}`)
  }

  const { proc, log } = startProxy()
  if (!(await waitForProxy())) {
    console.error('Proxy did not come up. Server output:\n' + log.join(''))
    proc.kill()
    origin?.close()
    process.exit(1)
  }
  console.log(`Transcode proxy up on :${PROXY_PORT}`)

  try {
    section('Session start')
    const t0 = Date.now()
    const session = await startHlsSession(sourceUrl)
    const elapsed = Date.now() - t0
    if (!session.hash) {
      check('hls-start returned a session', false, `→ ${session.error ?? 'no hash'}`)
      console.error('\nServer output:\n' + log.join(''))
      return
    }
    check('hls-start returned a session', true, `→ ${session.hash.slice(0, 8)} in ${elapsed} ms`)

    const dir = path.join(os.tmpdir(), 'streamforest-hls', session.hash)
    const playlist = fs.readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8')
    inspectPlaylist(playlist)
    inspectSegment(dir)

    // ffmpeg keeps running well past the first segment, so let it get ahead
    // before measuring — that growth is exactly what finding A6 is about.
    section('A6 — disk footprint of one session')
    const early = dirSize(dir)
    await sleep(5000)
    const later = dirSize(dir)
    check('session directory measured', true,
      `→ ${(early / 1e6).toFixed(1)} MB → ${(later / 1e6).toFixed(1)} MB in 5 s`)
    const perMin = ((later - early) / 5) * 60
    if (perMin > 0) {
      check('growth rate', true,
        `→ ~${(perMin / 1e6).toFixed(0)} MB/min for this clip; a full movie lands in the GB range`)
    }

    await checkSessionHashing(sourceUrl)
  } finally {
    proc.kill()
    origin?.close()
    if (!keep) {
      await sleep(300)
      try { fs.rmSync(path.join(os.tmpdir(), 'streamforest-hls'), { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }

  const failed = results.filter((r) => r.pass === false)
  section(`Summary — ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? `  ${f.detail}` : ''}`)
    console.log('\nFailures above are the findings this harness exists to prove.')
  }
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
