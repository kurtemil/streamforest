import type { Channel, ContentType } from '@/types'

interface SeriesPattern {
  re: RegExp
  apply(m: RegExpMatchArray): { showName: string; season: number; episode: number; episodeTitle?: string }
}

// Patterns ordered by specificity — first match wins.
// normalizeSeriesName() runs before matching, so all patterns can assume:
//   - HTML entities decoded
//   - dot separators replaced with spaces
//   - letter-O in S/E codes corrected
//   - trailing quality tags stripped
//   - "(Title)" at end converted to "- Title"
//   - multi-episode suffixes (E01&02, E01-02) reduced to first episode
const SERIES_PATTERNS: SeriesPattern[] = [
  // "Show S01 Show - S01E02 - Title"  (most common IPTV format)
  {
    re: /^(.+?)\s+S(\d+)\s+.+\s+-\s+S\d+E(\d+)(?:\s+-\s+(.+))?$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: +m[3], episodeTitle: m[4]?.trim() }),
  },
  // "Show S01 Show S01E02"  (no dash before episode)
  {
    re: /^(.+?)\s+S(\d+)\s+\S.*\s+S\d+E(\d+)(?:\s+-\s+(.+))?$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: +m[3], episodeTitle: m[4]?.trim() }),
  },
  // "Show - S01E02 - Title"
  {
    re: /^(.+?)\s+-\s+S(\d+)E(\d+)(?:\s+-\s+(.+))?$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: +m[3], episodeTitle: m[4]?.trim() }),
  },
  // "Show S01E02 - Title"
  {
    re: /^(.+?)\s+S(\d+)E(\d+)(?:\s+-\s+(.+))?$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: +m[3], episodeTitle: m[4]?.trim() }),
  },
  // "Show S01 E02 - Title"  (space between S and E)
  {
    re: /^(.+?)\s+S(\d+)\s+E(\d+)(?:\s+-\s+(.+))?$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: +m[3], episodeTitle: m[4]?.trim() }),
  },
  // "Show E01 - Title"  (episode-only, no season → default season 1)
  // Requires 2+ digit episode number to avoid false-matching show names like "Channel E4"
  {
    re: /^(.+?)\s+E(\d{2,})(?:\s+-\s+(.+))?\s*$/,
    apply: m => ({ showName: m[1].trim(), season: 1, episode: +m[2], episodeTitle: m[3]?.trim() }),
  },
  // "Show S01"  (season-only, no episode number → default episode 1)
  {
    re: /^(.+?)\s+S(\d+)$/,
    apply: m => ({ showName: m[1].trim(), season: +m[2], episode: 1 }),
  },
]

const YEAR_RE = /\[(\d{4})\]/g
const EP_ONLY_RE = /^EP(\d+)(?:\s+-\s+(.+))?$/i

// Compiled once. This used to build a fresh RegExp on every call, which is four
// per entry — 800 000 constructions for a 200 000-line playlist, all producing
// one of three patterns.
const ATTR_RE: Record<string, RegExp> = {
  'tvg-logo': /tvg-logo="([^"]*)"/i,
  'group-title': /group-title="([^"]*)"/i,
  'tvg-id': /tvg-id="([^"]*)"/i,
}

function attr(line: string, key: keyof typeof ATTR_RE): string {
  const m = line.match(ATTR_RE[key])
  return m ? m[1] : ''
}

// The display title is everything after the attribute list — that is, after the
// first comma that is not inside a quoted attribute value.
//
// Taking the *last* comma instead looks equivalent until a title contains one:
// "Love, Victor" and "CBS Kiro (Seattle,WA) HD US" both got truncated to their
// final fragment, which split those shows away from their own episodes. 2 073 of
// the 205 803 entries in the production playlist are affected.
function displayName(metaLine: string): string {
  let inQuotes = false
  for (let i = 0; i < metaLine.length; i++) {
    const ch = metaLine[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) return metaLine.slice(i + 1).trim()
  }
  return ''
}

function detectType(groupTitle: string, url: string): ContentType {
  if (groupTitle.startsWith('VOD:')) return 'movie'
  if (groupTitle.startsWith('Series:')) return 'series'
  if (url.includes('/movie/')) return 'movie'
  if (url.includes('/series/')) return 'series'
  return 'live'
}

