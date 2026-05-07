import { useState, useMemo, useRef, useEffect, type MouseEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Film } from 'lucide-react'
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
    <div className="flex h-full overflow-hidden">
      <div className="p-4 pt-6 overflow-y-auto scrollbar-hide border-r border-white/5 shrink-0">
        <GroupSidebar
          groups={groups}
          selected={selectedGroup}
          onSelect={handleGroupSelect}
          recentLabel="Recently Added"
          cleanTitle={cleanGroup}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <h1 className="text-heading-xl text-white">{heading}</h1>
          <div className="flex items-center gap-3">
            <p className="text-neutral-500 text-caption">{filtered.length.toLocaleString()} titles</p>
            <div className="w-52">
              <SearchBar value={search} onChange={setSearch} placeholder="Search movies…" />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={<Film size={36} />} title="No results" description="Try a different search term." />
          </div>
        ) : (
          <div className="flex-1 min-h-0 px-6 pb-6">
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
        )}
      </div>
    </div>
  )
}
