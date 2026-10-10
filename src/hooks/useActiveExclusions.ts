import { useSyncExternalStore, useMemo } from 'react'
import { useExclusionsStore, rawToExcluded, type ContentType } from '@/stores/exclusionsStore'
import { useProfileStore, getProfile } from '@/stores/profileStore'
import { kidRestrictionsStore } from '@/stores/kidRestrictionsStore'

type Excluded = Record<ContentType, Set<string>>

/** Whether the active profile may see this item. Every list that reaches a kid goes through this. */
export function isVisible(ch: { type: ContentType; groupTitle: string }, excluded: Excluded): boolean {
  return !excluded[ch.type]?.has(ch.groupTitle)
}

export function useActiveExclusions(): Excluded {
  const byProfile = useExclusionsStore((s) => s.byProfile)
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  // Re-render when kid restrictions change
  const kidSnapshot = useSyncExternalStore(kidRestrictionsStore.subscribe, kidRestrictionsStore.getSnapshot)

  const profile = getProfile(activeProfileId)
  const profileExclusions = useMemo(
    () => rawToExcluded(byProfile[activeProfileId ?? '']),
    [byProfile, activeProfileId],
  )
  const isKid = profile?.role === 'kid'

  // Memoised so callers can depend on it: search scans the whole catalogue whenever
  // this changes identity, and a fresh object per render made that every keystroke.
  return useMemo(() => {
    if (!isKid || !activeProfileId) return profileExclusions
    // Kids can't change their own exclusions; apply parent-set restrictions on top
    const kid = kidRestrictionsStore.getExcluded(activeProfileId)
    return {
      movie:  new Set([...profileExclusions.movie,  ...kid.movie]),
      series: new Set([...profileExclusions.series, ...kid.series]),
      live:   new Set([...profileExclusions.live,   ...kid.live]),
    }
  }, [isKid, activeProfileId, profileExclusions, kidSnapshot])
}
