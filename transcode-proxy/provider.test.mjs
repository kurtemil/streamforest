// node --test transcode-proxy/provider.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProviderFailover } from './provider.mjs'

const HOST = 'iptv.krutofv.se'

/** A provider whose IPs are up or down as `up` says, plus Pages and Cloudflare. */
function world({ ips, target, up }) {
  const dns = []
  const config = { ips, port: 80, target }
  const fetchImpl = async (url, init = {}) => {
    const u = String(url)
    const json = (body) => ({ ok: true, json: async () => body })
    if (u === 'https://pages.test/api/provider') return json(config)
    if (u.startsWith('https://api.cloudflare.com/')) {
      if ((init.method ?? 'GET') === 'GET') return json({ result: [{ id: 'r1' }] })
      dns.push({ method: init.method, ...JSON.parse(init.body) })
      return json({ success: true })
    }
    const ip = new URL(u).hostname
    if (up.has(ip)) return { ok: true, status: 404 } // any answer counts
    throw new TypeError('fetch failed')
  }
  const log = []
  const failover = createProviderFailover({
    host: HOST, configUrl: 'https://pages.test/api/provider', zoneId: 'z', token: 't',
    fetchImpl, log: (l) => log.push(l),
  })
  return { failover, dns, config, log, fetch: fetchImpl }
}

test('a working active address is left alone', async () => {
  const w = world({ ips: ['1.1.1.1', '2.2.2.2'], target: '1.1.1.1', up: new Set(['1.1.1.1', '2.2.2.2']) })
  await w.failover.check()
  assert.equal(w.failover.status().active, '1.1.1.1')
  assert.equal(w.dns.length, 0)
})

test('a dead active address moves to the next that answers, in the admin\'s order', async () => {
  const w = world({
    ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'], target: '1.1.1.1', up: new Set(['3.3.3.3', '4.4.4.4']),
  })
  await w.failover.check()
  assert.equal(w.failover.status().active, '3.3.3.3')
  assert.deepEqual(w.dns, [{ method: 'PUT', type: 'A', name: HOST, content: '3.3.3.3', ttl: 60, proxied: false,
    comment: 'IPTV provider. Moved automatically by transcode-proxy/provider.mjs' }])
  assert.equal(w.failover.status().checks['2.2.2.2'].ok, false)
  assert.match(w.log[0], /1\.1\.1\.1 did not answer; switched to 3\.3\.3\.3/)
})

test('this server connects to the active IP at once; other URLs are untouched', async () => {
  const w = world({ ips: ['1.1.1.1', '2.2.2.2'], target: '1.1.1.1', up: new Set(['2.2.2.2']) })
  assert.equal(w.failover.resolve(`http://${HOST}:2095/movie/u/p/1.mkv`), `http://${HOST}:2095/movie/u/p/1.mkv`,
    'before the first check nothing is known, so the name is used')
  await w.failover.check()
  assert.equal(w.failover.resolve(`http://${HOST}:2095/movie/u/p/1.mkv`), 'http://2.2.2.2:2095/movie/u/p/1.mkv')
  assert.equal(w.failover.resolve('http://example.com/x'), 'http://example.com/x')
})

test('it stays on a working address when an earlier one recovers', async () => {
  const up = new Set(['2.2.2.2'])
  const w = world({ ips: ['1.1.1.1', '2.2.2.2'], target: '1.1.1.1', up })
  await w.failover.check()
  up.add('1.1.1.1')
  await w.failover.check()
  assert.equal(w.failover.status().active, '2.2.2.2')
  assert.equal(w.dns.length, 1)
})

test('when nothing answers it stays put and says so', async () => {
  const w = world({ ips: ['1.1.1.1', '2.2.2.2'], target: '1.1.1.1', up: new Set() })
  await w.failover.check()
  assert.equal(w.failover.status().active, '1.1.1.1')
  assert.equal(w.dns.length, 0)
  assert.match(w.log.at(-1), /no address answers/)
})

test('a new list from the admin replaces an active address that is no longer on it', async () => {
  const w = world({ ips: ['1.1.1.1'], target: '1.1.1.1', up: new Set(['1.1.1.1', '9.9.9.9']) })
  await w.failover.check()
  w.config.ips = ['9.9.9.9']
  w.config.target = '9.9.9.9'
  await w.failover.check()
  assert.equal(w.failover.status().active, '9.9.9.9')
})

test('overlapping triggers share one check', async () => {
  const w = world({ ips: ['1.1.1.1', '2.2.2.2'], target: '1.1.1.1', up: new Set(['2.2.2.2']) })
  await Promise.all([w.failover.check(), w.failover.check(), w.failover.reportFailure()])
  assert.equal(w.dns.length, 1)
})

test('while nothing answers it tries only the active address, and all four at most every 30 minutes', async () => {
  let t = 1_000_000
  const tried = []
  const w = world({ ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3'], target: '1.1.1.1', up: new Set() })
  const failover = createProviderFailover({
    host: HOST, configUrl: 'https://pages.test/api/provider', zoneId: 'z', token: 't', now: () => t, log: () => {},
    fetchImpl: async (url, init) => { const u = String(url); if (u.startsWith('http://')) tried.push(new URL(u).hostname); return w.fetch(url, init) },
  })
  await failover.check()
  assert.deepEqual(tried, ['1.1.1.1', '2.2.2.2', '3.3.3.3'])
  tried.length = 0; t += 10 * 60_000
  await failover.check()
  assert.deepEqual(tried, ['1.1.1.1'], 'ten minutes later: only the active one')
  tried.length = 0; t += 25 * 60_000
  await failover.check()
  assert.deepEqual(tried, ['1.1.1.1', '2.2.2.2', '3.3.3.3'], 'past thirty minutes: all of them again')
})
