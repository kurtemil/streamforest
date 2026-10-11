import { useEffect } from 'react'
import { watchLocalNetworkPermission } from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { getProfile, useProfileStore } from '@/stores/profileStore'

/**
 * The home library for the active profile, loaded and kept fresh: on mount, when
 * the app comes back to the foreground (coming home, or having watched in
 * Swiftfin), and when the browser's home-network question is answered.
 */
export function useHomeLibrary() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const profile = getProfile(activeProfileId)
  const load = useHomeLibraryStore((s) => s.load)

  useEffect(() => {
    if (!profile) return
    const reload = () => load(profile.id, profile.name)
    reload()
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    let unwatch = () => {}
    let alive = true
    watchLocalNetworkPermission(reload).then((u) => { if (alive) unwatch = u; else u() })
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      unwatch()
    }
  }, [profile, load])

  return useHomeLibraryStore()
}
