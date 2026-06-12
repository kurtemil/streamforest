import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Tv,
  ChevronRight,
  ChevronDown,
  Star,
  Play,
  Check,
  Bookmark,
  Shuffle,
} from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import {
  db,
  toggleFavorite,
  addToWatchLater,
  removeFromWatchLater,
  clearProgress,
} from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater, deleteRemoteProgress } from '@/services/sync'
import { Poster } from '@/ui'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { ContinueCard } from '@/components/ui/ContinueCard'
import type { Channel, TmdbMeta, WatchProgress } from '@/types'
import { formatTime } from '@/lib/time'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import { backdropUrl, posterUrl } from '@/services/tmdb'
import { normalizeShowKey } from '@/lib/utils'
import { openInVlc } from '@/lib/vlc'

const RECENT_SHOWS = 40

type ShowEntry = {
  seasons: Map<number, Channel[]>
  logo: string
  group: string
  displayName: string
}

function buildShowMap(channels: Channel[]) {
  const shows = new Map<string, ShowEntry>()
  for (const ch of channels) {
    const rawName = ch.showName ?? ch.name
    const key = normalizeShowKey(rawName)
    if (!shows.has(key))
      shows.set(key, {
        seasons: new Map(),
        logo: ch.logo,
        group: ch.groupTitle,
        displayName: rawName,
      })
    const entry = shows.get(key)!
    if (!entry.logo && ch.logo) entry.logo = ch.logo
    const s = ch.season ?? 0
    if (!entry.seasons.has(s)) entry.seasons.set(s, [])
    entry.seasons.get(s)!.push(ch)
  }
  for (const { seasons } of shows.values()) {
    for (const eps of seasons.values()) {
      eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    }
  }
  return shows
}

// ─── Season dropdown ───────────────────────────────────────────────────────────

