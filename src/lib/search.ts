import { normalizeShowKey } from '@/lib/utils'
import type { Channel, ContentType } from '@/types'

export interface SearchResult {
  id: string
  title: string
  subtitle: string
  type: ContentType
  channel: Channel
}

export interface SearchResults {
  movies: SearchResult[]
  series: SearchResult[]
  live: SearchResult[]
}

function match(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * The ⌘K search over the whole catalogue, at most `perGroup` hits per kind.
 * Items in a group hidden from the profile are skipped. Search reaches every page
 * and plays straight from a result, so it must hide exactly what the pages hide.
 */
export function searchCatalogue(
  channels: Channel[],
  query: string,
  excluded: Record<ContentType, Set<string>>,
  labels: { movie: string; show: string },
  perGroup = 5,
): SearchResults {
  const q = query.trim()
  const out: SearchResults = { movies: [], series: [], live: [] }
  if (!q) return out
  const showSeen = new Set<string>()

  for (const ch of channels) {
    if (excluded[ch.type]?.has(ch.groupTitle)) continue
    if (ch.type === 'movie') {
      if (out.movies.length < perGroup) {
        const title = ch.movieTitle ?? ch.name
        if (match(title, q)) {
          out.movies.push({ id: ch.id, title, subtitle: ch.year ? String(ch.year) : labels.movie, type: 'movie', channel: ch })
        }
      }
    } else if (ch.type === 'series' && ch.showName) {
      if (out.series.length < perGroup) {
        const key = normalizeShowKey(ch.showName)
        if (!showSeen.has(key) && match(ch.showName, q)) {
          showSeen.add(key)
          out.series.push({ id: key, title: ch.showName, subtitle: labels.show, type: 'series', channel: ch })
        }
      }
    } else if (ch.type === 'live') {
      if (out.live.length < perGroup && match(ch.name, q)) {
        out.live.push({ id: ch.id, title: ch.name, subtitle: ch.groupTitle, type: 'live', channel: ch })
      }
    }
    if (out.movies.length >= perGroup && out.series.length >= perGroup && out.live.length >= perGroup) break
  }
  return out
}
