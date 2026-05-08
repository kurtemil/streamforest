import { useState, useMemo, useRef, useEffect, useCallback, type MouseEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Film, Shuffle } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useProfileStore } from '@/stores/profileStore'
import { useActiveExclusions } from '@/hooks/useActiveExclusions'
import { db, addToWatchLater, removeFromWatchLater } from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater } from '@/services/sync'
import { MovieCard } from '@/components/movies/MovieCard'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'
import { VirtualPosterGrid } from '@/ui'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'

const RECENT_COUNT = 200          // when no group/search is active, show the 200 most recent
const ENRICH_LIMIT = 200          // max items to enrich per view
const cleanGroup = (t: string) => t.replace(/^VOD:\s*/, '')

export function MoviesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  const { activeProfileId } = useProfileStore()
  const { movie: excludedMovies } = useActiveExclusions()
  const movies = useMemo(
    () => channels.filter((c) => c.type === 'movie' && !excludedMovies.has(c.groupTitle)),
    [channels, excludedMovies]
  )

  const didAutoPlay = useRef(false)
  useEffect(() => {
    if (didAutoPlay.current || !movies.length) return
    didAutoPlay.current = true
    const playingId = searchParams.get('playing')
    if (!playingId) return
    const movie = movies.find(m => m.id === playingId)
    if (movie) play(movie)
  }, [movies, searchParams, play])

  // Groups in M3U order (first appearance), no alphabetical sort
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const counts = new Map<string, number>()
    for (const m of movies) {
      if (!seen.has(m.groupTitle)) seen.add(m.groupTitle)
      counts.set(m.groupTitle, (counts.get(m.groupTitle) ?? 0) + 1)
    }
    return Array.from(seen).map((title) => ({ title, count: counts.get(title) ?? 0 }))
  }, [movies])

  const filtered = useMemo(() => {
    if (search.trim()) {
      const q = search.toLowerCase()
      return movies.filter((m) => (m.movieTitle ?? m.name).toLowerCase().includes(q))
    }
    if (selectedGroup !== null) return movies.filter((m) => m.groupTitle === selectedGroup)
    return movies.slice(0, RECENT_COUNT)
  }, [movies, selectedGroup, search])

  // Watch progress is now queried for the entire filtered set (cheap — just an indexed lookup
  // on a small id list). We could narrow to the rendered window if perf becomes an issue.
  const progressMap = useLiveQuery(async () => {
    if (!activeProfileId) return {}
    const profileIds = filtered.map((m) => `${activeProfileId}:${m.id}`)
    const rows = await db.watchProgress.where('id').anyOf(profileIds).toArray()
    return Object.fromEntries(rows.map((r) => [r.channelId, r]))
  }, [filtered, activeProfileId])

  const tmdbMap = useTmdbEnrich(filtered.slice(0, ENRICH_LIMIT))

  const watchLaterSet = useLiveQuery(async () => {
    if (!activeProfileId) return new Set<string>()
    const entries = await db.watchLater.where('profileId').equals(activeProfileId).toArray()
    return new Set(entries.map((e) => e.contentId))
  }, [activeProfileId])

  const toggleWatchLater = async (channelId: string, e: MouseEvent) => {
    e.stopPropagation()
    if (!activeProfileId) return
    if (watchLaterSet?.has(channelId)) {
      await removeFromWatchLater(activeProfileId, channelId)
      deleteRemoteWatchLater(activeProfileId, channelId)
    } else {
      const entry = await addToWatchLater(activeProfileId, channelId, 'movie')
      pushWatchLater(entry)
    }
  }

  const handleGroupSelect = (g: string | null) => {
    setSelectedGroup(g)
    setSearch('')
  }

  const handleSurprise = useCallback(() => {
    if (!filtered.length) return
    const m = filtered[Math.floor(Math.random() * filtered.length)]
    navigate(`/movies?playing=${m.id}`)
    play(m)
  }, [filtered, navigate, play])

  if (movies.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<Film size={40} />}
          title="No movies yet"
          description="Download your playlist in Settings to see movies here."
        />
      </div>
    )
  }

  const heading = search.trim()
    ? `Results for "${search}"`
    : selectedGroup !== null
    ? cleanGroup(selectedGroup)
    : 'Recently Added'

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      <div className="md:p-4 md:pt-6 md:overflow-y-auto md:scrollbar-hide md:border-r md:border-white/5 md:shrink-0">
        <GroupSidebar
          groups={groups}
          selected={selectedGroup}
          onSelect={handleGroupSelect}
          recentLabel="Recently Added"
          cleanTitle={cleanGroup}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header — stacks vertically on mobile */}
        <div className="px-4 sm:px-6 pt-5 pb-3 shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="flex items-center justify-between sm:justify-start gap-3">
            <h1 className="text-xl font-bold text-white truncate">{heading}</h1>
            <p className="text-neutral-500 text-caption shrink-0">{filtered.length.toLocaleString()} titles</p>
            <button
              onClick={handleSurprise}
              title="Surprise me — pick a random movie"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-accent-600/20 hover:text-accent-400 text-neutral-500 text-xs font-medium transition-colors shrink-0"
            >
              <Shuffle size={13} />
              <span className="hidden sm:inline">Surprise me</span>
            </button>
          </div>
          <div className="sm:w-52">
            <SearchBar value={search} onChange={setSearch} placeholder="Search movies…" />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={<Film size={36} />} title="No results" description="Try a different search term." />
          </div>
        ) : (
          <>
            {/* Mobile: plain scrollable grid — avoids VirtualPosterGrid height measurement issues */}
            <div className="md:hidden overflow-y-auto flex-1 px-4 pb-6">
              <div className="grid grid-cols-2 gap-4">
                {filtered.map((m) => (
                  <MovieCard
                    key={m.id}
                    channel={m}
                    progress={progressMap?.[m.id]}
                    isWatchLater={watchLaterSet?.has(m.id)}
                    tmdbMeta={tmdbMap.get(m.id)}
                    onClick={() => { navigate(`/movies?playing=${m.id}`); play(m) }}
                    onWatchLater={(e) => toggleWatchLater(m.id, e)}
                  />
                ))}
              </div>
            </div>
            {/* Desktop: virtualized grid */}
            <div className="hidden md:flex flex-1 min-h-0 px-6 pb-6">
              <VirtualPosterGrid
                items={filtered}
                getKey={(m) => m.id}
                renderItem={(m) => (
                  <MovieCard
                    channel={m}
                    progress={progressMap?.[m.id]}
                    isWatchLater={watchLaterSet?.has(m.id)}
                    tmdbMeta={tmdbMap.get(m.id)}
                    onClick={() => { navigate(`/movies?playing=${m.id}`); play(m) }}
                    onWatchLater={(e) => toggleWatchLater(m.id, e)}
                  />
                )}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
