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

  setM3uUrl: (url: string) => void
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

  setM3uUrl(url) {
    localStorage.setItem(STORAGE_KEY, url)
    set({ m3uUrl: url })
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: '_global', key: 'm3u_url', value: url }),
    }).catch(() => {})
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
