import { create } from 'zustand'
import { fetchAndStorePlaylist, type FetchProgress } from '@/services/fetcher'
import { db, getPlaylistMeta } from '@/services/db'
import type { Channel } from '@/types'
import { t } from '@/lib/i18n'
import { safeImageUrl } from '@/lib/images'

interface PlaylistState {
  channels: Channel[]
  loaded: boolean
  fetching: boolean
  progress: FetchProgress | null
  error: string | null
  m3uUrl: string

  setM3uUrl: (url: string) => Promise<void>
  /** Saves the provider's IPs (in order) and the playlist URL on iptv.krutofv.se. */
  moveProvider: (url: string, ips: string[], pin: string) => Promise<ProviderMove>
  syncM3uUrlFromRemote: () => Promise<void>
  loadFromDB: () => Promise<void>
  refresh: () => Promise<void>
}

export interface ProviderMove {
  ok: boolean
  /** Translation key suffix for a refusal: 'pin', 'locked', 'privateAddress', … */
  code?: string
  detail?: string
  /** The IP iptv.krutofv.se points at after the save. */
  target?: string | null
  /** The stored list, in order — the pasted URL's own IP first if it was not listed. */
  ips?: string[]
  m3uUrl?: string
  check?: { answers: boolean; status?: string; expires?: string }
}

const STORAGE_KEY = 'sf_m3u_url'

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  channels: [],
  loaded: false,
  fetching: false,
  progress: null,
  error: null,
  // Guarded so modules that read the URL (player, VLC hand-off) load in tests too.
  m3uUrl: (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || '',

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

  async moveProvider(url, ips, pin) {
    let result: ProviderMove
    try {
      const res = await fetch('/api/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ips, pin }),
      })
      result = (await res.json()) as ProviderMove
    } catch {
      return { ok: false, code: 'network' }
    }
    // The server has already written m3u_url to D1; only this device needs telling.
    if (result.ok && result.m3uUrl) {
      localStorage.setItem(STORAGE_KEY, result.m3uUrl)
      set({ m3uUrl: result.m3uUrl })
    }
    return result
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
    // Read by primary key and sort here, rather than asking IndexedDB for the
    // sortIndex order.
    //
    // This is the first thing every launch waits on and the library is 205 803
    // rows, so how it is read is the load time. `orderBy('sortIndex')` makes the
    // engine walk the index and then fetch each record it points at; a plain
    // `toArray()` is one getAll over the store. Measured in Chromium on a
    // seeded copy of a library this size:
    //
    //   index('sortIndex').getAll()   2340 ms
    //   objectStore.getAll()          1008 ms
    //
    // and sorting 205 803 numbers afterwards is a fraction of the difference. A
    // phone is several times slower than that desktop, which is where it was
    // noticed. The order is identical either way — sortIndex is assigned in file
    // order on import and is unique.
    const channels = await db.channels.toArray()
    channels.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    // A catalogue stored before http logos were dropped at import still has them;
    // clear them here, or every poster grid keeps knocking on the provider's
    // servers from the home IP (src/lib/images.ts).
    for (let i = 0; i < channels.length; i++) {
      const logo = channels[i].logo
      if (logo && !logo.startsWith('https://')) channels[i] = { ...channels[i], logo: safeImageUrl(logo) }
    }
    set({ channels, loaded: true })

  },

  async refresh() {
    const { m3uUrl } = get()
    if (!m3uUrl) {
      set({ error: t('playlist.errNoUrl') })
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
