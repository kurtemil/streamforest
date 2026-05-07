import { create } from 'zustand'
import type { EpgProgram } from '@/types'
import { fetchAndParseEpg } from '@/services/epg'
import { saveEpgPrograms, loadEpgFromDB } from '@/services/db'

const LAST_FETCHED_KEY = 'sf_epg_fetched'
const EPG_STALE_MS = 4 * 60 * 60 * 1000  // 4 hours

export interface EpgState {
  programs: Map<string, EpgProgram[]>   // keyed by tvg-id (channelId)
  status: 'idle' | 'loading' | 'ready' | 'error'
  lastFetched: number | null
  error: string | null
  loadFromDB: () => Promise<void>
  refresh: (m3uUrl: string) => Promise<void>
  isStale: () => boolean
}

export const useEpgStore = create<EpgState>((set, get) => ({
  programs: new Map(),
  status: 'idle',
  lastFetched: (() => {
    const v = localStorage.getItem(LAST_FETCHED_KEY)
    return v ? parseInt(v) : null
  })(),
  error: null,

  isStale: () => {
    const { lastFetched } = get()
    return lastFetched === null || Date.now() - lastFetched > EPG_STALE_MS
  },

  loadFromDB: async () => {
    const programs = await loadEpgFromDB()
    if (programs.size > 0) {
      set({ programs, status: 'ready' })
    }
  },

  refresh: async (m3uUrl: string) => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const flat = await fetchAndParseEpg(m3uUrl, (count) => {
        // surface progress to UI — reuse error field momentarily as a count string
        // but keep status as 'loading' so the spinner keeps spinning
        set({ error: `Loaded ${count.toLocaleString()} programs…` })
      })
      set({ error: null })
      await saveEpgPrograms(flat)

      const map = new Map<string, EpgProgram[]>()
      for (const p of flat) {
        const list = map.get(p.channelId) ?? []
        list.push(p)
        map.set(p.channelId, list)
      }
      map.forEach((list) => list.sort((a, b) => a.start - b.start))

      const now = Date.now()
      localStorage.setItem(LAST_FETCHED_KEY, String(now))
      set({ programs: map, status: 'ready', lastFetched: now, error: null })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'EPG fetch failed' })
    }
  },
}))