function parseMovieTitle(name: string): { movieTitle: string; year?: number } {
  let year: number | undefined
  const matches = [...name.matchAll(YEAR_RE)]
  if (matches.length > 0) year = parseInt(matches[matches.length - 1][1])
  const movieTitle = name
    .replace(/\s*\[PRE\]\s*/gi, ' ')
    .replace(/\s*\[\d{4}\]\s*/g, ' ')
    .trim()
  return { movieTitle, year }
}

function normalizeSeriesName(name: string): string {
  return name
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/(?<=\w)\.(?=\w)/g, ' ')         // dot separators: Show.S01E02 → Show S01E02
    .replace(/E(\d+)[-&]E?\d+/gi, 'E$1')      // multi-episode: E01&02 / E01-E02 → E01
    .replace(/\bS[Oo](\d+)/g, 'S0$1')         // letter-O typo: SO1E02 → S01E02
    .replace(/\s+\(([^)]+)\)\s*$/, ' - $1')   // trailing (Title) → - Title  (must run before dash-strip)
    .replace(/\s+-\s*$/, '')                   // trailing " -" or " - "
    .replace(/\s+\b(SE|EN|HD|FHD|SD|4K|HDR|HEVC|x265|x264|720p|1080p|2160p)\b\s*$/i, '')
    .trim()
}

function parseSeries(name: string) {
  const n = normalizeSeriesName(name)
  for (const { re, apply } of SERIES_PATTERNS) {
    const m = n.match(re)
    if (m) return apply(m)
  }
  return null
}

// IDs are prefixed with content type to prevent collisions across categories.
// IPTV providers use independent ID namespaces per stream type.
function makeId(url: string, type: ContentType): string {
  const m = url.match(/\/(\d+)(?:\.mkv)?$/)
  const numericId = m ? m[1] : encodeURIComponent(url)
  const prefix = type === 'movie' ? 'm' : type === 'series' ? 's' : 'l'
  return `${prefix}_${numericId}`
}

/**
 * Incremental parser.
 *
 * A playlist is 60 MB and arrives as a stream, so nothing should have to hold
 * all of it: `push` takes whatever lines have arrived and returns the entries
 * completed by them, carrying the half-finished one over to the next call.
 * `parseM3ULines` below is the same thing in one shot, for tests and callers
 * with the whole file already in hand.
 */
export function createM3UParser() {
  let pendingMeta: string | null = null
  let sortIndex = 0

  return {
    push(lines: string[]): Channel[] {
      const out: Channel[] = []
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue

        if (line.startsWith('#EXTINF:')) {
          pendingMeta = line
          continue
        }
        if (!pendingMeta || line.startsWith('#')) continue

        const metaLine = pendingMeta
        pendingMeta = null
        const channel = buildChannel(metaLine, line, sortIndex)
        if (channel) {
          out.push(channel)
          sortIndex++
        }
      }
      return out
    },
  }
}

/** One EXTINF line plus its URL, or null for the rows that are only headings. */
function buildChannel(metaLine: string, url: string, sortIndex: number): Channel | null {
  const name = displayName(metaLine)
  const logo = attr(metaLine, 'tvg-logo')
  const groupTitle = attr(metaLine, 'group-title')
  const tvgId = attr(metaLine, 'tvg-id')

  if (name.startsWith('-=') && name.endsWith('=-')) return null

  const type = detectType(groupTitle, url)
  const id = makeId(url, type)
  const base: Channel = { id, name, url, logo, groupTitle, type, sortIndex, ...(tvgId ? { tvgId } : {}) }

  if (type === 'series') {
    let parsed = parseSeries(name)
    // Fallback: "EP01 - Title" with no show name — group under a placeholder
    // keyed by group, so the episodes at least stay together.
    if (!parsed) {
      const epOnly = EP_ONLY_RE.exec(normalizeSeriesName(name))
      if (epOnly) {
        const cleanGroup = groupTitle.replace(/^Series:\s*/i, '').trim()
        parsed = {
          showName: cleanGroup ? `Unknown (${cleanGroup})` : 'Unknown',
          season: 1,
          episode: parseInt(epOnly[1]),
          episodeTitle: epOnly[2]?.trim(),
        }
      }
    }
    return parsed ? { ...base, ...parsed } : base
  }
  if (type === 'movie') {
    const { movieTitle, year } = parseMovieTitle(name)
    return { ...base, movieTitle, year }
  }
  return base
}

export function parseM3ULines(lines: string[]): Channel[] {
  return createM3UParser().push(lines)
}
