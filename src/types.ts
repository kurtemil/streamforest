export type ContentType = 'movie' | 'series' | 'live'

export interface Channel {
  id: string
  name: string
  url: string
  logo: string
  groupTitle: string
  type: ContentType
  sortIndex: number   // position in M3U file — used to preserve original order
  tvgId?: string      // tvg-id from M3U — links to XMLTV EPG data
  // Series
  showName?: string
  season?: number
  episode?: number
  episodeTitle?: string
  // Movie
  year?: number
  movieTitle?: string
}

export interface EpgProgram {
  id: string          // `${channelId}_${start}`
  channelId: string   // matches Channel.tvgId
  title: string
  start: number       // ms since epoch
  end: number         // ms since epoch
  description?: string
  category?: string
}

export interface WatchProgress {
  id: string        // "${profileId}:${channelId}"
  profileId: string
  channelId: string
  position: number
  duration: number
  lastWatched: number
  completed: boolean
}

export interface Favorite {
  id: string
  kind: ContentType
  addedAt: number
}

export interface WatchLater {
  id: string        // "${profileId}:${contentId}"
  profileId: string
  contentId: string // channel.id for movies, normalizedShowKey for series
  kind: 'movie' | 'series'
  addedAt: number
}

export interface PlaylistMeta {
  id: 1
  url: string
  fetchedAt: number
  entryCount: number
  movieCount: number
  seriesCount: number
  liveCount: number
}

// ── TMDB ──────────────────────────────────────────────────────────────────────

export interface TmdbCastMember {
  name: string
  character: string
  profilePath: string | null
}

export interface TmdbSimilarItem {
  tmdbId: number
  title: string
  posterPath: string | null
  year: number | null
}

/** Cached metadata record. Keyed by channel.id (movies) or normalizedShowKey (series). */
export interface TmdbMeta {
  /** Lookup key: channel.id for movies, normalizeShowKey(showName) for series. */
  id: string
  contentType: 'movie' | 'tv'
  tmdbId: number
  title: string
  overview: string
  posterPath: string | null
  backdropPath: string | null
  year: number | null
  rating: number        // vote_average 0–10
  ratingCount: number
  genres: string[]
  runtime: number | null  // minutes (movie only; tv = episode runtime avg)
  cast: TmdbCastMember[]
  director: string | null // movie only
  similar: TmdbSimilarItem[]
  blurhashPoster?: string | null
  blurhashBackdrop?: string | null
  cachedAt: number
  notFound?: true       // searched but no result — skip retrying until TTL expires
}

// ── Feedback ───────────────────────────────────────────────────────────────────

/** 'bug' = something is broken, 'idea' = a wish for the app. */
export type FeedbackKind = 'bug' | 'idea'

/** One report, as `functions/api/feedback.ts` returns it. */
export interface Feedback {
  id: string
  profileId: string | null
  authorName: string
  kind: FeedbackKind
  body: string
  /** Ticked off by the admin. Never deleted on being fixed — see the Function. */
  resolved: boolean
  createdAt: number
  /** Which phone the report came from. Null on nothing, in practice. */
  userAgent: string | null
  /** JSON blob of `ClientContext` — debugging colour, not queried on. */
  context: string | null
}
