import { useEffect } from 'react'
import { Film, Play } from 'lucide-react'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { posterUrl, watchLocalNetworkPermission, type HomeItem } from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { getProfile, useProfileStore } from '@/stores/profileStore'
import { useT } from '@/lib/i18n'

/**
 * "Hemma": the films on the home server's disks, through Jellyfin.
 *
 * Shown only when the server answers from here. Away without Tailscale it says so
 * in one line instead of showing cards that would fail when tapped. A profile with
 * nothing to see (a kid's allowlist can be short) gets no row at all.
 */
export function HomeRail() {
  const t = useT()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const profile = getProfile(activeProfileId)
  const { status, items, load, play } = useHomeLibraryStore()

  useEffect(() => {
    if (!profile) return
    const reload = () => load(profile.id, profile.name)
    reload()
    // Coming back to the app may mean coming home, or having watched in Swiftfin.
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    // Answering the browser's home-network question, now or later in its settings.
    let unwatch = () => {}
    let alive = true
    watchLocalNetworkPermission(reload).then((u) => { if (alive) unwatch = u; else u() })
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onVisible)
      unwatch()
    }
  }, [profile, load])

  if (status === 'unknown') return null
  if (status === 'blocked') {
    return <p className="text-caption text-neutral-500">{t('home.homeBlocked')}</p>
  }
  if (status === 'unreachable') {
    return <p className="text-caption text-neutral-500">{t('home.homeUnreachable')}</p>
  }
  if (items.length === 0) return null

  return (
    <section>
      <SectionHeader title={t('home.homeLibrary')} />
      <ScrollableRow>
        {items.map((item) => (
          <div key={item.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
            <HomeCard item={item} onClick={() => play(item)} />
          </div>
        ))}
      </ScrollableRow>
    </section>
  )
}

function HomeCard({ item, onClick }: { item: HomeItem; onClick: () => void }) {
  const src = posterUrl(item)
  const pct = !item.played && item.durationSec > 0 && item.positionSec > 10
    ? Math.min(100, Math.round((item.positionSec / item.durationSec) * 100))
    : 0
  return (
    <button onClick={onClick} className="group press text-left w-full">
      <div className="relative aspect-[2/3] rounded-card overflow-hidden bg-surface-300 ring-1 ring-white/8 transition-all duration-300 ease-out-expo group-hover:scale-[1.04] group-hover:-translate-y-1 shadow-card group-hover:shadow-card-hover">
        {src ? (
          <img src={src} alt={item.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-600">
            <Film size={28} />
          </div>
        )}
        <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <div className="w-11 h-11 rounded-full bg-black/60 flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        {pct > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
            <div className="h-full bg-accent-400 rounded-r-full" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="mt-2 px-0.5 min-h-[3.75rem]">
        <p className="text-body text-white font-medium leading-tight line-clamp-2">{item.name}</p>
        {item.year && <p className="text-caption text-neutral-500 mt-0.5">{item.year}</p>}
      </div>
    </button>
  )
}
