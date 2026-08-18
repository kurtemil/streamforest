import { useState, useMemo, useEffect, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Radio, RefreshCw, Clock, ChevronRight, AlertCircle, Shuffle } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useEpgStore } from '@/stores/epgStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import { db } from '@/services/db'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'
import { openInVlc } from '@/lib/vlc'
import type { Channel, EpgProgram } from '@/types'

const RECENT_COUNT = 80

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number): string {
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ── Channel row ────────────────────────────────────────────────────────────────

interface ChannelRowProps {
  channel: Channel
  programs: EpgProgram[]
  onPlay: () => void
  /** Passed in so the whole page advances on one timer instead of one per row. */
  now: number
}

function ChannelRow({ channel, programs, onPlay, now }: ChannelRowProps) {
  const current = programs.find(p => p.start <= now && p.end > now) ?? null
  const next    = programs.find(p => p.start > now) ?? null

  const pct = current
    ? Math.min(100, ((now - current.start) / (current.end - current.start)) * 100)
    : 0
  const remaining = current ? current.end - now : null

  return (
    <div className="group relative">
      <button
        onClick={() => openInVlc(channel)}
        title="Open in VLC"
        aria-label="Open in VLC"
        className="absolute top-1/2 -translate-y-1/2 right-3 z-10 flex items-center gap-1 px-2 py-1 rounded-md bg-black/75 hover:bg-black/90 ring-1 ring-white/15 opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
      >
        <span className="w-2 h-2 rounded-sm bg-[#ff8800]" />
        <span className="text-[10px] font-semibold text-white tracking-wide">VLC</span>
      </button>
    <button
      onClick={onPlay}
      className="w-full flex items-stretch gap-0 rounded-xl ring-1 ring-white/5 hover:ring-accent-600/40 bg-white/[0.02] hover:bg-white/[0.05] transition-all duration-150 overflow-hidden text-left"
    >
      {/* Left: channel identity */}
      <div className="w-44 shrink-0 flex flex-col items-center justify-center gap-1.5 px-4 py-3 border-r border-white/5">
        <div className="w-16 h-10 rounded-md bg-surface-300 flex items-center justify-center overflow-hidden shrink-0">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt={channel.name}
              className="max-w-full max-h-full object-contain p-1"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              loading="lazy"
            />
          ) : (
            <Radio size={16} className="text-neutral-600" />
          )}
        </div>
        <p className="text-[11px] text-neutral-400 group-hover:text-neutral-200 text-center leading-tight line-clamp-2 transition-colors max-w-full">
          {channel.name}
        </p>
        <span className="flex items-center gap-1 text-[9px] font-semibold text-red-400/80 tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          LIVE
        </span>
      </div>

      {/* Right: EPG strip */}
      <div className="flex-1 min-w-0 flex flex-col justify-center px-4 py-3 gap-1.5">
        {current ? (
          <>
            <div className="flex items-baseline gap-3 min-w-0">
              <p className="text-sm font-semibold text-white truncate flex-1 min-w-0">
                {current.title}
              </p>
              {remaining !== null && (
                <span className="text-xs text-neutral-500 shrink-0 tabular-nums">
                  {formatDuration(remaining)} left
                </span>
              )}
              {next && (
                <div className="flex items-center gap-1.5 shrink-0 max-w-[200px]">
                  <ChevronRight size={12} className="text-neutral-600" />
                  <p className="text-xs text-neutral-500 truncate">{next.title}</p>
                  <span className="text-xs text-neutral-600 shrink-0">{formatTime(next.start)}</span>
                </div>
              )}
            </div>
            <div className="h-0.5 rounded-full bg-white/8 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-1000"
                style={{ width: `${pct}%` }}
              />
            </div>
            {current.category && (
              <p className="text-[10px] text-neutral-600 truncate">{current.category}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-600 italic">No guide data</p>
        )}
      </div>
    </button>
    </div>
  )
}

// ── EPG status bar ─────────────────────────────────────────────────────────────

function EpgStatusBar({ m3uUrl }: { m3uUrl: string }) {
  const { status, lastFetched, error, progress, refresh, resolveUrl, isStale } = useEpgStore()
  const stale = isStale()
  const loading = status === 'loading'
  const canLoad = !!resolveUrl(m3uUrl)
  const epgReady = status === 'ready' && !stale

  const handleRefresh = useCallback(() => {
    refresh(m3uUrl)
  }, [m3uUrl, refresh])

  if (epgReady) return null

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm mb-4 ${
      error
        ? 'bg-red-500/10 ring-1 ring-red-500/20 text-red-300'
        : 'bg-white/[0.03] ring-1 ring-white/8 text-neutral-400'
    }`}>
      {error ? (
        <AlertCircle size={14} className="shrink-0 text-red-400" />
      ) : (
        <Clock size={14} className="shrink-0" />
      )}
      <span className="flex-1 min-w-0 truncate">
        {loading && progress
          ? progress
          : error
          ? `EPG error: ${error}`
          : lastFetched
          ? `Guide data is ${Math.floor((Date.now() - lastFetched) / 3600000)}h old`
          : 'No guide data loaded yet'}
      </span>
      {canLoad && (
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-white/70 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait shrink-0"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Loading…' : 'Load EPG'}
        </button>
      )}
      {!canLoad && !loading && (
        <span className="text-xs text-neutral-600 shrink-0">Set EPG URL in Settings</span>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

// A guide that shows the wrong time is worse than no guide, and this one stopped
// at whatever second it first rendered.
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Land near the top of each minute rather than drifting from mount time.
    const toNextMinute = 60_000 - (Date.now() % 60_000)
    let interval: ReturnType<typeof setInterval> | undefined
    const align = setTimeout(() => {
      setNow(Date.now())
      interval = setInterval(() => setNow(Date.now()), 60_000)
    }, toNextMinute)
    return () => { clearTimeout(align); if (interval) clearInterval(interval) }
  }, [])
  return now
}

export function LiveTVPage() {
  const now = useMinuteTick()
  const { channels, m3uUrl } = usePlaylistStore()
  const { play } = usePlayerStore()
  const { programs, loadFromDB, resolveByName } = useEpgStore()
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const { live: excludedLive } = useActiveExclusions()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)

  useEffect(() => {
    loadFromDB()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const live = useMemo(
    () => channels.filter((c) => c.type === 'live' && !excludedLive.has(c.groupTitle)),
    [channels, excludedLive]
  )

  const recentProgress = useLiveQuery(async () => {
    if (!activeProfileId) return []
    const all = await db.watchProgress.where('profileId').equals(activeProfileId).toArray()
    return all.sort((a, b) => b.lastWatched - a.lastWatched)
  }, [activeProfileId]) ?? []

  const recentLive = useMemo(() => {
    if (!recentProgress.length || !live.length) return []
    const liveById = new Map(live.map((c) => [c.id, c]))
    return recentProgress
      .map((p) => liveById.get(p.channelId))
      .filter((c): c is Channel => c !== undefined)
      .slice(0, 10)
  }, [recentProgress, live])


  const groups = useMemo(() => {
    const seen = new Set<string>()
    const counts = new Map<string, number>()
    for (const c of live) {
      if (!seen.has(c.groupTitle)) seen.add(c.groupTitle)
      counts.set(c.groupTitle, (counts.get(c.groupTitle) ?? 0) + 1)
    }
    return Array.from(seen).map((title) => ({ title, count: counts.get(title) ?? 0 }))
  }, [live])

  const filtered = useMemo((): Channel[] => {
    if (search.trim()) {
      const q = search.toLowerCase()
      return live.filter((c) => c.name.toLowerCase().includes(q))
    }
    if (selectedGroup !== null) return live.filter((c) => c.groupTitle === selectedGroup)
    return live.slice(0, RECENT_COUNT)
  }, [live, selectedGroup, search])

  if (live.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Radio size={40} />}
          title="No live channels yet"
          description="Download your playlist in Settings to see live TV here."
        />
      </div>
    )
  }

  const handleSurprise = () => {
    if (!filtered.length) return
    const ch = filtered[Math.floor(Math.random() * filtered.length)]
    play(ch)
  }

  const heading = search.trim()
    ? `Results for "${search}"`
    : selectedGroup !== null ? selectedGroup
    : 'Recently Added'

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* Groups sidebar / mobile pills */}
      <div className="md:p-4 md:pt-6 md:overflow-y-auto md:scrollbar-hide md:border-r md:border-white/5 md:shrink-0">
        <GroupSidebar
          groups={groups}
          selected={selectedGroup}
          onSelect={(g) => { setSelectedGroup(g); setSearch('') }}
          browseLabel="Browse"
        />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-12 min-w-0">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-4">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <h1 className="text-xl font-bold text-white truncate">{heading}</h1>
            <p className="text-neutral-500 text-sm shrink-0">{filtered.length} channels</p>
            <button
              onClick={handleSurprise}
              title="Surprise me — pick a random channel"
              className="flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-3.5 py-2.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
            >
              <Shuffle size={13} />
              <span className="hidden sm:inline">Surprise me</span>
            </button>
          </div>
          <div className="sm:w-52">
            <SearchBar
              value={search}
              onChange={(v) => { setSearch(v); setSelectedGroup(null) }}
              placeholder="Search channels…"
            />
          </div>
        </div>

        {/* EPG status / refresh prompt */}
        <EpgStatusBar m3uUrl={m3uUrl} />

        {/* Latest watched */}
        {!search.trim() && selectedGroup === null && recentLive.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-widest mb-2">Latest watched</p>
            <div className="flex flex-col gap-1.5">
              {recentLive.map((ch) => {
                const epgId = ch.tvgId || resolveByName(ch.name) || ''
                return (
                  <ChannelRow
                    key={ch.id}
                    channel={ch}
                    programs={epgId ? (programs.get(epgId) ?? []) : []}
                    now={now}
                    onPlay={() => play(ch)}
                  />
                )
              })}
            </div>
            <div className="mt-4 border-t border-white/5" />
          </div>
        )}

        {/* Channel rows */}
        <div className="flex flex-col gap-1.5">
          {filtered.map((ch) => {
            const epgId = ch.tvgId || resolveByName(ch.name) || ''
            return (
              <ChannelRow
                key={ch.id}
                channel={ch}
                programs={epgId ? (programs.get(epgId) ?? []) : []}
                now={now}
                onPlay={() => play(ch)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
