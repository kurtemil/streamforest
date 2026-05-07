import { create } from 'zustand'
import type { EpgProgram } from '@/types'
import { fetchAndParseEpg, epgUrlFromM3u, normalizeChannelName } from '@/services/epg'
import { saveEpgPrograms, loadEpgFromDB, saveEpgChannelNames, loadEpgChannelNames } from '@/services/db'

const LAST_FETCHED_KEY = 'sf_epg_fetched'
const EPG_URL_KEY      = 'sf_epg_url'
const EPG_STALE_MS     = 4 * 60 * 60 * 1000  // 4 hours

export interface EpgState {
  programs: Map<string, EpgProgram[]>       // keyed by tvg-id (channelId)
  displayNameMap: Map<string, string>        // normalizedName → channelId (fallback for channels without tvg-id)
  status: 'idle' | 'loading' | 'ready' | 'error'
  progress: string | null                    // human-readable loading progress
  lastFetched: number | null
  error: string | null
  epgUrl: string                             // explicit override URL (saved to localStorage)
  setEpgUrl: (url: string) => void
  resolveUrl: (m3uUrl: string) => string | null
  resolveByName: (name: string) => string | null
  loadFromDB: () => Promise<void>
  refresh: (m3uUrl: string) => Promise<void>
  isStale: () => boolean
}

export const useEpgStore = create<EpgState>((set, get) => ({
  programs: new Map(),
  displayNameMap: new Map(),
  status: 'idle',
  progress: null,
  lastFetched: (() => {
    const v = localStorage.getItem(LAST_FETCHED_KEY)
    return v ? parseInt(v) : null
  })(),
  error: null,
  epgUrl: localStorage.getItem(EPG_URL_KEY) ?? '',

  setEpgUrl: (url: string) => {
    localStorage.setItem(EPG_URL_KEY, url)
    set({ epgUrl: url })
  },

  resolveUrl: (m3uUrl: string) => {
    const explicit = get().epgUrl.trim()
    if (explicit) return explicit
    return epgUrlFromM3u(m3uUrl)
  },

  resolveByName: (name: string) => {
    const channelId = get().displayNameMap.get(normalizeChannelName(name))
    return channelId ?? null
  },

  isStale: () => {
    const { lastFetched } = get()
    return lastFetched === null || Date.now() - lastFetched > EPG_STALE_MS
  },

  loadFromDB: async () => {
    const [programs, displayNameMap] = await Promise.all([loadEpgFromDB(), loadEpgChannelNames()])
    if (programs.size > 0) {
      set({ programs, displayNameMap, status: 'ready' })
    }
  },

  refresh: async (m3uUrl: string) => {
    if (get().status === 'loading') return
    const url = get().resolveUrl(m3uUrl)
    if (!url) {
      set({
        status: 'error',
        error: 'No EPG URL — enter it in Settings → TV Guide.',
      })
      return
    }
    set({ status: 'loading', error: null, progress: 'Connecting…' })
    try {
      const { programs: flat, displayNameMap } = await fetchAndParseEpg(url, (count) => {
        set({ progress: `Parsed ${count.toLocaleString()} programs…` })
      })
      set({ progress: 'Saving…' })
      await Promise.all([saveEpgPrograms(flat), saveEpgChannelNames(displayNameMap)])

      const map = new Map<string, EpgProgram[]>()
      for (const p of flat) {
        const list = map.get(p.channelId) ?? []
        list.push(p)
        map.set(p.channelId, list)
      }
      map.forEach((list) => list.sort((a, b) => a.start - b.start))

      const now = Date.now()
      localStorage.setItem(LAST_FETCHED_KEY, String(now))
      set({ programs: map, displayNameMap, status: 'ready', lastFetched: now, error: null, progress: null })
    } catch (err) {
      set({
        status: 'error',
        progress: null,
        error: err instanceof Error ? err.message : 'EPG fetch failed',
      })
    }
  },
}))
