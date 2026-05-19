import type { EpgProgram } from '@/types'
import { proxyUrl } from './fetcher'
import { epgProxyUrl } from '@/lib/transcode'

/** Derive the XMLTV EPG URL from an Xtream Codes M3U URL. */
export function epgUrlFromM3u(m3uUrl: string): string | null {
  try {
    const u = new URL(m3uUrl)
    const username = u.searchParams.get('username')
    const password = u.searchParams.get('password')
    if (!username || !password) return null
    const epg = new URL(`${u.protocol}//${u.host}/xmltv.php`)
    epg.searchParams.set('username', username)
    epg.searchParams.set('password', password)
    return epg.toString()
  } catch {
    return null
  }
}

/** Normalize a channel display-name for fuzzy matching: strip decorators, lowercase. */
export function normalizeChannelName(name: string): string {
  return name
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ── XMLTV timestamp parser ─────────────────────────────────────────────────────

function parseXmltvTime(ts: string): number {
  // "20240507120000 +0200"  or  "20240507120000 +0000"
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/)
  if (!m) return 0
  const [, year, month, day, hour, min, sec, tz = '+0000'] = m
  const sign = tz[0] === '-' ? -1 : 1
  const tzH  = parseInt(tz.slice(1, 3))
  const tzM  = parseInt(tz.slice(3, 5))
  const tzOffsetMs = sign * (tzH * 60 + tzM) * 60 * 1000
  return Date.UTC(+year, +month - 1, +day, +hour, +min, +sec) - tzOffsetMs
}

// ── Streaming XML attribute/tag helpers ────────────────────────────────────────

function extractAttr(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))
  return m ? m[1] : ''
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : ''
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const results: string[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim()
    if (text) results.push(text)
  }
  return results
}

function parseProgrammeBlock(block: string): EpgProgram | null {
  const headerEnd = block.indexOf('>')
  if (headerEnd === -1) return null
  const attrs = block.slice('<programme'.length, headerEnd)

  const channelId = extractAttr(attrs, 'channel')
  const startStr  = extractAttr(attrs, 'start')
  const stopStr   = extractAttr(attrs, 'stop')
  if (!channelId || !startStr || !stopStr) return null

  const start = parseXmltvTime(startStr)
  const end   = parseXmltvTime(stopStr)
  if (!start || !end || end <= start) return null

  const title = extractTag(block, 'title')
  if (!title) return null

  const description = extractTag(block, 'desc') || undefined
  const category    = extractTag(block, 'category') || undefined

  return { id: `${channelId}_${start}`, channelId, title, start, end, description, category }
}

function parseChannelBlock(block: string): { id: string; names: string[] } | null {
  const headerEnd = block.indexOf('>')
  if (headerEnd === -1) return null
  const attrs = block.slice('<channel'.length, headerEnd)
  const id = extractAttr(attrs, 'id')
  if (!id) return null
  const names = extractAllTags(block, 'display-name')
  if (names.length === 0) return null
  return { id, names }
}

// ── Main fetch function ────────────────────────────────────────────────────────

/**
 * Streams the XMLTV response and parses <channel> and <programme> elements
 * incrementally. The file can be 50MB+, so we never load it all into memory.
 * Returns both the program list and a normalizedName→channelId map built from
 * <channel> display-names, used as a fallback when M3U channels have no tvg-id.
 */
export async function fetchAndParseEpg(
  epgUrl: string,
  force = false,
  onProgress?: (count: number) => void,
): Promise<{ programs: EpgProgram[]; displayNameMap: Map<string, string> }> {
  // Prefer the transcode-proxy /epg endpoint (server-side cache, no CF timeout)
  const fetchUrl = epgProxyUrl(epgUrl, force) ?? proxyUrl(epgUrl)
  const res = await fetch(fetchUrl)
  if (!res.ok) throw new Error(`EPG fetch failed with status ${res.status}`)
  if (!res.body) throw new Error('EPG response had no body')

  const now      = Date.now()
  const keepFrom = now - 2  * 60 * 60 * 1000  // 2 h back  (current show)
  const keepTo   = now + 7  * 24 * 60 * 60 * 1000  // 7 days forward

  const reader  = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer    = ''
  const programs: EpgProgram[] = []
  const displayNameMap = new Map<string, string>() // normalizedName → channelId
  let processed = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let searchFrom = 0
    while (true) {
      const chIdx = buffer.indexOf('<channel ', searchFrom)
      const prIdx = buffer.indexOf('<programme', searchFrom)

      if (chIdx === -1 && prIdx === -1) break

      if (chIdx !== -1 && (prIdx === -1 || chIdx < prIdx)) {
        // Process <channel> block first (it appears before <programme> in XMLTV)
        const closeIdx = buffer.indexOf('</channel>', chIdx)
        if (closeIdx === -1) break  // incomplete — wait for next chunk
        const block = buffer.slice(chIdx, closeIdx + 10 /* </channel> */)
        const ch = parseChannelBlock(block)
        if (ch) {
          for (const name of ch.names) {
            displayNameMap.set(normalizeChannelName(name), ch.id)
          }
        }
        searchFrom = closeIdx + 10
      } else {
        // Process <programme> block
        const openIdx = prIdx!
        const closeIdx = buffer.indexOf('</programme>', openIdx)
        if (closeIdx === -1) break  // incomplete — wait for next chunk
        const block = buffer.slice(openIdx, closeIdx + 12 /* </programme> */)
        const prog  = parseProgrammeBlock(block)
        if (prog && prog.end >= keepFrom && prog.start <= keepTo) {
          programs.push(prog)
          processed++
          if (processed % 500 === 0) onProgress?.(processed)
        }
        searchFrom = closeIdx + 12
      }
    }

    if (searchFrom > 0) {
      buffer = buffer.slice(searchFrom)
    }

    // Safety valve: skip past a stuck block larger than 1 MB
    if (buffer.length > 1_000_000) {
      const nextCh = buffer.indexOf('<channel ', 1)
      const nextPr = buffer.indexOf('<programme', 1)
      const next = nextCh !== -1 && (nextPr === -1 || nextCh < nextPr) ? nextCh : nextPr
      buffer = next !== -1 ? buffer.slice(next) : ''
    }
  }

  onProgress?.(programs.length)
  return { programs, displayNameMap }
}
