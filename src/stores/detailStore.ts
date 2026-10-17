import { create } from 'zustand'
import type { Channel, TmdbMeta } from '@/types'

/**
 * The film whose detail sheet is open, wherever it was opened from.
 *
 * One sheet for the whole app, mounted once beside the players. Search, Continue
 * Watching and the library used to start a film straight away because only Home
 * and Movies had a sheet of their own to open; with this, every place that shows a
 * film can show it first and let the sheet offer to play or continue it.
 */
interface DetailState {
  channel: Channel | null
  /** What the opener already had. The sheet looks it up itself when this is null. */
  tmdbMeta: TmdbMeta | null
  openMovie: (channel: Channel, tmdbMeta?: TmdbMeta | null) => void
  close: () => void
}

export const useDetailStore = create<DetailState>((set) => ({
  channel: null,
  tmdbMeta: null,
  openMovie: (channel, tmdbMeta = null) => set({ channel, tmdbMeta }),
  close: () => set({ channel: null, tmdbMeta: null }),
}))
