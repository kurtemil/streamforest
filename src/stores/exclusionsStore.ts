import { create } from 'zustand'

export type ContentType = 'movie' | 'series' | 'live'

type Raw = Record<ContentType, string[]>

const STORAGE_KEY = 'sf_excluded_v2'
const API = '/api/exclusions'

function emptyRaw(): Raw { return { movie: [], series: [], live: [] } }

function load(): Record<string, Raw> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, Raw>
  } catch {}
  return {}
}

function persist(data: Record<string, Raw>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function push(profileId: string, raw: Raw) {
  fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, ...raw }),
  }).catch(() => {})
}

interface ExclusionsState {
  /** Raw per-profile exclusions: profileId → { movie, series, live } (arrays for serialisation) */
  byProfile: Record<string, Raw>
  toggle: (profileId: string, type: ContentType, group: string) => void
  setAll: (profileId: string, type: ContentType, groups: string[], hide: boolean) => void
  syncFromRemote: (profileId: string) => Promise<void>
}

export const useExclusionsStore = create<ExclusionsState>((set, get) => ({
  byProfile: load(),

  toggle(profileId, type, group) {
    const prev = get().byProfile[profileId] ?? emptyRaw()
    const arr = prev[type]
    const next: Raw = { ...prev, [type]: arr.includes(group) ? arr.filter((g) => g !== group) : [...arr, group] }
    const byProfile = { ...get().byProfile, [profileId]: next }
    persist(byProfile)
    set({ byProfile })
    push(profileId, next)
  },

  setAll(profileId, type, groups, hide) {
    const prev = get().byProfile[profileId] ?? emptyRaw()
    const next: Raw = { ...prev, [type]: hide ? groups : [] }
    const byProfile = { ...get().byProfile, [profileId]: next }
    persist(byProfile)
    set({ byProfile })
    push(profileId, next)
  },

  async syncFromRemote(profileId) {
    try {
      const res = await fetch(`${API}?profileId=${encodeURIComponent(profileId)}`)
      if (!res.ok) return
      const remote = await res.json() as Raw
      const byProfile = { ...get().byProfile, [profileId]: remote }
      persist(byProfile)
      set({ byProfile })
    } catch {
      // silent — offline or D1 not configured
    }
  },
}))

/** Converts the raw array-based store entry to a Set-based record for use in filters. */
export function rawToExcluded(raw: Raw | undefined): Record<ContentType, Set<string>> {
  const r = raw ?? emptyRaw()
  return { movie: new Set(r.movie), series: new Set(r.series), live: new Set(r.live) }
}
