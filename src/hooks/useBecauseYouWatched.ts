import { useMemo } from 'react'
import { listItemMeta, useRelatedMovies, useRelatedShows } from '@/hooks/useCatalogList'
import { MIN_RELATED } from '@/components/home/RelatedRails'
import type { Channel, TmdbMeta } from '@/types'

/** The title a "Because you watched" row is about: a film, or a show by its key. */
export interface RecSource {
  channel: Channel
  /** channel.id for a film, the show key for a show. */
  key: string
  kind: 'movie' | 'tv'
}

export interface RecItem {
  channel: Channel
  key: string
  meta: TmdbMeta
}

/**
 * "Because you watched X", from what TMDB actually relates to X.
 *
 * It used to be a shuffle of the playlist group X was in: "VOD: English" is not a
 * reason to watch anything, and the heading claimed one. Now the row holds TMDB's
 * recommendations for X that are here and not already seen (`skip`), and when
 * fewer than four are, there is no row: an honest gap rather than a filled one.
 */
export function useBecauseYouWatched(
  source: RecSource | null,
  sourceMeta: TmdbMeta | undefined,
  skip: (key: string) => boolean,
): { title: string; items: RecItem[] } | null {
  const tmdbId = sourceMeta && !sourceMeta.notFound && sourceMeta.tmdbId ? sourceMeta.tmdbId : null
  const movies = useRelatedMovies(source?.kind === 'movie' ? tmdbId : null)
  const shows = useRelatedShows(source?.kind === 'tv' ? tmdbId : null)

  return useMemo(() => {
    if (!source || !tmdbId) return null
    const items: RecItem[] = source.kind === 'movie'
      ? movies.matches
          .filter((m) => m.channel.id !== source.key && !skip(m.channel.id))
          .map((m) => ({ channel: m.channel, key: m.channel.id, meta: listItemMeta(m.item, m.channel.id, 'movie') }))
      : shows.matches
          .filter((m) => m.showKey !== source.key && !skip(m.showKey))
          .map((m) => ({ channel: m.channel, key: m.showKey, meta: listItemMeta(m.item, m.showKey, 'tv') }))
    if (items.length < MIN_RELATED) return null
    const fallback = source.channel.movieTitle ?? source.channel.showName ?? source.channel.name
    return { title: sourceMeta?.title || fallback, items: items.slice(0, 16) }
    // `skip` is rebuilt every render; what it reads is in the other dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, tmdbId, sourceMeta?.title, movies.matches, shows.matches])
}
