export type ContentType = 'movie' | 'series' | 'live'

export interface Channel {
  id: string
  name: string
  url: string
  logo: string
  groupTitle: string
  type: ContentType
  sortIndex: number   // position in M3U file — used to preserve original order
  // Series
  showName?: string
  season?: number
  episode?: number
  episodeTitle?: string
  // Movie
  year?: number
  movieTitle?: string
}

export interface WatchProgress {
  id: string
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

export interface PlaylistMeta {
  id: 1
  url: string
  fetchedAt: number
  entryCount: number
  movieCount: number
  seriesCount: number
  liveCount: number
}