function SeasonDropdown({
  seasons,
  selected,
  onChange,
}: {
  seasons: number[]
  selected: number
  onChange: (s: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (seasons.length <= 1) return null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 bg-white/8 hover:bg-white/12 rounded-lg text-white text-sm font-medium transition-colors"
      >
        Season {selected}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 bg-[#1e1e1e] border border-white/10 rounded-xl py-1.5 z-20 min-w-36 shadow-2xl shadow-black/60 animate-fade-in">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => {
                onChange(s)
                setOpen(false)
              }}
              className={`flex items-center gap-2 w-full text-left px-4 py-2 text-sm transition-colors ${
                s === selected
                  ? 'text-accent-400 bg-accent-600/10'
                  : 'text-neutral-300 hover:text-white hover:bg-white/5'
              }`}
            >
              {s === selected && <Check size={12} className="shrink-0" />}
              <span className={s === selected ? '' : 'ml-4'}>Season {s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Episode row ───────────────────────────────────────────────────────────────

function EpisodeRow({
  ep,
  progress,
  onClick,
}: {
  ep: Channel
  progress?: { position: number; duration: number; completed: boolean; lastWatched?: number }
  onClick: () => void
}) {
  const pct =
    progress && progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0
  const epLabel = ep.episode !== undefined ? `E${String(ep.episode).padStart(2, '0')}` : null

  return (
    <div className="relative group">
    <button
      onClick={onClick}
      className="flex items-center gap-4 w-full text-left py-3 px-2 pr-16 rounded-lg hover:bg-white/5 transition-colors"
    >
      <span className="w-8 shrink-0 text-center text-sm font-medium text-neutral-500 group-hover:text-neutral-300 transition-colors">
        {epLabel ?? <Play size={13} className="mx-auto" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium leading-snug truncate">
          {ep.episodeTitle || ep.name}
        </p>
        {pct > 0 && !progress?.completed && (
          <div className="mt-1.5 h-0.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-accent-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        )}
        {progress?.completed && <p className="text-xs text-neutral-500 mt-0.5">Watched</p>}
      </div>
      {progress && progress.duration > 0 && !progress.completed && (
        <span className="shrink-0 text-xs text-neutral-500">
          {formatTime(progress.position)} / {formatTime(progress.duration)}
        </span>
      )}
      {progress?.completed && (
        <div className="shrink-0 w-5 h-5 rounded-full bg-accent-600/80 flex items-center justify-center">
          <Check size={11} className="text-white" />
        </div>
      )}
    </button>
      <button
        onClick={() => openInVlc(ep)}
        title="Open in VLC"
        aria-label="Open in VLC"
        className="absolute top-1/2 -translate-y-1/2 right-3 z-10 flex items-center gap-1 px-2 py-1 rounded-md bg-black/75 hover:bg-black/90 ring-1 ring-white/15 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <span className="w-2 h-2 rounded-sm bg-[#ff8800]" />
        <span className="text-[10px] font-semibold text-white tracking-wide">VLC</span>
      </button>
    </div>
  )
}

// ─── Show card ─────────────────────────────────────────────────────────────────

function ShowCard({
  showName,
  poster,
  seasons,
  episodes,
  isWatchLater,
  tmdbMeta,
  onClick,
  onWatchLater,
}: {
  showName: string
  poster: string
  seasons: number
  episodes: number
  isWatchLater?: boolean
  tmdbMeta?: TmdbMeta
  onClick: () => void
  onWatchLater?: (e: React.MouseEvent) => void
}) {
  const rating = tmdbMeta && !tmdbMeta.notFound && tmdbMeta.rating > 0 ? tmdbMeta.rating : null

  return (
    <button onClick={onClick} className="group text-left w-full">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-surface-300 ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all duration-200 group-hover:scale-[1.02] shadow-card group-hover:shadow-card-hover">
        <Poster
          src={poster}
          alt={showName}
          type="series"
          className="w-full h-full"
          tmdbPosterPath={tmdbMeta?.posterPath}
          blurhash={tmdbMeta?.blurhashPoster}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        {onWatchLater && (
          <button
            onClick={onWatchLater}
            title={isWatchLater ? 'Remove from Watch Later' : 'Add to Watch Later'}
            className={`absolute top-2 left-2 w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center ring-1 transition-all z-10 ${
              isWatchLater
                ? 'bg-accent-600/90 ring-accent-500/60 opacity-100'
                : 'bg-black/70 ring-white/20 opacity-0 group-hover:opacity-100 hover:bg-accent-600/80'
            }`}
          >
            <Bookmark size={13} fill={isWatchLater ? 'white' : 'none'} className="text-white" />
          </button>
        )}
        {rating !== null ? (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm rounded-full px-1.5 py-0.5 ring-1 ring-white/15">
            <Star size={9} fill="#f59e0b" className="text-warn-500 shrink-0" />
            <span className="text-micro font-semibold text-white">{rating.toFixed(1)}</span>
          </div>
        ) : (
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <p className="text-xs text-neutral-300">
              {seasons}S · {episodes}ep
            </p>
          </div>
        )}
      </div>
      <div className="mt-2 px-0.5">
        <p className="text-body text-white font-medium leading-tight line-clamp-2">
          {tmdbMeta?.title ?? showName}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {tmdbMeta?.year && (
            <span className="text-caption text-neutral-500">{tmdbMeta.year}</span>
          )}
          {tmdbMeta?.genres?.[0] && (
            <span className="text-caption text-neutral-600 truncate">{tmdbMeta.genres[0]}</span>
          )}
          {!tmdbMeta && (
            <span className="text-caption text-neutral-600">
              {seasons}S · {episodes}ep
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SeriesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(
    () => searchParams.get('group'),
  )

  useEffect(() => {
    const g = searchParams.get('group')
    if (g !== null) setSelectedGroup(g)
  }, [searchParams])

  const selectedShow = searchParams.get('show')
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  useEffect(() => { setSelectedSeason(null) }, [selectedShow])
  const [showFavs, setShowFavs] = useState(false)

  const { activeProfileId } = useProfileStore()
  const { series: excludedSeries } = useActiveExclusions()

  const isRowMode = !search.trim() && selectedGroup === null && !showFavs

  const watchLaterIds = useLiveQuery(async () => {
    if (!activeProfileId) return new Set<string>()
    const entries = await db.watchLater.where('profileId').equals(activeProfileId).toArray()
    return new Set(entries.map((e) => e.contentId))
  }, [activeProfileId])

  const toggleWatchLater = async (e: React.MouseEvent, showKey: string) => {
    e.stopPropagation()
    if (!activeProfileId) return
    if (watchLaterIds?.has(showKey)) {
      await removeFromWatchLater(activeProfileId, showKey)
      deleteRemoteWatchLater(activeProfileId, showKey)
    } else {
      const entry = await addToWatchLater(activeProfileId, showKey, 'series')
      pushWatchLater(entry)
    }
  }

  const seriesChannels = useMemo(
    () => channels.filter((c) => c.type === 'series' && !excludedSeries.has(c.groupTitle)),
    [channels, excludedSeries],
  )
  const showMap = useMemo(() => buildShowMap(seriesChannels), [seriesChannels])

  const groups = useMemo(() => {
    const seen = new Set<string>()
    for (const ch of seriesChannels) seen.add(ch.groupTitle)
    return Array.from(seen).map((title) => ({
      title,
      count: new Set(
        seriesChannels
          .filter((c) => c.groupTitle === title)
          .map((c) => normalizeShowKey(c.showName ?? c.name)),
      ).size,
    }))
  }, [seriesChannels])

  const favorites = useLiveQuery(() => db.favorites.where('kind').equals('series').toArray())
  const favIds = useMemo(() => new Set(favorites?.map((f) => f.id) ?? []), [favorites])

  const progressRecords = useLiveQuery(async () => {
    if (!selectedShow || !activeProfileId) return {}
    const showData = showMap.get(selectedShow)
    if (!showData) return {}
    const ids = Array.from(showData.seasons.values()).flat().map((c) => c.id)
    const profileIds = ids.map((id) => `${activeProfileId}:${id}`)
    const rows = await db.watchProgress.where('id').anyOf(profileIds).toArray()
    return Object.fromEntries(rows.map((r) => [r.channelId, r]))
  }, [selectedShow, showMap, activeProfileId])

  const recentProgress = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const all = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return all.sort((a, b) => b.lastWatched - a.lastWatched)
  }, [activeProfileId])

  const allShowNames = useMemo(() => Array.from(showMap.keys()), [showMap])

  const visibleShowNames = useMemo(() => {
    let names = allShowNames
    if (showFavs) names = names.filter((n) => favIds.has(n))
    if (selectedGroup !== null) names = names.filter((n) => showMap.get(n)?.group === selectedGroup)
    if (search.trim()) {
      const q = normalizeShowKey(search)
      names = names.filter((n) => n.includes(q))
    }
    if (!showFavs && selectedGroup === null && !search.trim()) return names.slice(0, RECENT_SHOWS)
    return names
  }, [allShowNames, showFavs, selectedGroup, search, showMap, favIds])

  // Continue Watching — one entry per show
  const continueWatchingSeries = useMemo(() => {
    if (!recentProgress?.length || !seriesChannels.length) return []
    const chanById = new Map(seriesChannels.map((c) => [c.id, c]))
    const seenShows = new Set<string>()
    const result: Array<{ progress: WatchProgress; channel: Channel; showKey: string }> = []
    for (const p of recentProgress) {
      if (p.completed || p.position <= 10) continue
      const ch = chanById.get(p.channelId)
      if (!ch) continue
      const showKey = normalizeShowKey(ch.showName ?? ch.name)
      if (seenShows.has(showKey)) continue
      seenShows.add(showKey)
      result.push({ progress: p as WatchProgress, channel: ch, showKey })
      if (result.length >= 12) break
    }
    return result
  }, [recentProgress, seriesChannels])

  // M3U group rows (top 6 by show count)
  const groupRows = useMemo(() => {
    if (!isRowMode) return []
    const byGroup = new Map<string, string[]>()
    for (const [key, entry] of showMap.entries()) {
      if (!byGroup.has(entry.group)) byGroup.set(entry.group, [])
      byGroup.get(entry.group)!.push(key)
    }
    return Array.from(byGroup.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([rawTitle, keys]) => ({
        rawTitle,
        title: rawTitle.replace(/^Series:\s*/, ''),
        keys: keys.slice(0, 20),
      }))
  }, [showMap, isRowMode])

  // Enrich shows for row mode (prioritise continue watching, then first N shows)
  const enrichChannels = useMemo(() => {
    const baseKeys = isRowMode
      ? (() => {
          const seen = new Set<string>()
          const result: string[] = []
          for (const { showKey } of continueWatchingSeries) {
            if (!seen.has(showKey)) { seen.add(showKey); result.push(showKey) }
          }
          for (const name of allShowNames) {
            if (result.length >= 200) break
            if (!seen.has(name)) { seen.add(name); result.push(name) }
          }
          return result
        })()
      : [...visibleShowNames]
    const keys =
      selectedShow && !baseKeys.includes(selectedShow)
        ? [...baseKeys, selectedShow]
        : baseKeys
    return keys.slice(0, 200).flatMap((key) => {
      const entry = showMap.get(key)
      if (!entry) return []
      const firstSeason = Array.from(entry.seasons.values())[0]
      return firstSeason?.[0] ? [firstSeason[0]] : []
    })
  }, [isRowMode, continueWatchingSeries, allShowNames, visibleShowNames, showMap, selectedShow])

  const tmdbMap = useTmdbEnrich(enrichChannels)

  // TMDB genre rows — built from enriched show data, populates progressively
  const tmdbGenreRows = useMemo(() => {
    if (!isRowMode) return []
    const byGenre = new Map<string, string[]>() // genre → showKeys
    for (const name of allShowNames) {
      const meta = tmdbMap.get(name)
      if (!meta || meta.notFound || !meta.genres?.length) continue
      for (const genre of meta.genres.slice(0, 3)) {
        if (!byGenre.has(genre)) byGenre.set(genre, [])
        byGenre.get(genre)!.push(name)
      }
    }
    return Array.from(byGenre.entries())
      .filter(([, keys]) => keys.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6)
      .map(([genre, keys]) => ({ genre, keys: keys.slice(0, 20) }))
  }, [allShowNames, tmdbMap, isRowMode])

  const didAutoPlay = useRef(false)
  useEffect(() => {
    if (didAutoPlay.current || !seriesChannels.length) return
    didAutoPlay.current = true
    const playingId = searchParams.get('playing')
    if (!playingId) return
    const ep = seriesChannels.find((c) => c.id === playingId)
    if (ep) play(ep)
  }, [seriesChannels, searchParams, play])

  const currentShowData = selectedShow ? showMap.get(selectedShow) : undefined

  const sortedSeasons = useMemo(() => {
    if (!currentShowData) return []
    return Array.from(currentShowData.seasons.keys()).sort((a, b) => a - b)
  }, [currentShowData])

  const autoSeason = useMemo(() => {
    if (selectedSeason !== null) return selectedSeason
    if (!currentShowData) return 1
    if (progressRecords && Object.keys(progressRecords).length > 0) {
      const lastRecord = Object.values(progressRecords)
        .filter((p) => !p.completed && p.position > 10)
        .sort((a, b) => b.lastWatched - a.lastWatched)[0]
      if (lastRecord) {
        for (const [s, eps] of currentShowData.seasons.entries()) {
          if (eps.some((e) => e.id === lastRecord.channelId)) return s
        }
      }
    }
    return sortedSeasons[0] ?? 1
  }, [selectedSeason, progressRecords, currentShowData, sortedSeasons])

  const handleSurprise = useCallback(() => {
    const pool = isRowMode ? allShowNames : visibleShowNames
    if (!pool.length) return
    const name = pool[Math.floor(Math.random() * pool.length)]
    navigate(`/series?show=${encodeURIComponent(name)}`)
  }, [isRowMode, allShowNames, visibleShowNames, navigate])

  const { count: gridCount, sentinelRef: gridSentinel, reset: resetGrid } = useInfiniteScroll()
  useEffect(() => {
    resetGrid()
    document.querySelector('main')?.scrollTo({ top: 0 })
  }, [search, selectedGroup, showFavs, resetGrid])

  // ── Detail view ────────────────────────────────────────────────────────────

  if (selectedShow) {
    const showData = currentShowData
    if (!showData) return null
    const { seasons, logo } = showData
    const isFav = favIds.has(selectedShow)
    const isWL = watchLaterIds?.has(selectedShow) ?? false
    const totalEps = Array.from(seasons.values()).reduce((a, b) => a + b.length, 0)
    const showTmdb = tmdbMap.get(selectedShow)
    const episodes = seasons.get(autoSeason) ?? []
    const backdrop = backdropUrl(showTmdb?.backdropPath ?? null, 1280)
    const poster = posterUrl(showTmdb?.posterPath ?? null, 342)

    return (
      <div className="flex flex-col">
        <div className="relative h-64 shrink-0 overflow-hidden bg-surface-300">
          {backdrop && (
            <img
              src={backdrop}
              alt=""
              aria-hidden="true"
              className="w-full h-full object-cover"
              decoding="async"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-surface-100/40 to-transparent" />
          <button
            onClick={() => navigate('/series')}
            className="absolute top-4 left-4 flex items-center gap-1.5 text-neutral-300 hover:text-white text-sm transition-colors bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5 ring-1 ring-white/15"
          >
            <ChevronRight size={14} className="rotate-180" /> All shows
          </button>
        </div>

        <div className="flex-1 px-6 pb-12 -mt-16 relative">
          <div className="flex gap-5 items-end mb-6">
            <div className="w-24 aspect-[2/3] rounded-lg overflow-hidden shrink-0 ring-1 ring-white/15 shadow-cinema bg-surface-300">
              <img
                src={poster ?? logo}
                alt={showData.displayName}
                className="w-full h-full object-cover"
                decoding="async"
                onError={(e) => { ;(e.target as HTMLImageElement).src = logo }}
              />
            </div>
            <div className="flex-1 min-w-0 pb-1">
              <h1 className="text-heading-xl text-white leading-tight mb-1">
                {showTmdb?.title ?? showData.displayName}
              </h1>
              <div className="flex items-center gap-3 flex-wrap text-caption text-neutral-400">
                <span>{sortedSeasons.length}S · {totalEps} ep</span>
                {showTmdb?.year && <span>{showTmdb.year}</span>}
                {showTmdb?.rating && showTmdb.rating > 0 && (
                  <span className="flex items-center gap-1">
                    <Star size={11} fill="#f59e0b" className="text-warn-500" />
                    {showTmdb.rating.toFixed(1)}
                  </span>
                )}
                {showTmdb?.genres?.slice(0, 3).map((g) => (
                  <span key={g} className="px-1.5 py-0.5 rounded-full ring-1 ring-white/15 text-neutral-500">{g}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mb-5">
            {episodes[0] && (
              <button
                onClick={() => { navigate(`/series?show=${encodeURIComponent(selectedShow!)}&playing=${episodes[0].id}`); play(episodes[0]) }}
                className="flex items-center gap-2 px-6 py-2.5 bg-white hover:bg-neutral-100 rounded-lg text-black font-semibold text-body transition-all active:scale-95"
              >
                <Play size={16} fill="black" />
                Play
              </button>
            )}
            {episodes[0] && (
              <button
                onClick={() => openInVlc(episodes[0])}
                title="Open in VLC"
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-body transition-all active:scale-95 ring-1 bg-white/8 ring-white/15 text-neutral-300 hover:bg-white/12"
              >
                <span className="w-2.5 h-2.5 rounded-sm bg-[#ff8800]" />
                VLC
              </button>
            )}
            <button
              onClick={(e) => toggleWatchLater(e, selectedShow)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-body transition-all active:scale-95 ring-1 ${
                isWL
                  ? 'bg-accent-600/20 ring-accent-600/40 text-accent-400'
                  : 'bg-white/8 ring-white/15 text-neutral-300 hover:bg-white/12'
              }`}
            >
              <Bookmark size={15} fill={isWL ? 'currentColor' : 'none'} />
              {isWL ? 'Saved' : 'Watch Later'}
            </button>
            <button
              onClick={() => toggleFavorite(selectedShow, 'series')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-body transition-all active:scale-95 ring-1 ${
                isFav
                  ? 'bg-warn-500/15 ring-warn-500/30 text-warn-400'
                  : 'bg-white/8 ring-white/15 text-neutral-300 hover:bg-white/12'
              }`}
            >
              <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
              {isFav ? 'Favorited' : 'Favorite'}
            </button>
          </div>

          {showTmdb?.overview && (
            <p className="text-body text-neutral-300 leading-relaxed mb-6">{showTmdb.overview}</p>
          )}

          <div className="flex items-center gap-3 mb-4">
            <SeasonDropdown seasons={sortedSeasons} selected={autoSeason} onChange={(s) => setSelectedSeason(s)} />
            <span className="text-neutral-500 text-sm">{episodes.length} episodes</span>
          </div>

          <div className="flex flex-col divide-y divide-white/5">
            {episodes.map((ep) => (
              <EpisodeRow
                key={ep.id}
                ep={ep}
                progress={progressRecords?.[ep.id]}
                onClick={() => { navigate(`/series?show=${encodeURIComponent(selectedShow!)}&playing=${ep.id}`); play(ep) }}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (seriesChannels.length === 0) {
    return (
      <div className="p-8">
        <EmptyState icon={<Tv size={40} />} title="No TV shows yet" description="Download your playlist in Settings to see shows here." />
      </div>
    )
  }

  return (
    <div className="flex flex-col md:flex-row">
      {/* Sidebar — always visible */}
      <div className="md:sticky md:top-0 md:self-start md:h-screen md:overflow-y-auto md:scrollbar-hide md:border-r md:border-white/5 md:shrink-0 md:p-4 md:pt-6">
        <GroupSidebar
          groups={groups}
          selected={showFavs ? '__favs__' : selectedGroup}
          onSelect={(g) => { setShowFavs(false); setSelectedGroup(g); setSearch('') }}
          recentLabel="Recently Added"
          cleanTitle={(t) => t.replace(/^Series:\s*/, '')}
          prefixItem={{
            label: (
              <>
                <Star size={12} fill={showFavs ? 'currentColor' : 'none'} className="shrink-0" />{' '}
                Favorites
              </>
            ),
            active: showFavs,
            onClick: () => { setShowFavs(!showFavs); setSelectedGroup(null); setSearch('') },
          }}
        />
      </div>

      <div className="flex-1 min-w-0">
        {isRowMode ? (
          // ── Netflix row mode ─────────────────────────────────────────────────
          <div className="px-4 sm:px-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-5 pb-6">
              <div>
                <h1 className="text-2xl font-bold text-white">TV Shows</h1>
                <p className="text-neutral-500 text-sm mt-0.5">
                  {allShowNames.length.toLocaleString()} shows
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSurprise}
                  title="Surprise me — pick a random show"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
                >
                  <Shuffle size={13} />
                  <span className="hidden sm:inline">Surprise me</span>
                </button>
                <div className="w-full sm:w-52">
                  <SearchBar
                    value={search}
                    onChange={(v) => { setSearch(v); setSelectedGroup(null); setShowFavs(false) }}
                    placeholder="Search shows…"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-10">
              {continueWatchingSeries.length > 0 && (
                <section>
                  <SectionHeader title="Continue Watching" />
                  <ScrollableRow>
                    {continueWatchingSeries.map(({ channel, progress, showKey }) => (
                      <div key={channel.id} className="flex-shrink-0 w-40">
                        <ContinueCard
                          channel={channel}
                          progress={progress}
                          tmdbMeta={tmdbMap.get(showKey)}
                          onClick={() => {
                            navigate(`/series?show=${encodeURIComponent(showKey)}&playing=${channel.id}`)
                            play(channel)
                          }}
                          onRemove={() => {
                            if (activeProfileId) {
                              clearProgress(activeProfileId, channel.id)
                              deleteRemoteProgress(activeProfileId, channel.id)
                            }
                          }}
                        />
                      </div>
                    ))}
                  </ScrollableRow>
                </section>
              )}

              <section>
                <SectionHeader title="Recently Added" />
                <ScrollableRow>
                  {allShowNames.slice(0, 20).map((name) => {
                    const data = showMap.get(name)!
                    const allEps = Array.from(data.seasons.values()).flat()
                    return (
                      <div key={name} className="flex-shrink-0 w-40">
                        <ShowCard
                          showName={data.displayName}
                          poster={data.logo}
                          seasons={data.seasons.size}
                          episodes={allEps.length}
                          isWatchLater={watchLaterIds?.has(name)}
                          tmdbMeta={tmdbMap.get(name)}
                          onClick={() => navigate(`/series?show=${encodeURIComponent(name)}`)}
                          onWatchLater={(e) => toggleWatchLater(e, name)}
                        />
                      </div>
                    )
                  })}
                </ScrollableRow>
              </section>

              {/* TMDB genre rows */}
              {tmdbGenreRows.map(({ genre, keys }) => (
                <section key={genre}>
                  <SectionHeader title={genre} />
                  <ScrollableRow>
                    {keys.map((name) => {
                      const data = showMap.get(name)
                      if (!data) return null
                      const allEps = Array.from(data.seasons.values()).flat()
                      return (
                        <div key={name} className="flex-shrink-0 w-40">
                          <ShowCard
                            showName={data.displayName}
                            poster={data.logo}
                            seasons={data.seasons.size}
                            episodes={allEps.length}
                            isWatchLater={watchLaterIds?.has(name)}
                            tmdbMeta={tmdbMap.get(name)}
                            onClick={() => navigate(`/series?show=${encodeURIComponent(name)}`)}
                            onWatchLater={(e) => toggleWatchLater(e, name)}
                          />
                        </div>
                      )
                    })}
                  </ScrollableRow>
                </section>
              ))}

              {/* M3U group rows */}
              {groupRows.map(({ rawTitle, title, keys }) => (
                <section key={rawTitle}>
                  <SectionHeader
                    title={title}
                    onSeeAll={() => { setSelectedGroup(rawTitle); setShowFavs(false) }}
                  />
                  <ScrollableRow>
                    {keys.map((name) => {
                      const data = showMap.get(name)
                      if (!data) return null
                      const allEps = Array.from(data.seasons.values()).flat()
                      return (
                        <div key={name} className="flex-shrink-0 w-40">
                          <ShowCard
                            showName={data.displayName}
                            poster={data.logo}
                            seasons={data.seasons.size}
                            episodes={allEps.length}
                            isWatchLater={watchLaterIds?.has(name)}
                            tmdbMeta={tmdbMap.get(name)}
                            onClick={() => navigate(`/series?show=${encodeURIComponent(name)}`)}
                            onWatchLater={(e) => toggleWatchLater(e, name)}
                          />
                        </div>
                      )
                    })}
                  </ScrollableRow>
                </section>
              ))}
            </div>
          </div>
        ) : (
          // ── Grid mode ─────────────────────────────────────────────────────────
          <div className="p-6 pb-12">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-4">
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <h1 className="text-xl font-bold text-white truncate">
                  {search.trim()
                    ? `Results for "${search}"`
                    : showFavs
                    ? 'Favorites'
                    : selectedGroup !== null
                    ? selectedGroup.replace(/^Series:\s*/, '')
                    : 'Recently Added'}
                </h1>
                <p className="text-neutral-500 text-sm shrink-0">{visibleShowNames.length} shows</p>
                <button
                  onClick={handleSurprise}
                  title="Surprise me — pick a random show"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
                >
                  <Shuffle size={13} />
                  <span className="hidden sm:inline">Surprise me</span>
                </button>
              </div>
              <div className="sm:w-52">
                <SearchBar
                  value={search}
                  onChange={(v) => { setSearch(v); setSelectedGroup(null); setShowFavs(false) }}
                  placeholder="Search shows…"
                />
              </div>
            </div>

            {visibleShowNames.length === 0 ? (
              <EmptyState
                icon={<Tv size={36} />}
                title="No results"
                description={showFavs ? 'No favorites yet.' : 'Try a different search.'}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {visibleShowNames.slice(0, gridCount).map((name) => {
                    const data = showMap.get(name)!
                    const allEps = Array.from(data.seasons.values()).flat()
                    return (
                      <ShowCard
                        key={name}
                        showName={data.displayName}
                        poster={data.logo}
                        seasons={data.seasons.size}
                        episodes={allEps.length}
                        isWatchLater={watchLaterIds?.has(name)}
                        tmdbMeta={tmdbMap.get(name)}
                        onClick={() => navigate(`/series?show=${encodeURIComponent(name)}`)}
                        onWatchLater={(e) => toggleWatchLater(e, name)}
                      />
                    )
                  })}
                </div>
                <div ref={gridSentinel} className="h-1" />
                {gridCount < visibleShowNames.length && (
                  <p className="text-center text-xs text-neutral-600 pb-8">
                    Showing {Math.min(gridCount, visibleShowNames.length).toLocaleString()} of{' '}
                    {visibleShowNames.length.toLocaleString()}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
