import { useState, useMemo } from 'react'
import { Radio } from 'lucide-react'
import { usePlaylistStore } from '@/stores/playlistStore'
import { usePlayerStore } from '@/stores/playerStore'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { GroupSidebar } from '@/components/ui/GroupSidebar'

const RECENT_COUNT = 60

export function LiveTVPage() {
  const { channels } = usePlaylistStore()
  const { play } = usePlayerStore()
  const [search, setSearch] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

  const live = useMemo(() => channels.filter((c) => c.type === 'live'), [channels])

  // Groups in M3U order
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const counts = new Map<string, number>()
    for (const c of live) {
      if (!seen.has(c.groupTitle)) seen.add(c.groupTitle)
      counts.set(c.groupTitle, (counts.get(c.groupTitle) ?? 0) + 1)
    }
    return Array.from(seen).map((title) => ({ title, count: counts.get(title) ?? 0 }))
  }, [live])

  const filtered = useMemo(() => {
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
        <EmptyState icon={<Radio size={40} />} title="No live channels yet" description="Download your playlist in Settings to see live TV here." />
      </div>
    )
  }

  const heading = search.trim()
    ? `Results for "${search}"`
    : selectedGroup !== null ? selectedGroup
    : 'Recently Added'

  return (
    <div className="flex h-full overflow-hidden">
      <div className="p-4 pt-6 overflow-y-auto scrollbar-hide border-r border-white/5">
        <GroupSidebar
          groups={groups}
          selected={selectedGroup}
          onSelect={(g) => { setSelectedGroup(g); setSearch('') }}
          recentLabel="Recently Added"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 pb-12 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">{heading}</h1>
          <div className="flex items-center gap-3">
            <p className="text-neutral-500 text-sm">{filtered.length} channels</p>
            <div className="w-52">
              <SearchBar value={search} onChange={(v) => { setSearch(v); setSelectedGroup(null) }} placeholder="Search channels…" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {filtered.map((ch) => (
            <button
              key={ch.id}
              onClick={() => play(ch)}
              className="group flex flex-col items-center gap-2.5 p-3 rounded-xl bg-white/3 hover:bg-white/8 ring-1 ring-white/5 hover:ring-accent-600/40 transition-all duration-200 animate-fade-in"
            >
              <div className="w-16 h-10 rounded-md overflow-hidden bg-[#1e1e1e] flex items-center justify-center">
                {ch.logo ? (
                  <img
                    src={ch.logo}
                    alt={ch.name}
                    className="max-w-full max-h-full object-contain p-1"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    loading="lazy"
                  />
                ) : (
                  <Radio size={18} className="text-neutral-600" />
                )}
              </div>
              <p className="text-xs text-neutral-300 group-hover:text-white text-center leading-tight line-clamp-2 transition-colors">
                {ch.name}
              </p>
              <span className="flex items-center gap-1 text-[10px] text-red-400/80">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
