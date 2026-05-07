import type { TmdbMeta, TmdbCastMember, TmdbSimilarItem } from '@/types'
import { saveTmdbMeta } from './db'

const BASE = 'https://api.themoviedb.org/3'
const IMG  = 'https://image.tmdb.org/t/p'

const BEARER = import.meta.env.VITE_TMDB_BEARER as string | undefined

// ── Image URL helpers ──────────────────────────────────────────────────────────

/** Returns a TMDB image URL for a poster at the given display width. */
export function posterUrl(path: string | null, width: 92 | 154 | 185 | 342 | 500 | 780 = 342): string | null {
  if (!path) return null
  return `${IMG}/w${width}${path}`
}

/** Returns a TMDB image URL for a backdrop. */
export function backdropUrl(path: string | null, width: 300 | 780 | 1280 | 'original' = 1280): string | null {
  if (!path) return null
  return `${IMG}/w${width}${path}`
}

/** Returns a TMDB profile image URL for cast. */
export function profileUrl(path: string | null, width: 45 | 92 | 185 | 'original' = 185): string | null {
  if (!path) return null
  return `${IMG}/w${width}${path}`
}

// ── API fetch ──────────────────────────────────────────────────────────────────

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!BEARER) return null
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('language', 'en-US')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${BEARER}`, Accept: 'application/json' },
    })
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

// ── Raw TMDB response shapes (minimal — only what we use) ──────────────────────

interface TmdbSearchResult {
  id: number
  title?: string        // movie
  name?: string         // tv
  release_date?: string // movie
  first_air_date?: string // tv
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  overview: string
  genre_ids: number[]
}

interface TmdbSearchResponse { results: TmdbSearchResult[] }

interface TmdbMovieDetail {
  id: number
  title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  release_date: string
  vote_average: number
  vote_count: number
  runtime: number | null
  genres: Array<{ id: number; name: string }>
  credits: {
    cast: Array<{ name: string; character: string; profile_path: string | null; order: number }>
    crew: Array<{ name: string; job: string; profile_path: string | null }>
  }
  similar: { results: TmdbSearchResult[] }
}

interface TmdbTVDetail {
  id: number
  name: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  first_air_date: string
  vote_average: number
  vote_count: number
  episode_run_time: number[]
  genres: Array<{ id: number; name: string }>
  credits: {
    cast: Array<{ name: string; character: string; profile_path: string | null; order: number }>
  }
  similar: { results: TmdbSearchResult[] }
}

// ── Search helpers ─────────────────────────────────────────────────────────────

/** Best-effort title normalization before searching TMDB. */
function normalizeForSearch(title: string): string {
  return title
    .replace(/^(?:[A-Z]{2,3}(?:\s*[:|]\s*|\s+\|\s*))+/, '') // strip IPTV prefixes: "SE: ", "UK | ", "US: "
    .replace(/\s*\(\d{4}\)\s*$/, '')      // trailing (2023)
    .replace(/\s*\[\d{4}\]\s*$/, '')      // trailing [2023]
    .replace(/\s*\[.*?\]\s*/g, '')        // [PRE], [HD], etc.
    .replace(/[:\-–]\s*Part\s+\d+$/i, '') // "Movie: Part 2"
    .trim()
}

/** Simple similarity score for matching search results. Higher = better. */
function matchScore(query: string, candidate: string, queryYear: number | null, candidateYear: number | null): number {
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()
  let score = 0
  if (c === q) score += 100
  else if (c.startsWith(q) || q.startsWith(c)) score += 60
  else if (c.includes(q) || q.includes(c)) score += 30
  if (queryYear && candidateYear) {
    if (queryYear === candidateYear) score += 20
    else if (Math.abs(queryYear - candidateYear) <= 1) score += 8
  }
  return score
}

// ── Public enrichment functions ────────────────────────────────────────────────

/** Fetch + cache TMDB metadata for a movie. Returns null if not found. */
export async function enrichMovie(cacheId: string, title: string, year: number | null): Promise<TmdbMeta | null> {
  const query = normalizeForSearch(title)

  const searchData = await tmdbFetch<TmdbSearchResponse>('/search/movie', {
    query,
    ...(year ? { year: String(year) } : {}),
  })

  if (!searchData?.results?.length) {
    // Try again without year constraint if year was provided
    const fallback = year
      ? await tmdbFetch<TmdbSearchResponse>('/search/movie', { query })
      : null

    if (!fallback?.results?.length) {
      await saveTmdbMeta({ id: cacheId, contentType: 'movie', tmdbId: 0, title: query, overview: '', posterPath: null, backdropPath: null, year, rating: 0, ratingCount: 0, genres: [], runtime: null, cast: [], director: null, similar: [], cachedAt: Date.now(), notFound: true })
      return null
    }
    searchData!.results = fallback!.results
  }

  // Pick best match
  const best = searchData!.results
    .map((r) => ({
      r,
      score: matchScore(query, r.title ?? r.name ?? '', year, r.release_date ? parseInt(r.release_date) : null),
    }))
    .sort((a, b) => b.score - a.score)[0]

  if (!best || best.score < 10) {
    await saveTmdbMeta({ id: cacheId, contentType: 'movie', tmdbId: 0, title: query, overview: '', posterPath: null, backdropPath: null, year, rating: 0, ratingCount: 0, genres: [], runtime: null, cast: [], director: null, similar: [], cachedAt: Date.now(), notFound: true })
    return null
  }

  const detail = await tmdbFetch<TmdbMovieDetail>(`/movie/${best.r.id}`, { append_to_response: 'credits,similar' })
  if (!detail) return null

  const cast: TmdbCastMember[] = (detail.credits?.cast ?? [])
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)
    .map((m) => ({ name: m.name, character: m.character, profilePath: m.profile_path }))

  const director = detail.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null

  const similar: TmdbSimilarItem[] = (detail.similar?.results ?? []).slice(0, 8).map((s) => ({
    tmdbId: s.id,
    title: s.title ?? s.name ?? '',
    posterPath: s.poster_path,
    year: s.release_date ? parseInt(s.release_date) : null,
  }))

  const meta: TmdbMeta = {
    id: cacheId,
    contentType: 'movie',
    tmdbId: detail.id,
    title: detail.title,
    overview: detail.overview,
    posterPath: detail.poster_path,
    backdropPath: detail.backdrop_path,
    year: detail.release_date ? parseInt(detail.release_date) : year,
    rating: Math.round(detail.vote_average * 10) / 10,
    ratingCount: detail.vote_count,
    genres: detail.genres.map((g) => g.name),
    runtime: detail.runtime ?? null,
    cast,
    director,
    similar,
    cachedAt: Date.now(),
  }

  await saveTmdbMeta(meta)
  return meta
}

/** Fetch + cache TMDB metadata for a TV show. Returns null if not found. */
export async function enrichTV(cacheId: string, showName: string): Promise<TmdbMeta | null> {
  const query = normalizeForSearch(showName)

  const searchData = await tmdbFetch<TmdbSearchResponse>('/search/tv', { query })
  if (!searchData?.results?.length) {
    await saveTmdbMeta({ id: cacheId, contentType: 'tv', tmdbId: 0, title: query, overview: '', posterPath: null, backdropPath: null, year: null, rating: 0, ratingCount: 0, genres: [], runtime: null, cast: [], director: null, similar: [], cachedAt: Date.now(), notFound: true })
    return null
  }

  const best = searchData.results
    .map((r) => ({ r, score: matchScore(query, r.name ?? r.title ?? '', null, null) }))
    .sort((a, b) => b.score - a.score)[0]

  if (!best || best.score < 10) {
    await saveTmdbMeta({ id: cacheId, contentType: 'tv', tmdbId: 0, title: query, overview: '', posterPath: null, backdropPath: null, year: null, rating: 0, ratingCount: 0, genres: [], runtime: null, cast: [], director: null, similar: [], cachedAt: Date.now(), notFound: true })
    return null
  }

  const detail = await tmdbFetch<TmdbTVDetail>(`/tv/${best.r.id}`, { append_to_response: 'credits,similar' })
  if (!detail) return null

  const cast: TmdbCastMember[] = (detail.credits?.cast ?? [])
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)
    .map((m) => ({ name: m.name, character: m.character, profilePath: m.profile_path }))

  const similar: TmdbSimilarItem[] = (detail.similar?.results ?? []).slice(0, 8).map((s) => ({
    tmdbId: s.id,
    title: s.name ?? s.title ?? '',
    posterPath: s.poster_path,
    year: s.first_air_date ? parseInt(s.first_air_date) : null,
  }))

  const meta: TmdbMeta = {
    id: cacheId,
    contentType: 'tv',
    tmdbId: detail.id,
    title: detail.name,
    overview: detail.overview,
    posterPath: detail.poster_path,
    backdropPath: detail.backdrop_path,
    year: detail.first_air_date ? parseInt(detail.first_air_date) : null,
    rating: Math.round(detail.vote_average * 10) / 10,
    ratingCount: detail.vote_count,
    genres: detail.genres.map((g) => g.name),
    runtime: detail.episode_run_time?.[0] ?? null,
    cast,
    director: null,
    similar,
    cachedAt: Date.now(),
  }

  await saveTmdbMeta(meta)
  return meta
}
