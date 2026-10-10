#!/usr/bin/env node
// Where the IPTV provider is, and a terminal way to move it.
//
// The app reaches the provider through iptv.krutofv.se, a DNS-only record in our
// own zone that points at the provider's IP (src/lib/provider.ts explains why).
// When the provider moves, that record is the only thing that changes. The normal
// way to change it is Settings in the app (functions/api/provider.ts). This is the
// status check, and the fallback for when the app itself is the problem.
//
//   node tools/provider.mjs                 # status: DNS, port, account, m3u_url
//   node tools/provider.mjs 203.0.113.7     # point iptv.krutofv.se at a new IP
//   node tools/provider.mjs new-panel.xyz   # …or at a new provider hostname (CNAME)
//   node tools/provider.mjs --m3u           # move m3u_url in D1 onto iptv.krutofv.se
//
// Needs CF_DNS_TOKEN (Zone · DNS · Edit on krutofv.se, the same key as the Pages
// secret) for the two forms that move the record.
// Read from the environment, .env.local, or ../hemma/.env. Credentials are never
// printed.

import dns from 'node:dns'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..')
const HOST = 'iptv.krutofv.se' // keep in step with src/lib/provider.ts
const ZONE_ID = 'e6588d30dac73e39ada17f6eddc943e3' // krutofv.se; the DNS template cannot list zones
const APP = 'https://streamforest.krutofv.se'

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* not there — rely on what else is set */ }
}
loadEnv(path.join(REPO, '.env.local'))
loadEnv(path.join(REPO, '..', 'hemma', '.env'))

async function cf(method, p, body) {
  const token = process.env.CF_DNS_TOKEN
  if (!token) throw new Error('CF_DNS_TOKEN is not set (environment, .env.local or ../hemma/.env)')
  const res = await fetch(`https://api.cloudflare.com/client/v4${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!json.success) throw new Error(`Cloudflare ${method} ${p}: ${JSON.stringify(json.errors)}`)
  return json.result
}

async function getM3uUrl() {
  const res = await fetch(`${APP}/api/preferences?profileId=_global`)
  if (!res.ok) throw new Error(`preferences: HTTP ${res.status}`)
  return (await res.json()).m3u_url ?? null
}

function tcpOpen(host, port, ms = 5000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (ok) => { s.destroy(); resolve(ok) }
    s.setTimeout(ms, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

async function resolvePublic(name) {
  const r = new dns.promises.Resolver()
  r.setServers(['1.1.1.1'])
  try { return await r.resolve4(name) } catch { return [] }
}

async function pointAt(target) {
  const isIp = net.isIPv4(target)
  const zone = { id: ZONE_ID }
  const existing = await cf('GET', `/zones/${zone.id}/dns_records?name=${HOST}`)
  const record = { type: isIp ? 'A' : 'CNAME', name: HOST, content: target, ttl: 60, proxied: false,
    comment: 'IPTV provider. Change with streamforest/tools/provider.mjs' }
  // A type change (A ↔ CNAME) cannot be an edit: remove the old record first.
  for (const r of existing) {
    if (r.type !== record.type) await cf('DELETE', `/zones/${zone.id}/dns_records/${r.id}`)
  }
  const same = existing.find((r) => r.type === record.type)
  if (same) await cf('PUT', `/zones/${zone.id}/dns_records/${same.id}`, record)
  else await cf('POST', `/zones/${zone.id}/dns_records`, record)
  console.log(`${HOST} → ${target} (${record.type}, DNS only, TTL 60)`)
}

async function moveM3u() {
  const current = await getM3uUrl()
  if (!current) throw new Error('No m3u_url in D1 — set one in Settings first')
  const u = new URL(current)
  if (u.hostname === HOST) { console.log(`m3u_url already on ${HOST}`); return }
  const from = u.host
  u.hostname = HOST
  const res = await fetch(`${APP}/api/preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: '_global', key: 'm3u_url', value: u.toString() }),
  })
  if (!res.ok) throw new Error(`preferences PUT: HTTP ${res.status}`)
  console.log(`m3u_url: ${from} → ${u.host}. Devices pick it up on their next start.`)
}

async function status() {
  const ips = await resolvePublic(HOST)
  console.log(`DNS      ${HOST} → ${ips.join(', ') || 'no address'}`)
  const m3u = await getM3uUrl()
  if (!m3u) { console.log('m3u_url  not set'); return }
  const u = new URL(m3u)
  const port = Number(u.port) || 80
  console.log(`m3u_url  host ${u.host}${u.hostname === HOST ? '' : `  ← not on ${HOST}; run --m3u`}`)
  const open = await tcpOpen(HOST, port)
  console.log(`port     ${HOST}:${port} ${open ? 'open' : 'NO ANSWER'}`)
  if (!open) return
  const api = new URL('/player_api.php', `http://${HOST}:${port}`)
  api.searchParams.set('username', u.searchParams.get('username') ?? '')
  api.searchParams.set('password', u.searchParams.get('password') ?? '')
  try {
    const res = await fetch(api, { signal: AbortSignal.timeout(15000) })
    const info = await res.json()
    const ui = info.user_info ?? {}
    const exp = ui.exp_date ? new Date(Number(ui.exp_date) * 1000).toISOString().slice(0, 10) : '—'
    console.log(`account  auth=${ui.auth} status=${ui.status ?? '—'} expires=${exp}`)
    if (info.server_info?.url) console.log(`panel    calls itself ${info.server_info.url}:${info.server_info.port}`)
  } catch (e) {
    console.log(`account  no answer from player_api.php (${e.message})`)
  }
}

const arg = process.argv[2]
try {
  if (!arg) await status()
  else if (arg === '--m3u') { await moveM3u(); await status() }
  else { await pointAt(arg); await status() }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
