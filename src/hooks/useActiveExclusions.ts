import { useSyncExternalStore } from 'react'
import { useExclusionsStore } from '@/stores/exclusionsStore'
import { useProfileStore, getProfile } from '@/stores/profileStore'
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'
import type { ContentType } from '@/stores/exclusionsStore'

type Excluded = Record<ContentType, Set<string>>

export function useActiveExclusions(): Excluded {
  const { excluded } = useExclusionsStore()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  // Subscribe to kid restrictions so the hook re-renders when they change
  useSyncExternalStore(kidRestrictionsStore.subscribe, kidRestrictionsStore.getSnapshot)

  const profile = getProfile(activeProfileId)
  if (profile?.role !== 'kid' || !activeProfileId) return excluded

  const kid = kidRestrictionsStore.getExcluded(activeProfileId)
  return {
    movie:  new Set([...excluded.movie,  ...kid.movie]),
    series: new Set([...excluded.series, ...kid.series]),
    live:   new Set([...excluded.live,   ...kid.live]),
  }
}
