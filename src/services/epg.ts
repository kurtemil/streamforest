import type { EpgProgram } from '@/types'
import { proxyUrl } from './fetcher'

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

// ── Main fetch function ────────────────────────────────────────────────────────

/**
 * Streams the XMLTV response and parses <programme> elements incrementally.
 * The file can be 50MB+, so we never load it all into memory — we process
 * each complete <programme>...</programme> block as it arrives and discard it.
 */
export async function fetchAndParseEpg(
  m3uUrl: string,
  onProgress?: (count: number) => void,
): Promise<EpgProgram[]> {
  const epgUrl = epgUrlFromM3u(m3uUrl)
  if (!epgUrl) throw new Error('Cannot derive EPG URL — M3U URL must contain username & password params')

  const res = await fetch(proxyUrl(epgUrl))
  if (!res.ok) throw new Error(`EPG fetch failed with status ${res.status}`)
  if (!res.body) throw new Error('EPG response had no body')

  const now      = Date.now()
  const keepFrom = now - 2  * 60 * 60 * 1000  // 2 h back  (current show)
  const keepTo   = now + 7  * 24 * 60 * 60 * 1000  // 7 days forward

  const reader  = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer    = ''
  const programs: EpgProgram[] = []
  let processed = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Find and process every complete <programme>...</programme> in the current buffer
    let searchFrom = 0
    while (true) {
      const openIdx = buffer.indexOf('<programme', searchFrom)
      if (openIdx === -1) break
      const closeIdx = buffer.indexOf('</programme>', openIdx)
      if (closeIdx === -1) break   // block not yet complete — wait for next chunk

      const block = buffer.slice(openIdx, closeIdx + 12 /* </programme> */)
      const prog  = parseProgrammeBlock(block)
      if (prog && prog.end >= keepFrom && prog.start <= keepTo) {
        programs.push(prog)
        processed++
        if (processed % 500 === 0) onProgress?.(processed)
      }
      searchFrom = closeIdx + 12
    }

    // Discard everything up to the last processed close tag; keep the tail
    // (which may contain the beginning of the next <programme> block).
    if (searchFrom > 0) {
      buffer = buffer.slice(searchFrom)
    }

    // Safety valve: if the buffer somehow grows past 1 MB without a closing tag
    // (e.g. a very long <desc>), skip forward to the next opening tag.
    if (buffer.length > 1_000_000) {
      const next = buffer.indexOf('<programme', 1)
      buffer = next !== -1 ? buffer.slice(next) : ''
    }
  }

  onProgress?.(programs.length)
  return programs
}
