import { useEffect, useMemo, useState } from 'react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { isVisible, useActiveExclusions } from '@/hooks/useActiveExclusions'
import { buildMovieIndex, buildShowIndex, matchMovies, matchShows } from '@/lib/catalogMatch'
import { fetchGenres, fetchRelated, fetchTrending, type TmdbListItem } from '@/services/tmdb'
import { useLocale } from '@/lib/i18n'
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

/**
 * Films TMDB relates to this one (`fetchRelated`) that this profile can play here.
 * `tmdbId` null means none to ask about; the result is then empty.
 */
export function useRelatedMovies(tmdbId: number | null) {
  const locale = useLocale()
  return useCatalogMovies(
    tmdbId ? () => fetchRelated('movie', tmdbId, locale) : null,
    tmdbId ? `related-movie-${tmdbId}@${locale}` : 'none',
  )
}

/** Shows TMDB relates to this one that this profile can play here. */
export function useRelatedShows(tmdbId: number | null) {
  const locale = useLocale()
  return useCatalogShows(
    tmdbId ? () => fetchRelated('tv', tmdbId, locale) : null,
    tmdbId ? `related-tv-${tmdbId}@${locale}` : 'none',
  )
}

/** At most this many slides: a hero is a few highlights, not a second rail. */
const HERO_SLIDES = 8

/**
 * Hero slides from what is popular this week and in the catalogue. Titles with
 * a landscape backdrop come first, because that is what a hero is made of; genre
 * names are filled in from TMDB's genre list.
 */
export function useHeroItems(kind: 'movie' | 'tv' | 'both') {
  const locale = useLocale()
  const wantMovies = kind !== 'tv'
  const wantShows = kind !== 'movie'
  const movies = useCatalogMovies(wantMovies ? () => fetchTrending('movie', locale) : null, wantMovies ? `trending-movie@${locale}` : 'none')
  const shows = useCatalogShows(wantShows ? () => fetchTrending('tv', locale) : null, wantShows ? `trending-tv@${locale}` : 'none')
  const [genreNames, setGenreNames] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    let alive = true
    Promise.all([fetchGenres('movie', locale), fetchGenres('tv', locale)]).then(([a, b]) => {
      if (alive) setGenreNames(new Map([...a, ...b].map((g) => [g.id, g.name])))
    })
    return () => { alive = false }
  }, [locale])

  return useMemo(() => {
    const dress = (item: TmdbListItem, id: string, type: 'movie' | 'tv') => ({
      ...listItemMeta(item, id, type),
      genres: item.genreIds.map((g) => genreNames.get(g)).filter((g): g is string => Boolean(g)),
    })
    const m = movies.matches.map(({ channel, item }) => ({ channel, tmdbMeta: dress(item, channel.id, 'movie'), showKey: null as string | null }))
    const s = shows.matches.map(({ channel, showKey, item }) => ({ channel, tmdbMeta: dress(item, showKey, 'tv'), showKey: showKey as string | null }))
    // Home alternates films and shows; each list keeps TMDB's order.
    const mixed: typeof m = []
    for (let i = 0; i < Math.max(m.length, s.length); i++) {
      if (m[i]) mixed.push(m[i])
      if (s[i]) mixed.push(s[i])
    }
    const withBackdrop = mixed.filter((x) => x.tmdbMeta.backdropPath)
    return (withBackdrop.length >= 3 ? withBackdrop : mixed).slice(0, HERO_SLIDES)
  }, [movies.matches, shows.matches, genreNames])
}
