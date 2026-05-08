import { useSyncExternalStore, useMemo } from 'react'
import { useExclusionsStore, rawToExcluded, type ContentType } from '@/stores/exclusionsStore'
import { useProfileStore, getProfile } from '@/stores/profileStore'
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'

type Excluded = Record<ContentType, Set<string>>

export function useActiveExclusions(): Excluded {
  const byProfile = useExclusionsStore((s) => s.byProfile)
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  // Re-render when kid restrictions change
  useSyncExternalStore(kidRestrictionsStore.subscribe, kidRestrictionsStore.getSnapshot)

  const profile = getProfile(activeProfileId)
  const profileExclusions = useMemo(
    () => rawToExcluded(byProfile[activeProfileId ?? '']),
    [byProfile, activeProfileId],
  )

  if (profile?.role === 'kid' && activeProfileId) {
    // Kids can't change their own exclusions; apply parent-set restrictions on top
    const kid = kidRestrictionsStore.getExcluded(activeProfileId)
    return {
      movie:  new Set([...profileExclusions.movie,  ...kid.movie]),
      series: new Set([...profileExclusions.series, ...kid.series]),
      live:   new Set([...profileExclusions.live,   ...kid.live]),
    }
  }

  return profileExclusions
}
