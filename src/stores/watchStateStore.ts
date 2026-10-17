import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/services/db'
import { normalizeShowKey } from '@/lib/utils'
import { usePlaylistStore } from '@/stores/playlistStore'
import { useProfileStore } from '@/stores/profileStore'
import type { Channel, WatchProgress } from '@/types'

/**
 * What the active profile has seen, for the cards (feedback box, 2026-10-15:
 * "see on a title whether I have seen it before").
 *
 * One live query for the whole app, mounted in App.tsx, instead of every page
 * passing progress down to its cards. Several never did, which is why a film
 * could be finished and still look untouched in a genre row.
 */
interface WatchState {
  byId: Map<string, WatchProgress>
  /**
   * Per show key, "done/total" episodes finished, for shows with at least one
   * finished. A string so a card's selector compares by value and only the card
   * whose show changed renders again.
   */
  shows: Map<string, string>
}

export const useWatchStateStore = create<WatchState>(() => ({ byId: new Map(), shows: new Map() }))

/** Which show each episode belongs to, and how many episodes each show has here. */
export interface EpisodeIndex {
  showOf: Map<string, string>
  episodes: Map<string, number>
}

export function buildEpisodeIndex(channels: readonly Channel[]): EpisodeIndex {
  const showOf = new Map<string, string>()
  const episodes = new Map<string, number>()
  for (const ch of channels) {
    if (ch.type !== 'series') continue
    const key = normalizeShowKey(ch.showName ?? ch.name)
    showOf.set(ch.id, key)
    episodes.set(key, (episodes.get(key) ?? 0) + 1)
  }
  return { showOf, episodes }
}

export function summarizeWatched(rows: readonly WatchProgress[], index: EpisodeIndex): WatchState {
  const byId = new Map(rows.map((r) => [r.channelId, r]))
  const done = new Map<string, number>()
  for (const r of rows) {
    if (!r.completed) continue
    const show = index.showOf.get(r.channelId)
    if (show) done.set(show, (done.get(show) ?? 0) + 1)
  }
  const shows = new Map<string, string>()
  for (const [show, n] of done) {
    const total = index.episodes.get(show) ?? n
    shows.set(show, `${Math.min(n, total)}/${total}`)
  }
  return { byId, shows }
}

/** Keeps the store in step with the profile's progress rows and the catalogue. */
export function useWatchStateSync(): void {
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const channels = usePlaylistStore((s) => s.channels)
  const rows = useLiveQuery(
    () => (activeProfileId ? db.watchProgress.where('profileId').equals(activeProfileId).toArray() : []),
    [activeProfileId],
  )
  const index = useMemo(() => buildEpisodeIndex(channels), [channels])
  useEffect(() => {
    useWatchStateStore.setState(summarizeWatched(rows ?? [], index))
  }, [rows, index])
}

export function useWatched(channelId: string): WatchProgress | undefined {
  return useWatchStateStore((s) => s.byId.get(channelId))
}

/** Finished episodes of a show, or null when none are. */
export function useShowWatched(showKey: string): { done: number; total: number } | null {
  const v = useWatchStateStore((s) => s.shows.get(showKey))
  if (!v) return null
  const [done, total] = v.split('/').map(Number)
  return { done, total }
}
