interface Group {
  title: string
  count: number
}

interface Props {
  groups: Group[]
  selected: string | null
  onSelect: (title: string | null) => void
  recentLabel?: string
  cleanTitle?: (t: string) => string
}

const defaultClean = (t: string) => t

export function GroupSidebar({ groups, selected, onSelect, recentLabel = 'Recently Added', cleanTitle = defaultClean }: Props) {
  return (
    <aside className="w-48 shrink-0 flex flex-col gap-0.5 overflow-y-auto pr-1 scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
          selected === null
            ? 'bg-accent-600/20 text-accent-400 font-medium'
            : 'text-neutral-400 hover:text-white hover:bg-white/5'
        }`}
      >
        {recentLabel}
      </button>
      <div className="my-1 h-px bg-white/5" />
      {groups.map((g) => (
        <button
          key={g.title}
          onClick={() => onSelect(g.title)}
          className={`flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            selected === g.title
              ? 'bg-accent-600/20 text-accent-400 font-medium'
              : 'text-neutral-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <span className="truncate">{cleanTitle(g.title)}</span>
          <span className="text-xs text-neutral-600 shrink-0">{g.count}</span>
        </button>
      ))}
    </aside>
  )
}
