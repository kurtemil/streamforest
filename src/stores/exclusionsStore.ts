import { create } from 'zustand'

export type ContentType = 'movie' | 'series' | 'live'

interface ExclusionsState {
  excluded: Record<ContentType, Set<string>>
  toggle: (type: ContentType, group: string) => void
  setAll: (type: ContentType, groups: string[], hide: boolean) => void
}

const STORAGE_KEY = 'sf_excluded_groups_v1'

function loadExclusions(): Record<ContentType, Set<string>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<ContentType, string[]>
      return {
        movie: new Set(parsed.movie ?? []),
        series: new Set(parsed.series ?? []),
        live: new Set(parsed.live ?? []),
      }
    }
  } catch {}
  return { movie: new Set(), series: new Set(), live: new Set() }
}

function saveExclusions(excluded: Record<ContentType, Set<string>>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    movie: Array.from(excluded.movie),
    series: Array.from(excluded.series),
    live: Array.from(excluded.live),
  }))
}

export const useExclusionsStore = create<ExclusionsState>((set, get) => ({
  excluded: loadExclusions(),

  toggle(type, group) {
    const prev = get().excluded
    const next = new Set(prev[type])
    if (next.has(group)) next.delete(group)
    else next.add(group)
    const excluded = { ...prev, [type]: next }
    saveExclusions(excluded)
    set({ excluded })
  },

  setAll(type, groups, hide) {
    const prev = get().excluded
    const excluded = { ...prev, [type]: hide ? new Set(groups) : new Set<string>() }
    saveExclusions(excluded)
    set({ excluded })
  },
}))
