import { useState, useMemo, useRef, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Film } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { db } from '@/services/db'
import { MovieCard } from '@/components/movies/MovieCard'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'

const PAGE_SIZE = 60
const RECENT_COUNT = 40
const cleanGroup = (t: string) => t.replace(/^VOD:\s*/, '')

export function MoviesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const movies = useMemo(() => channels.filter((c) => c.type === 'movie'), [channels])

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

  const visible = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page])

  const progressMap = useLiveQuery(async () => {
    const ids = visible.map((m) => m.id)
    const rows = await db.watchProgress.where('id').anyOf(ids).toArray()
    return Object.fromEntries(rows.map((r) => [r.id, r]))
  }, [visible])

  const handleGroupSelect = (g: string | null) => {
    setSelectedGroup(g)
    setPage(1)
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
      <div className="p-4 pt-6 overflow-y-auto scrollbar-hide border-r border-white/5">
        <GroupSidebar
          groups={groups}
          selected={selectedGroup}
          onSelect={handleGroupSelect}
          recentLabel="Recently Added"
          cleanTitle={cleanGroup}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-12 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">{heading}</h1>
          <div className="flex items-center gap-3">
            <p className="text-neutral-500 text-sm">{filtered.length} titles</p>
            <div className="w-52">
              <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1) }} placeholder="Search movies…" />
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={<Film size={36} />} title="No results" description="Try a different search term." />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visible.map((m) => (
                <MovieCard key={m.id} channel={m} progress={progressMap?.[m.id]} onClick={() => { navigate(`/movies?playing=${m.id}`); play(m) }} />
              ))}
            </div>
            {visible.length < filtered.length && (
              <button
                onClick={() => setPage((p) => p + 1)}
                className="mt-8 mx-auto block px-6 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-sm transition-colors"
              >
                Show more ({filtered.length - visible.length} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
