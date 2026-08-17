import type { ReactNode } from 'react'

interface Group {
  title: string
  count: number
}

interface PrefixItem {
  label: ReactNode
  active: boolean
  onClick: () => void
}

interface Props {
  groups: Group[]
  selected: string | null
  onSelect: (title: string | null) => void
  recentLabel?: string
  cleanTitle?: (t: string) => string
  prefixItem?: PrefixItem
}

const defaultClean = (t: string) => t

export function GroupSidebar({
  groups,
  selected,
  onSelect,
  recentLabel = 'Recently Added',
  cleanTitle = defaultClean,
  prefixItem,
}: Props) {
  const pillBase = 'shrink-0 px-4 py-2.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap'
  const pillActive = 'bg-accent-600 text-white'
  const pillInactive = 'bg-white/8 text-neutral-400 hover:text-white active:bg-white/15'

  return (
    <>
      {/* ── Mobile: horizontal scrollable pills ── */}
      <div className="md:hidden flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2.5 border-b border-white/5">
        {prefixItem && (
          <button
            onClick={prefixItem.onClick}
            className={`${pillBase} ${prefixItem.active ? pillActive : pillInactive} flex items-center gap-1.5`}
          >
            {prefixItem.label}
          </button>
        )}
        <button
          onClick={() => onSelect(null)}
          className={`${pillBase} ${selected === null && !prefixItem?.active ? pillActive : pillInactive}`}
        >
          {recentLabel}
        </button>
        {groups.map((g) => (
          <button
            key={g.title}
            onClick={() => onSelect(g.title)}
            className={`${pillBase} ${selected === g.title ? pillActive : pillInactive}`}
          >
            {cleanTitle(g.title)}
          </button>
        ))}
      </div>

      {/* ── Desktop: vertical sidebar ── */}
      <aside className="hidden md:flex flex-col w-48 shrink-0 gap-0.5 overflow-y-auto pr-1 scrollbar-hide">
        {prefixItem && (
          <>
            <button
              onClick={prefixItem.onClick}
              className={`flex items-center gap-1.5 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                prefixItem.active
                  ? 'bg-accent-600/20 text-accent-400 font-medium'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {prefixItem.label}
            </button>
            <div className="my-1 h-px bg-white/5" />
          </>
        )}
        <button
          onClick={() => onSelect(null)}
          className={`text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            selected === null && !prefixItem?.active
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
    </>
  )
}
