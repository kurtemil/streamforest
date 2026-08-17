#!/usr/bin/env node
// Reader for the diagnostics the player posts from real devices.
//
// The whole point of the client log is that nobody has to run a test on their
// phone: they watch television, and the answers arrive here.
//
//   node tools/clientlog.mjs                    # last hour, grouped by playback
//   node tools/clientlog.mjs --since 24h        # a longer window
//   node tools/clientlog.mjs --raw              # NDJSON, for piping into jq
//   node tools/clientlog.mjs --summary          # timings and failure rates only
//
// Needs CLIENT_LOG_TOKEN (matching the server) and optionally
// VITE_TRANSCODE_PROXY_URL; both are read from .env.local when present.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')

// Minimal .env.local reader — no dependency for four lines of parsing.
function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env.local — rely on the ambient environment */ }
}
loadEnv()

const args = process.argv.slice(2)
const argOf = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : fallback
}

// CLIENT_LOG_BASE first: VITE_TRANSCODE_PROXY_URL points at localhost during
// development, but the devices whose logs we want are talking to the tunnel.
const BASE = (
  argOf('--base') || process.env.CLIENT_LOG_BASE || process.env.VITE_TRANSCODE_PROXY_URL || ''
).replace(/\/+$/, '')
const TOKEN = process.env.CLIENT_LOG_TOKEN || argOf('--token', '')

if (!BASE) {
  console.error('No proxy URL. Set VITE_TRANSCODE_PROXY_URL in .env.local or pass --base <url>.')
  process.exit(1)
}
if (!TOKEN) {
  console.error('No token. Set CLIENT_LOG_TOKEN in .env.local (must match the server) or pass --token.')
  process.exit(1)
}

function parseDuration(text) {
  const m = /^(\d+)([mhd])$/.exec(text ?? '')
  if (!m) return 60 * 60 * 1000
  const n = Number(m[1])
  return n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]
}

const since = Date.now() - parseDuration(argOf('--since', '1h'))

const res = await fetch(`${BASE}/clientlog?since=${since}&limit=20000`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})
if (!res.ok) {
  console.error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 200)}`)
  process.exit(1)
}

const text = await res.text()
const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l))

if (args.includes('--raw')) {
  process.stdout.write(text)
  process.exit(0)
}

if (rows.length === 0) {
  console.log('No events in this window. Widen it with --since 24h.')
  process.exit(0)
}

// ── Devices ───────────────────────────────────────────────────────────────────

const sessions = rows.filter((r) => r.ev === 'session-start')
if (sessions.length) {
  console.log('\x1b[1mDevices\x1b[0m')
  for (const s of sessions) {
    const mode = s.standalone || s.displayModeStandalone ? 'installed PWA' : 'browser tab'
    console.log(
      `  ${s.brand} / ${s.engine}${s.iosVersion ? ` iOS ${s.iosVersion}` : ''} · ${mode}` +
      `\n    viewport ${s.viewport} @${s.dpr}x · safe-area ${s.insets}${s.connection ? ` · ${s.connection}` : ''}`,
    )
  }
}

// ── Playbacks ─────────────────────────────────────────────────────────────────

const byPlayback = new Map()
for (const r of rows) {
  if (!r.pid) continue
  if (!byPlayback.has(r.pid)) byPlayback.set(r.pid, [])
  byPlayback.get(r.pid).push(r)
}

const stats = { total: 0, firstFrame: 0, failed: 0, ttff: [], hls: [], probe: [], seeks: 0, seekRestarts: 0 }
const liveEdgeStarts = []

console.log(`\n\x1b[1mPlaybacks\x1b[0m (${byPlayback.size} in this window)`)
for (const [pid, events] of byPlayback) {
  events.sort((a, b) => (a.t ?? 0) - (b.t ?? 0))
  const open = events.find((e) => e.ev === 'open')
  const first = events.find((e) => e.ev === 'first-frame')
  const errors = events.filter((e) => e.level === 'error')
  stats.total++
  if (first) { stats.firstFrame++; stats.ttff.push(first.t) }
  if (errors.length) stats.failed++

  for (const e of events) {
    if (e.ev === 'hls-ready') stats.hls.push(e.ms)
    if (e.ev === 'probe-done') stats.probe.push(e.ms)
    if (e.ev === 'seek') { stats.seeks++; if (e.method === 'session-restart') stats.seekRestarts++ }
  }

  // A2 read from the device: a VOD that begins well past zero, with a seekable
  // window that does not start at zero either, is a playlist WebKit took as live.
  if (first && first.seekable) {
    const seekStart = Number(String(first.seekable).split('-')[0])
    if (seekStart > 1 && first.offset === 0) {
      liveEdgeStarts.push({ pid, currentTime: first.currentTime, seekable: first.seekable })
    }
  }

  if (args.includes('--summary')) continue

  const label = open ? `${open.type} ${open.show ?? open.id}` : pid
  const outcome = first ? `first frame ${(first.t / 1000).toFixed(1)}s` : errors.length ? 'FAILED' : 'no first frame'
  console.log(`\n  \x1b[2m${pid}\x1b[0m ${label} — ${outcome}`)
  for (const e of events) {
    if (e.ev === 'session-start') continue
    const t = e.t != null ? `+${String(e.t).padStart(6)}ms` : '        '
    const extra = Object.entries(e)
      .filter(([k]) => !['ts', 'sid', 'pid', 't', 'ev', 'level', '_ip', '_srv', 'ua'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    const colour = e.level === 'error' ? '\x1b[31m' : e.ev === 'first-frame' ? '\x1b[32m' : ''
    console.log(`    ${t} ${colour}${e.ev}\x1b[0m ${extra}`.trimEnd())
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const fmt = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`)

console.log('\n\x1b[1mSummary\x1b[0m')
console.log(`  playbacks              ${stats.total}`)
console.log(`  reached a first frame  ${stats.firstFrame}/${stats.total}`)
console.log(`  had an error           ${stats.failed}/${stats.total}`)
console.log(`  median time to frame   ${fmt(median(stats.ttff))}`)
console.log(`  median probe           ${fmt(median(stats.probe))}`)
console.log(`  median hls-start       ${fmt(median(stats.hls))}`)
console.log(`  seeks                  ${stats.seeks} (${stats.seekRestarts} needed a new server session)`)

if (liveEdgeStarts.length) {
  console.log(
    `\n  \x1b[33mA2: ${liveEdgeStarts.length} playback(s) began past the start of the stream\x1b[0m`,
  )
  for (const p of liveEdgeStarts.slice(0, 5)) {
    console.log(`    ${p.pid}  started at ${p.currentTime}s, seekable ${p.seekable}`)
  }
  console.log('    A seekable window that does not begin at 0 is WebKit treating the')
  console.log('    playlist as live — exactly what -hls_playlist_type event fixes.')
}

const rejected = rows.filter((r) => r.ev === 'play-rejected')
if (rejected.length) {
  const byName = {}
  for (const r of rejected) byName[r.name] = (byName[r.name] ?? 0) + 1
  console.log(`\n  \x1b[33mA3: ${rejected.length} play() rejection(s)\x1b[0m`)
  for (const [name, n] of Object.entries(byName)) {
    console.log(`    ${name} ×${n}${name === 'NotAllowedError' ? '  ← autoplay policy: the gesture was already spent' : ''}`)
  }
  const phases = [...new Set(rejected.map((r) => r.phase))]
  console.log(`    phases: ${phases.join(', ')}`)
}
