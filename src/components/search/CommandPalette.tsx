import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Clock, Film, Tv, Radio, X, ArrowRight } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useSearchStore } from '@/stores/searchStore'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { normalizeShowKey } from '@/lib/utils'
import type { Channel } from '@/types'

const STORAGE_KEY = 'sf_recent_searches'
const MAX_RECENT = 8
const MAX_PER_GROUP = 5

interface SearchResult {
  id: string
  title: string
  subtitle: string
  type: 'movie' | 'series' | 'live'
  channel: Channel
}

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function saveRecent(q: string) {
  const next = [q, ...loadRecent().filter((s) => s !== q)].slice(0, MAX_RECENT)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function removeRecent(q: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadRecent().filter((s) => s !== q)))
}

function match(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

export function CommandPalette() {
  const { open, setOpen } = useSearchStore()
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>(loadRecent)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setRecentSearches(loadRecent())
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const { movies, series, live } = useMemo((): { movies: SearchResult[]; series: SearchResult[]; live: SearchResult[] } => {
    if (!query.trim()) return { movies: [], series: [], live: [] }
    const q = query.trim()
    const movies: SearchResult[] = []
    const series: SearchResult[] = []
    const live: SearchResult[] = []
    const showSeen = new Set<string>()

    for (const ch of channels) {
      if (ch.type === 'movie') {
        if (movies.length < MAX_PER_GROUP) {
          const title = ch.movieTitle ?? ch.name
          if (match(title, q)) {
            movies.push({ id: ch.id, title, subtitle: ch.year ? String(ch.year) : 'Movie', type: 'movie', channel: ch })
          }
        }
      } else if (ch.type === 'series' && ch.showName) {
        if (series.length < MAX_PER_GROUP) {
          const key = normalizeShowKey(ch.showName)
          if (!showSeen.has(key) && match(ch.showName, q)) {
            showSeen.add(key)
            series.push({ id: key, title: ch.showName, subtitle: 'TV Show', type: 'series', channel: ch })
          }
        }
      } else if (ch.type === 'live') {
        if (live.length < MAX_PER_GROUP && match(ch.name, q)) {
          live.push({ id: ch.id, title: ch.name, subtitle: ch.groupTitle, type: 'live', channel: ch })
        }
      }
      if (movies.length >= MAX_PER_GROUP && series.length >= MAX_PER_GROUP && live.length >= MAX_PER_GROUP) break
    }

    return { movies, series, live }
  }, [channels, query])

  const allResults = useMemo(() => [...movies, ...series, ...live], [movies, series, live])
  const totalCount = allResults.length

  const handleSelect = useCallback((result: SearchResult) => {
    const q = query.trim()
    if (q) { saveRecent(q); setRecentSearches(loadRecent()) }
    setOpen(false)
    if (result.type === 'movie') {
      play(result.channel)
      navigate(`/movies?playing=${result.channel.id}`)
    } else if (result.type === 'series') {
      navigate(`/series?show=${encodeURIComponent(normalizeShowKey(result.channel.showName ?? result.channel.name))}`)
    } else {
      play(result.channel)
      navigate('/live')
    }
  }, [query, play, navigate, setOpen])

  useEffect(() => { setSelectedIdx(0) }, [query])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, totalCount - 1)) }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' && allResults[selectedIdx]) { handleSelect(allResults[selectedIdx]) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, allResults, selectedIdx, totalCount, handleSelect, setOpen])

  const ResultRow = ({ result, idx }: { result: SearchResult; idx: number }) => {
    const Icon = result.type === 'movie' ? Film : result.type === 'series' ? Tv : Radio
    return (
      <button
        key={result.id}
        onClick={() => handleSelect(result)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
          idx === selectedIdx ? 'bg-accent-600/20 text-white' : 'text-neutral-300 hover:bg-white/5'
        }`}
      >
        <Icon size={14} className="text-neutral-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{result.title}</p>
          <p className="text-xs text-neutral-500 truncate">{result.subtitle}</p>
        </div>
        {idx === selectedIdx && <ArrowRight size={14} className="text-accent-400 shrink-0" />}
      </button>
    )
  }

  const SectionHeader = ({ label }: { label: string }) => (
    <p className="text-xs text-neutral-600 uppercase tracking-wider px-2 pt-3 pb-1 first:pt-1">{label}</p>
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ duration: 0.12 }}
            className="relative w-full max-w-xl bg-[#111] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input row */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/8">
              <Search size={16} className="text-neutral-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search movies, shows, channels…"
                className="flex-1 bg-transparent text-white text-base can-hover:text-sm placeholder-neutral-500 outline-none"
              />
              {query ? (
                <button onClick={() => setQuery('')} className="text-neutral-500 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              ) : (
                <kbd className="text-xs text-neutral-600 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 font-mono shrink-0">Esc</kbd>
              )}
            </div>

            {/* Body */}
            <div className="max-h-[400px] overflow-y-auto">
              {query.trim() === '' ? (
                recentSearches.length > 0 ? (
                  <div className="p-2">
                    <p className="text-xs text-neutral-600 uppercase tracking-wider px-2 pt-1 pb-1.5">Recent</p>
                    {recentSearches.map((q) => (
                      <div
                        key={q}
                        className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/5 group cursor-pointer"
                        onClick={() => { setQuery(q); inputRef.current?.focus() }}
                      >
                        <Clock size={13} className="text-neutral-600" />
                        <span className="flex-1 text-sm text-neutral-300">{q}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeRecent(q); setRecentSearches(loadRecent()) }}
                          className="opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 text-neutral-600 hover:text-white transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 py-10 text-neutral-600">
                    <Search size={22} />
                    <p className="text-sm">Search across your library</p>
                  </div>
                )
              ) : totalCount === 0 ? (
                <div className="flex items-center justify-center py-10">
                  <p className="text-sm text-neutral-600">No results for "{query}"</p>
                </div>
              ) : (
                <div className="p-2">
                  {movies.length > 0 && (
                    <>
                      <SectionHeader label="Movies" />
                      {movies.map((r, i) => <ResultRow key={r.id} result={r} idx={i} />)}
                    </>
                  )}
                  {series.length > 0 && (
                    <>
                      <SectionHeader label="TV Shows" />
                      {series.map((r, i) => <ResultRow key={r.id} result={r} idx={movies.length + i} />)}
                    </>
                  )}
                  {live.length > 0 && (
                    <>
                      <SectionHeader label="Live TV" />
                      {live.map((r, i) => <ResultRow key={r.id} result={r} idx={movies.length + series.length + i} />)}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-white/5 text-xs text-neutral-600">
              <span><kbd className="font-mono bg-white/5 border border-white/10 rounded px-1 py-0.5">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono bg-white/5 border border-white/10 rounded px-1 py-0.5">↵</kbd> open</span>
              <span><kbd className="font-mono bg-white/5 border border-white/10 rounded px-1 py-0.5">Esc</kbd> close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
