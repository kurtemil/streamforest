import { useState, useMemo, type MouseEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { Play, Bookmark, Clock, Heart, Film, Tv, Radio } from 'lucide-react'
import { normalizeShowKey } from '@/lib/utils'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { db, addToWatchLater, removeFromWatchLater, clearProgressMany, dismissRecommendation, recommendationKey } from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater, deleteRemoteProgress } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { EmptyState } from '@/components/ui/EmptyState'
import type { Channel, WatchProgress } from '@/types'
import { titleCollator, useLocale, useT, type MessageKey } from '@/lib/i18n'

type Tab = 'continue' | 'watchlater' | 'history' | 'favorites'

/** A History card and every progress row it was folded together from. */
interface HistoryItem {
  channel: Channel
  progress: WatchProgress
  channelIds: string[]
}
type SortKey = 'recent' | 'az'

/** `short` is what the tab shows when there is no room for the full label. */
const TABS: { id: Tab; label: MessageKey; short?: MessageKey; Icon: React.ElementType }[] = [
  { id: 'continue',   label: 'library.tabContinue',                                     Icon: Play     },
  { id: 'watchlater', label: 'common.watchLater', short: 'library.tabWatchLaterShort',  Icon: Bookmark },
  { id: 'history',    label: 'library.tabHistory',                                      Icon: Clock    },
  { id: 'favorites',  label: 'common.favorites',                                        Icon: Heart    },
]

const MIN_RESUME_POSITION = 60   // seconds — below this, skip in Continue tab

function getTitle(ch: Channel): string {
  return ch.movieTitle ?? ch.showName ?? ch.name
}

