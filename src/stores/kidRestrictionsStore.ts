import { useSyncExternalStore } from 'react'
import type { ContentType } from '@/stores/exclusionsStore'

const STORAGE_KEY = 'sf_kid_restrictions_v1'
const API = '/api/restrictions'

type Raw = Record<ContentType, string[]>
type GroupRestrictions = Record<ContentType, Set<string>>

function empty(): Raw { return { movie: [], series: [], live: [] } }

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

let _data = load()
const _listeners = new Set<() => void>()

function notify() { _listeners.forEach((fn) => fn()) }

function push(profileId: string, raw: Raw) {
  fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId, ...raw }),
  }).catch(() => {})
}

export const kidRestrictionsStore = {
  getExcluded(profileId: string): GroupRestrictions {
    const raw = _data[profileId] ?? empty()
    return { movie: new Set(raw.movie), series: new Set(raw.series), live: new Set(raw.live) }
  },

  toggle(profileId: string, type: ContentType, group: string) {
    const raw = { ...(_data[profileId] ?? empty()) }
    const arr = raw[type]
    raw[type] = arr.includes(group) ? arr.filter((g) => g !== group) : [...arr, group]
    _data = { ..._data, [profileId]: raw }
    persist(_data)
    notify()
    push(profileId, raw)
  },

  setAll(profileId: string, type: ContentType, groups: string[], hide: boolean) {
    const raw = { ...(_data[profileId] ?? empty()), [type]: hide ? groups : [] }
    _data = { ..._data, [profileId]: raw }
    persist(_data)
    notify()
    push(profileId, raw)
  },

  // Pull from D1 and merge into local (remote wins — admin set it intentionally)
  async syncFromRemote(profileId: string): Promise<void> {
    try {
      const res = await fetch(`${API}?profileId=${encodeURIComponent(profileId)}`)
      if (!res.ok) return
      const remote = await res.json() as Raw
      _data = { ..._data, [profileId]: remote }
      persist(_data)
      notify()
    } catch {
      // silent
    }
  },

  subscribe(fn: () => void) {
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  },

  getSnapshot() { return _data },
}

export function useKidRestrictions(profileId: string): {
  excluded: GroupRestrictions
  toggle: (type: ContentType, group: string) => void
  setAll: (type: ContentType, groups: string[], hide: boolean) => void
} {
  useSyncExternalStore(kidRestrictionsStore.subscribe, kidRestrictionsStore.getSnapshot)
  return {
    excluded: kidRestrictionsStore.getExcluded(profileId),
    toggle: (type, group) => kidRestrictionsStore.toggle(profileId, type, group),
    setAll: (type, groups, hide) => kidRestrictionsStore.setAll(profileId, type, groups, hide),
  }
}
