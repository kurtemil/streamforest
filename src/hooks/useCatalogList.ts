import { useEffect, useMemo, useState } from 'react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { isVisible, useActiveExclusions } from '@/hooks/useActiveExclusions'
import { buildMovieIndex, buildShowIndex, matchMovies, matchShows } from '@/lib/catalogMatch'
import type { TmdbListItem } from '@/services/tmdb'
import type { TmdbMeta } from '@/types'

/** A list item dressed as cached metadata, so the ordinary cards can show it. */
export function listItemMeta(item: TmdbListItem, id: string, contentType: 'movie' | 'tv'): TmdbMeta {
  return {
    id, contentType, tmdbId: item.tmdbId, title: item.title, overview: item.overview,
    posterPath: item.posterPath, backdropPath: item.backdropPath, year: item.year,
    rating: item.rating, ratingCount: 0, genres: [], runtime: null, cast: [],
    director: null, similar: [], cachedAt: Date.now(),
  }
}

/**
 * Loads a TMDB list once per `key` and keeps the part of it this profile can play.
 * `load` null means "no list" (nothing chosen yet). `loading` is true until the
 * list has arrived; an empty result after that is a real "none of these are here".
 */
function useList(load: (() => Promise<TmdbListItem[]>) | null, key: string) {
  const [items, setItems] = useState<TmdbListItem[] | null>(null)
  useEffect(() => {
    if (!load) { setItems(null); return }
    let alive = true
    setItems(null)
    load().then((r) => { if (alive) setItems(r) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
    // The key names the list; `load` is a fresh closure on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return items
}

export function useCatalogMovies(load: (() => Promise<TmdbListItem[]>) | null, key: string) {
  const channels = usePlaylistStore((s) => s.channels)
  const excluded = useActiveExclusions()
  const items = useList(load, key)
  const index = useMemo(() => buildMovieIndex(channels), [channels])
  const matches = useMemo(
    () => (items ? matchMovies(items, index, (ch) => isVisible(ch, excluded)) : []),
    [items, index, excluded],
  )
  return { matches, loading: Boolean(load) && items === null }
}

export function useCatalogShows(load: (() => Promise<TmdbListItem[]>) | null, key: string) {
  const channels = usePlaylistStore((s) => s.channels)
  const excluded = useActiveExclusions()
  const items = useList(load, key)
  const index = useMemo(() => buildShowIndex(channels), [channels])
  const matches = useMemo(
    () => (items ? matchShows(items, index, (ch) => isVisible(ch, excluded)) : []),
    [items, index, excluded],
  )
  return { matches, loading: Boolean(load) && items === null }
}