export function LibraryPage() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const { activeProfileId } = useProfileStore()
  const [tab, setTab] = useState<Tab>('continue')
  const [sort, setSort] = useState<SortKey>('recent')

  // ── shared lookups ──────────────────────────────────────────────────────────
  const chanById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels])

  const showRepMap = useMemo(() => {
    const map = new Map<string, Channel>()
    for (const ch of channels) {
      if (ch.type === 'series' && ch.showName) {
        const key = normalizeShowKey(ch.showName)
        if (!map.has(key)) map.set(key, ch)
      }
    }
    return map
  }, [channels])

  // ── DB queries ──────────────────────────────────────────────────────────────
  const watchLaterEntries = useLiveQuery(async () => {
    if (!activeProfileId) return []
    return (await db.watchLater.where('profileId').equals(activeProfileId).toArray())
      .sort((a, b) => b.addedAt - a.addedAt)
  }, [activeProfileId])

  const progressEntries = useLiveQuery(async () => {
    if (!activeProfileId) return []
    return (await db.watchProgress.where('profileId').equals(activeProfileId).toArray())
      .sort((a, b) => b.lastWatched - a.lastWatched)
  }, [activeProfileId])

  const favoriteEntries = useLiveQuery(async () => {
    return (await db.favorites.toArray()).sort((a, b) => b.addedAt - a.addedAt)
  }, [])

  // ── Watch Later ─────────────────────────────────────────────────────────────
  const watchLaterSet = useMemo(
    () => new Set(watchLaterEntries?.map((e) => e.contentId) ?? []),
    [watchLaterEntries],
  )

  const watchLaterItems = useMemo(() => {
    if (!watchLaterEntries || !channels.length) return []
    return watchLaterEntries.flatMap((entry) => {
      const ch = entry.kind === 'movie'
        ? chanById.get(entry.contentId)
        : showRepMap.get(entry.contentId)
      return ch ? [{ channel: ch, contentId: entry.contentId, kind: entry.kind }] : []
    })
  }, [watchLaterEntries, chanById, showRepMap, channels.length])

  // ── Continue Watching ───────────────────────────────────────────────────────
  // Same folding as History, and the same reason for carrying a list: removing a
  // show's card has to drop every episode of it that is resumable, or the card
  // reappears showing the one below. Completed rows are left alone — the card
  // says "stop offering to resume this", not "forget I watched it".
  const continueItems = useMemo((): HistoryItem[] => {
    if (!progressEntries || !channels.length) return []
    const byKey = new Map<string, HistoryItem>()

    for (const prog of progressEntries) {
      if (prog.completed) continue
      if (prog.position < MIN_RESUME_POSITION) continue
      const ch = chanById.get(prog.channelId)
      if (!ch) continue

      const dedupeKey = ch.type === 'series' && ch.showName
        ? `show:${normalizeShowKey(ch.showName)}`
        : `ch:${ch.id}`
      const existing = byKey.get(dedupeKey)
      if (existing) existing.channelIds.push(prog.channelId)
      else byKey.set(dedupeKey, { channel: ch, progress: prog, channelIds: [prog.channelId] })
    }
    return [...byKey.values()]
  }, [progressEntries, chanById, channels.length])

  // ── History ─────────────────────────────────────────────────────────────────
  // One card per title, but it carries every progress row it stands for: a show's
  // card is built from its most recent episode and removing it has to forget all
  // of them, or the next episode down simply takes its place.
  const historyItems = useMemo((): HistoryItem[] => {
    if (!progressEntries || !channels.length) return []
    const byKey = new Map<string, HistoryItem>()

    for (const prog of progressEntries) {
      const ch = chanById.get(prog.channelId)
      if (!ch) continue
      const dedupeKey = ch.type === 'series' && ch.showName
        ? `show:${normalizeShowKey(ch.showName)}`
        : `ch:${ch.id}`
      const existing = byKey.get(dedupeKey)
      if (existing) existing.channelIds.push(prog.channelId)
      else byKey.set(dedupeKey, { channel: ch, progress: prog, channelIds: [prog.channelId] })
    }
    return [...byKey.values()]
  }, [progressEntries, chanById, channels.length])

  // ── Favorites ───────────────────────────────────────────────────────────────
  const favoriteItems = useMemo(() => {
    if (!favoriteEntries || !channels.length) return []
    return favoriteEntries.flatMap((fav) => {
      const ch = fav.kind === 'movie' ? chanById.get(fav.id)
        : fav.kind === 'series' ? showRepMap.get(fav.id)
        : chanById.get(fav.id)
      return ch ? [{ channel: ch, kind: fav.kind }] : []
    })
  }, [favoriteEntries, chanById, showRepMap, channels.length])

  // ── Sorting helper ──────────────────────────────────────────────────────────
  // The collator is built from the app's language rather than the device's, so
  // "Ängen" sorts under Ä at the end in Swedish and under A in English — and the
  // same library does not sort two different ways on two different phones.
  const collator = useMemo(() => titleCollator(locale), [locale])
  function sortedByAZ<T extends { channel: Channel }>(items: T[]): T[] {
    if (sort !== 'az') return items
    return [...items].sort((a, b) => collator.compare(getTitle(a.channel), getTitle(b.channel)))
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  const toggleWatchLater = async (contentId: string, kind: 'movie' | 'series', e: MouseEvent) => {
    e.stopPropagation()
    if (!activeProfileId) return
    if (watchLaterSet.has(contentId)) {
      await removeFromWatchLater(activeProfileId, contentId)
      deleteRemoteWatchLater(activeProfileId, contentId)
    } else {
      const entry = await addToWatchLater(activeProfileId, contentId, kind)
      pushWatchLater(entry)
    }
  }

  // The X on a Continue or History card. D1 is told about every row too: it is
  // what the next device syncs from, so a local-only delete comes straight back.
  //
  // `dismiss` separates the two cards. Removing from Continue means "stop offering
  // to resume this" and nothing more. Removing from History means the title is
  // gone — and because recommendations are built by excluding what has been
  // watched, deleting the progress would otherwise hand it straight back to
  // "Because you watched". The dismissal is what remembers that.
  const forgetProgress = async (channelIds: string[], dismiss: Channel | null = null) => {
    if (!activeProfileId) return
    await clearProgressMany(activeProfileId, channelIds)
    if (dismiss) await dismissRecommendation(activeProfileId, recommendationKey(dismiss))
    for (const id of channelIds) deleteRemoteProgress(activeProfileId, id)
  }

  const openChannel = (ch: Channel) => {
    if (ch.type === 'movie') { navigate(`/movies?playing=${ch.id}`); play(ch) }
    else if (ch.type === 'series') { navigate(`/series?show=${encodeURIComponent(normalizeShowKey(ch.showName ?? ch.name))}`) }
    else { play(ch); navigate('/live') }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  const tabCount = {
    continue:   continueItems.length,
    watchlater: watchLaterItems.length,
    history:    historyItems.length,
    favorites:  favoriteItems.length,
  }

  const renderGrid = (items: JSX.Element[]) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {items}
    </div>
  )

  const renderEmpty = (icon: React.ReactNode, title: string, description: string) => (
    <div className="pt-8">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  )

  const renderTabContent = () => {
    if (tab === 'continue') {
      const items = sortedByAZ(continueItems)
      if (!items.length) return renderEmpty(<Play size={40} />, t('library.emptyContinueTitle'), t('library.emptyContinueBody'))
      return renderGrid(items.map(({ channel, progress, channelIds }) => (
        <MovieCard
          key={progress.id}
          channel={channel}
          progress={progress}
          onClick={() => openChannel(channel)}
          onRemove={(e) => {
            e.stopPropagation()
            forgetProgress(channelIds)
          }}
        />
      )))
    }

    if (tab === 'watchlater') {
      const items = sortedByAZ(watchLaterItems)
      if (!items.length) return renderEmpty(<Bookmark size={40} />, t('library.emptyWatchLaterTitle'), t('library.emptyWatchLaterBody'))
      return (
        <>
          {renderGrid(items.map(({ channel, contentId, kind }) => (
            <MovieCard
              key={contentId}
              channel={channel}
              isWatchLater
              onClick={() => openChannel(channel)}
              onWatchLater={(e) => toggleWatchLater(contentId, kind as 'movie' | 'series', e)}
            />
          )))}
        </>
      )
    }

    if (tab === 'history') {
      const items = sortedByAZ(historyItems)
      if (!items.length) return renderEmpty(<Clock size={40} />, t('library.emptyHistoryTitle'), t('library.emptyHistoryBody'))
      return renderGrid(items.map(({ channel, progress, channelIds }) => (
        <MovieCard
          key={progress.id}
          channel={channel}
          progress={progress}
          onClick={() => openChannel(channel)}
          onRemove={(e) => {
            e.stopPropagation()
            forgetProgress(channelIds, channel)
          }}
        />
      )))
    }

    if (tab === 'favorites') {
      const items = sortedByAZ(favoriteItems)
      if (!items.length) return renderEmpty(<Heart size={40} />, t('library.emptyFavoritesTitle'), t('library.emptyFavoritesBody'))

      const byKind = {
        movie:  items.filter((i) => i.kind === 'movie'),
        series: items.filter((i) => i.kind === 'series'),
        live:   items.filter((i) => i.kind === 'live'),
      }

      return (
        <div className="space-y-8">
          {byKind.movie.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Film size={15} className="text-neutral-400" />
                <h2 className="text-sm font-semibold text-white">{t('common.movies')}</h2>
                <span className="text-xs text-neutral-600">{byKind.movie.length}</span>
              </div>
              {renderGrid(byKind.movie.map(({ channel }) => (
                <MovieCard key={channel.id} channel={channel} onClick={() => openChannel(channel)} />
              )))}
            </section>
          )}
          {byKind.series.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Tv size={15} className="text-neutral-400" />
                <h2 className="text-sm font-semibold text-white">{t('common.tvShows')}</h2>
                <span className="text-xs text-neutral-600">{byKind.series.length}</span>
              </div>
              {renderGrid(byKind.series.map(({ channel }) => (
                <MovieCard key={channel.id} channel={channel} onClick={() => openChannel(channel)} />
              )))}
            </section>
          )}
          {byKind.live.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Radio size={15} className="text-neutral-400" />
                <h2 className="text-sm font-semibold text-white">{t('common.liveChannels')}</h2>
                <span className="text-xs text-neutral-600">{byKind.live.length}</span>
              </div>
              {renderGrid(byKind.live.map(({ channel }) => (
                <MovieCard key={channel.id} channel={channel} onClick={() => openChannel(channel)} />
              )))}
            </section>
          )}
        </div>
      )
    }
  }

  return (
    <div className="p-4 sm:p-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold text-white">{t('library.title')}</h1>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="bg-white/5 border border-white/8 text-sm text-neutral-300 rounded-lg px-3 py-1.5 outline-none focus:border-accent-600/60 cursor-pointer"
        >
          <option value="recent">{t('library.sortRecent')}</option>
          <option value="az">{t('library.sortAz')}</option>
        </select>
      </div>

      {/* Tabs */}
      <div className="flex items-stretch gap-1 mb-6 bg-white/5 rounded-xl p-1">
        {TABS.map(({ id, label, short, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 py-2 sm:px-4 rounded-lg text-[11px] sm:text-sm font-medium transition-colors ${
              tab === id
                ? 'bg-accent-600 text-white'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            <Icon size={14} className="shrink-0" />
            <span>
              {short ? (
                <>
                  <span className="sm:hidden">{t(short)}</span>
                  <span className="hidden sm:inline">{t(label)}</span>
                </>
              ) : (
                t(label)
              )}
            </span>
            {tabCount[id] > 0 && (
              <span className={`hidden sm:inline text-xs px-1.5 py-0.5 rounded-full ${
                tab === id ? 'bg-white/20 text-white' : 'bg-white/10 text-neutral-500'
              }`}>
                {tabCount[id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {renderTabContent()}
    </div>
  )
}
