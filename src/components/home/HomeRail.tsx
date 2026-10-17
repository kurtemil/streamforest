import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { HomeCard } from '@/components/home/HomeCard'
import { useHomeLibrary } from '@/hooks/useHomeLibrary'
import { useT } from '@/lib/i18n'

/**
 * "Hemma" on the home page: the films on the home server's disks, through Jellyfin.
 * The whole library, grouped and searchable, is on /hemma.
 *
 * Shown only when the server answers from here. Away without Tailscale it says so
 * in one line instead of showing cards that would fail when tapped. A profile with
 * nothing to see (a kid's allowlist can be short) gets no row at all.
 */
export function HomeRail() {
  const t = useT()
  const { status, items, openDetail } = useHomeLibrary()

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
      <SectionHeader title={t('home.homeLibrary')} to="/hemma" />
      <ScrollableRow>
        {items.map((item) => (
          <div key={item.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
            <HomeCard item={item} onClick={() => openDetail(item)} />
          </div>
        ))}
      </ScrollableRow>
    </section>
  )
}
