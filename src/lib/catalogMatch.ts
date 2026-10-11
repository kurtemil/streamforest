import type { Channel, ContentType } from '@/types'
import type { TmdbListItem } from '@/services/tmdb'
import { normalizeShowKey } from '@/lib/utils'

/**
 * Matching TMDB lists ("popular this week", "comedies") to what the catalogue
 * actually has, so a rail only ever shows titles that can be played.
 *
 * A title is compared on a key that ignores case, accents, punctuation and a
 * leading "The", against both TMDB's localised and original title. A year, when
 * both sides have one, must agree within one (release dates differ by country).
 */
export function titleKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

export type Visible = (ch: { type: ContentType; groupTitle: string }) => boolean

export function buildMovieIndex(channels: Channel[]): Map<string, Channel[]> {
  const index = new Map<string, Channel[]>()
  for (const ch of channels) {
    if (ch.type !== 'movie') continue
    const key = titleKey(ch.movieTitle ?? ch.name)
    if (!key) continue
    const list = index.get(key)
    if (list) list.push(ch)
    else index.set(key, [ch])
  }
  return index
}

/** One playable film per list item, in the list's order, never the same one twice. */
export function matchMovies(items: TmdbListItem[], index: Map<string, Channel[]>, visible: Visible): { channel: Channel; item: TmdbListItem }[] {
  const out: { channel: Channel; item: TmdbListItem }[] = []
  const used = new Set<string>()
  for (const item of items) {
    const keys = new Set([titleKey(item.originalTitle), titleKey(item.title)].filter(Boolean))
    let found: Channel | undefined
    for (const key of keys) {
      found = index.get(key)?.find((ch) =>
        visible(ch) && !used.has(ch.id) && (!ch.year || !item.year || Math.abs(ch.year - item.year) <= 1),
      )
      if (found) break
    }
    if (found) { used.add(found.id); out.push({ channel: found, item }) }
  }
  return out
}

/** Show key (as the Series page uses it) for each title key, with one episode to stand for it. */
export function buildShowIndex(channels: Channel[]): Map<string, Channel> {
  const index = new Map<string, Channel>()
  for (const ch of channels) {
    if (ch.type !== 'series' || !ch.showName) continue
    const key = titleKey(ch.showName)
    if (key && !index.has(key)) index.set(key, ch)
  }
  return index
}

export function matchShows(items: TmdbListItem[], index: Map<string, Channel>, visible: Visible): { channel: Channel; showKey: string; item: TmdbListItem }[] {
  const out: { channel: Channel; showKey: string; item: TmdbListItem }[] = []
  const used = new Set<string>()
  for (const item of items) {
    for (const key of [titleKey(item.originalTitle), titleKey(item.title)]) {
      const ch = key ? index.get(key) : undefined
      if (!ch || !visible(ch)) continue
      const showKey = normalizeShowKey(ch.showName ?? ch.name)
      if (used.has(showKey)) break
      used.add(showKey)
      out.push({ channel: ch, showKey, item })
      break
    }
  }
  return out
}
