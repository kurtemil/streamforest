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
