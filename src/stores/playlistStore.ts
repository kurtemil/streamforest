import { create } from 'zustand'
import { fetchAndStorePlaylist, type FetchProgress } from '@/services/fetcher'
import { db, getPlaylistMeta } from '@/services/db'
import type { Channel } from '@/types'

interface PlaylistState {
  channels: Channel[]
  loaded: boolean
  fetching: boolean
  progress: FetchProgress | null
  error: string | null
  m3uUrl: string

  setM3uUrl: (url: string) => Promise<void>
  syncM3uUrlFromRemote: () => Promise<void>
  loadFromDB: () => Promise<void>
  refresh: () => Promise<void>
}

const STORAGE_KEY = 'sf_m3u_url'

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  channels: [],
  loaded: false,
  fetching: false,
  progress: null,
  error: null,
  m3uUrl: localStorage.getItem(STORAGE_KEY) ?? '',

  async setM3uUrl(url) {
    localStorage.setItem(STORAGE_KEY, url)
    set({ m3uUrl: url })
    // This write must be awaited and its failure surfaced. Swallowing it meant a
    // save that never reached D1 still rendered as "Saved", and because
    // syncM3uUrlFromRemote pulls D1 down over local state on the next launch, the
    // old URL came back — the change looked accepted and then evaporated. That is
    // how a provider move turned into "the new URL doesn't work": it was never
    // stored, so every refresh kept using the old host and kept being rejected.
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '_global', key: 'm3u_url', value: url }),
    })
    if (!res.ok) {
      throw new Error(`Could not save the URL — server returned ${res.status}. It will be lost on the next launch.`)
    }
  },

  async syncM3uUrlFromRemote() {
    try {
      const res = await fetch('/api/preferences?profileId=_global')
      if (!res.ok) return
      const data = await res.json() as Record<string, string>
      if (data.m3u_url && data.m3u_url !== get().m3uUrl) {
        const wasEmpty = !get().m3uUrl
        localStorage.setItem(STORAGE_KEY, data.m3u_url)
        set({ m3uUrl: data.m3u_url })
        // Fresh device/PWA with no local data: auto-fetch the playlist
        if (wasEmpty) get().refresh()
      } else if (!data.m3u_url && get().m3uUrl) {
        // Local has a URL but D1 doesn't — push it up so other devices/PWA can sync
        fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId: '_global', key: 'm3u_url', value: get().m3uUrl }),
        }).catch(() => {})
      }
    } catch {
      // offline or D1 not configured — silent
    }
  },

  async loadFromDB() {
    const meta = await getPlaylistMeta()
    if (!meta) {
      set({ loaded: true })
      return
    }
    const channels = await db.channels.orderBy('sortIndex').toArray()
    set({ channels, loaded: true })
  },

  async refresh() {
    const { m3uUrl } = get()
    if (!m3uUrl) {
      set({ error: 'No M3U URL configured. Go to Settings.' })
      return
    }
    set({ fetching: true, error: null, progress: null })
    try {
      const channels = await fetchAndStorePlaylist(m3uUrl, (progress) => {
        set({ progress })
      })
      set({ channels, fetching: false, progress: null })
    } catch (err) {
      set({ fetching: false, error: String(err), progress: null })
    }
  },
}))
