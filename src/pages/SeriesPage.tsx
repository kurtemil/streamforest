import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Tv, ChevronRight, ChevronDown, Star, Play, Check } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { db, toggleFavorite } from '@/services/db'
import { Poster } from '@/components/ui/Poster'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'
import { ProgressRing } from '@/components/ui/ProgressRing'
import type { Channel } from '@/types'
import { formatTime } from '@/lib/time'

const RECENT_SHOWS = 40

// ─── Data helpers ──────────────────────────────────────────────────────────────

import { normalizeShowKey } from '@/lib/utils'

type ShowEntry = { seasons: Map<number, Channel[]>; logo: string; group: string; displayName: string }

function buildShowMap(channels: Channel[]) {
  const shows = new Map<string, ShowEntry>()
  for (const ch of channels) {
    const rawName = ch.showName ?? ch.name
    const key = normalizeShowKey(rawName)
    if (!shows.has(key)) shows.set(key, { seasons: new Map(), logo: ch.logo, group: ch.groupTitle, displayName: rawName })
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

function SeasonDropdown({ seasons, selected, onChange }: {
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
              onClick={() => { onChange(s); setOpen(false) }}
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

function EpisodeRow({ ep, progress, onClick }: {
  ep: Channel
  progress?: { position: number; duration: number; completed: boolean; lastWatched?: number }
  onClick: () => void
}) {
  const pct = progress && progress.duration > 0 ? (progress.position / progress.duration) * 100 : 0

  return (
    <button onClick={onClick} className="flex items-start gap-3 w-full text-left p-3 rounded-lg hover:bg-white/5 transition-colors group">
      {/* Thumbnail */}
      <div className="relative w-36 aspect-video rounded-md overflow-hidden shrink-0 bg-[#1e1e1e]">
        <Poster src={ep.logo} alt={ep.name} type="series" className="w-full h-full" />
        {pct > 0 && !progress?.completed && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
            <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        {progress?.completed && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-7 h-7 rounded-full bg-accent-600/80 flex items-center justify-center">
              <Check size={13} className="text-white" />
            </div>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <div className="w-9 h-9 rounded-full bg-black/60 flex items-center justify-center">
            <Play size={16} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-sm text-white font-medium leading-snug">
          {ep.episode !== undefined ? `E${String(ep.episode).padStart(2, '0')}` : ''}
          {ep.episodeTitle ? ` · ${ep.episodeTitle}` : ''}
        </p>
        {progress && (
          <p className="text-xs text-neutral-500 mt-1">
            {progress.completed
              ? 'Watched'
              : progress.duration > 0
              ? `${formatTime(progress.position)} / ${formatTime(progress.duration)}`
              : 'Not started'}
          </p>
        )}
      </div>

      {pct > 0 && !progress?.completed && (
        <div className="shrink-0 self-center mr-1">
          <ProgressRing pct={pct} size={28} stroke={2} />
        </div>
      )}
    </button>
  )
}

// ─── Show card ─────────────────────────────────────────────────────────────────

function ShowCard({ showName, poster, seasons, episodes, onClick }: {
  showName: string; poster: string; seasons: number; episodes: number; onClick: () => void
}) {
  return (
    <button onClick={onClick} className="group text-left animate-fade-in">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1a1a] ring-1 ring-white/5 group-hover:ring-accent-600/50 transition-all duration-200 group-hover:scale-[1.02] group-hover:shadow-xl group-hover:shadow-black/60">
        <Poster src={poster} alt={showName} type="series" className="w-full h-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
            <Play size={18} fill="white" className="text-white ml-0.5" />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-xs text-neutral-300">{seasons}S · {episodes}ep</p>
        </div>
      </div>
      <p className="mt-2 px-0.5 text-sm text-white font-medium leading-tight line-clamp-2">{showName}</p>
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
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [selectedShow, setSelectedShow] = useState<string | null>(() => searchParams.get('show'))
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [showFavs, setShowFavs] = useState(false)

  const seriesChannels = useMemo(() => channels.filter((c) => c.type === 'series'), [channels])
  const showMap = useMemo(() => buildShowMap(seriesChannels), [seriesChannels])

  const groups = useMemo(() => {
    const seen = new Set<string>()
    for (const ch of seriesChannels) seen.add(ch.groupTitle)
    return Array.from(seen).map((title) => ({
      title,
      count: new Set(seriesChannels.filter((c) => c.groupTitle === title).map((c) => normalizeShowKey(c.showName ?? c.name))).size,
    }))
  }, [seriesChannels])

  const favorites = useLiveQuery(() => db.favorites.where('kind').equals('series').toArray())
  const favIds = useMemo(() => new Set(favorites?.map((f) => f.id) ?? []), [favorites])

  // Only load progress for the currently open show
  const progressRecords = useLiveQuery(async () => {
    if (!selectedShow) return {}
    const showData = showMap.get(selectedShow)
    if (!showData) return {}
    const ids = Array.from(showData.seasons.values()).flat().map((c) => c.id)
    const rows = await db.watchProgress.where('id').anyOf(ids).toArray()
    return Object.fromEntries(rows.map((r) => [r.id, r]))
  }, [selectedShow, showMap])

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

  // Auto-play episode from URL params on initial load (e.g. page reload)
  const didAutoPlay = useRef(false)
  useEffect(() => {
    if (didAutoPlay.current || !seriesChannels.length) return
    didAutoPlay.current = true
    const playingId = searchParams.get('playing')
    if (!playingId) return
    const ep = seriesChannels.find(c => c.id === playingId)
    if (ep) play(ep)
  }, [seriesChannels, searchParams, play])

  // ── Detail view data (hooks must stay outside conditionals) ───────────────

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
          if (eps.some((e) => e.id === lastRecord.id)) return s
        }
      }
    }
    return sortedSeasons[0] ?? 1
  }, [selectedSeason, progressRecords, currentShowData, sortedSeasons])

  // ── Detail view ────────────────────────────────────────────────────────────

  if (selectedShow) {
    const showData = currentShowData
    if (!showData) { setSelectedShow(null); return null }
    const { seasons, logo } = showData
    const isFav = favIds.has(selectedShow)
    const totalEps = Array.from(seasons.values()).reduce((a, b) => a + b.length, 0)

    const episodes = seasons.get(autoSeason) ?? []

    return (
      <div className="p-6 pb-12 animate-slide-up overflow-y-auto h-full">
        {/* Back */}
        <button
          onClick={() => { navigate('/series'); setSelectedShow(null); setSelectedSeason(null) }}
          className="flex items-center gap-1.5 text-neutral-400 hover:text-white text-sm mb-6 transition-colors"
        >
          <ChevronRight size={16} className="rotate-180" /> All shows
        </button>

        {/* Hero */}
        <div className="flex gap-6 mb-8">
          <div className="w-28 aspect-[2/3] rounded-lg overflow-hidden shrink-0 ring-1 ring-white/10">
            <Poster src={logo} alt={selectedShow} type="series" className="w-full h-full" />
          </div>
          <div className="flex flex-col justify-end gap-3">
            <h1 className="text-3xl font-bold text-white leading-tight">{showData.displayName}</h1>
            <p className="text-neutral-400 text-sm">
              {sortedSeasons.length} season{sortedSeasons.length !== 1 ? 's' : ''} · {totalEps} episodes
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleFavorite(selectedShow, 'series')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isFav
                    ? 'bg-accent-600/30 text-accent-400 ring-1 ring-accent-600/50'
                    : 'bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10'
                }`}
              >
                <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
                {isFav ? 'Favorited' : 'Add to Favorites'}
              </button>
            </div>
          </div>
        </div>

        {/* Season selector + episodes */}
        <div className="flex items-center gap-3 mb-4">
          <SeasonDropdown
            seasons={sortedSeasons}
            selected={autoSeason}
            onChange={(s) => setSelectedSeason(s)}
          />
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
    )
  }

  // ── Grid view ──────────────────────────────────────────────────────────────

  if (seriesChannels.length === 0) {
    return (
      <div className="p-8">
        <EmptyState icon={<Tv size={40} />} title="No TV shows yet" description="Download your playlist in Settings to see shows here." />
      </div>
    )
  }

  const heading = search.trim()
    ? `Results for "${search}"`
    : showFavs ? 'Favorites'
    : selectedGroup !== null ? selectedGroup.replace(/^Series:\s*/, '')
    : 'Recently Added'

  return (
    <div className="flex h-full overflow-hidden">
      {/* Group sidebar */}
      <div className="p-4 pt-6 overflow-y-auto scrollbar-hide border-r border-white/5 flex flex-col gap-3">
        <button
          onClick={() => { setShowFavs(!showFavs); setSelectedGroup(null); setSearch('') }}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            showFavs ? 'bg-accent-600/20 text-accent-400 font-medium' : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Star size={13} fill={showFavs ? 'currentColor' : 'none'} /> Favorites
        </button>
        <GroupSidebar
          groups={groups}
          selected={showFavs ? '__favs__' : selectedGroup}
          onSelect={(g) => { setShowFavs(false); setSelectedGroup(g); setSearch('') }}
          recentLabel="Recently Added"
          cleanTitle={(t) => t.replace(/^Series:\s*/, '')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 pb-12 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">{heading}</h1>
          <div className="flex items-center gap-3">
            <p className="text-neutral-500 text-sm">{visibleShowNames.length} shows</p>
            <div className="w-52">
              <SearchBar
                value={search}
                onChange={(v) => { setSearch(v); setSelectedGroup(null); setShowFavs(false) }}
                placeholder="Search shows…"
              />
            </div>
          </div>
        </div>

        {visibleShowNames.length === 0 ? (
          <EmptyState
            icon={<Tv size={36} />}
            title="No results"
            description={showFavs ? 'No favorites yet.' : 'Try a different search.'}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleShowNames.map((name) => {
              const data = showMap.get(name)!
              const allEps = Array.from(data.seasons.values()).flat()
              return (
                <ShowCard
                  key={name}
                  showName={data.displayName}
                  poster={data.logo}
                  seasons={data.seasons.size}
                  episodes={allEps.length}
                  onClick={() => { navigate(`/series?show=${encodeURIComponent(name)}`); setSelectedShow(name); setSelectedSeason(null) }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
