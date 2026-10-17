import { useMemo, useState } from 'react'
import { HardDrive } from 'lucide-react'
import { HomeCard } from '@/components/home/HomeCard'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { SearchBar } from '@/components/ui/SearchBar'
import { useHomeLibrary } from '@/hooks/useHomeLibrary'
import type { HomeItem } from '@/services/jellyfin'
import { titleCollator, useT } from '@/lib/i18n'

/**
 * Everything in the home library at a glance: what is started, then each Jellyfin
 * library (Filmer, Fotboll …) A–Ö, with a search across them. What a profile sees
 * is decided by Jellyfin, so a kid's page holds only its allowlist.
 */
export function HomeLibraryPage() {
  const t = useT()
  const { status, items, openDetail } = useHomeLibrary()
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const visible = useMemo(
    () => (q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items),
    [items, q],
  )
  const started = useMemo(() => visible.filter((i) => !i.played && i.positionSec > 10), [visible])
  const libraries = useMemo(() => {
    const byLibrary = new Map<string, HomeItem[]>()
    for (const i of visible) byLibrary.set(i.library, [...(byLibrary.get(i.library) ?? []), i])
    return [...byLibrary.entries()].map(([name, list]) => ({
      name,
      list: [...list].sort((a, b) => titleCollator().compare(a.name, b.name)),
    }))
  }, [visible])

  return (
    <div className="px-4 sm:px-6 pb-12 pt-6 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <HardDrive size={22} className="text-accent-400" />
            {t('nav.homeLibrary')}
          </h1>
          <p className="text-caption text-neutral-500 mt-1">
            {status === 'ready' ? t('movies.count', { count: items.length }) + ' · ' : ''}
            {t('homeLibrary.subtitle')}
          </p>
        </div>
        {status === 'ready' && items.length > 0 && (
          <div className="w-full sm:w-72">
            <SearchBar value={search} onChange={setSearch} placeholder={t('homeLibrary.search')} />
          </div>
        )}
      </header>

      {status === 'unknown' && (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 rounded-full border-2 border-accent-600 border-t-transparent animate-spin" />
        </div>
      )}
      {status === 'blocked' && <p className="text-body text-neutral-400">{t('home.homeBlocked')}</p>}
      {status === 'unreachable' && <p className="text-body text-neutral-400">{t('home.homeUnreachable')}</p>}
      {status === 'ready' && q && visible.length === 0 && (
        <p className="text-body text-neutral-400">{t('homeLibrary.noMatch', { query: search.trim() })}</p>
      )}

      {started.length > 0 && (
        <section>
          <SectionHeader title={t('common.continueWatching')} />
          <ScrollableRow>
            {started.map((item) => (
              <div key={item.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                <HomeCard item={item} onClick={() => openDetail(item)} />
              </div>
            ))}
          </ScrollableRow>
        </section>
      )}

      {libraries.map(({ name, list }) => (
        <section key={name}>
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="text-heading-lg text-white">{name}</h2>
            <span className="text-caption text-neutral-500">{t('movies.count', { count: list.length })}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-4 gap-y-6">
            {list.map((item) => <HomeCard key={item.id} item={item} onClick={() => openDetail(item)} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
