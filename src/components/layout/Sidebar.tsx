import { NavLink } from 'react-router-dom'
import { Home, Film, Tv, Radio, Settings, Library, Search } from 'lucide-react'
import { PROFILES, getProfile, useProfileStore } from '@/stores/profileStore'
import { useSearchStore } from '@/stores/searchStore'

const NAV_MAIN = [
  { to: '/',         icon: Home,    label: 'Home',     minRole: 'kid' },
  { to: '/movies',   icon: Film,    label: 'Movies',   minRole: 'kid' },
  { to: '/series',   icon: Tv,      label: 'TV Shows', minRole: 'kid' },
  { to: '/live',     icon: Radio,   label: 'Live TV',  minRole: 'kid' },
  { to: '/library',  icon: Library, label: 'Library',  minRole: 'kid' },
] as const

const NAV_BOTTOM = [
  { to: '/settings',    icon: Settings, label: 'Settings',    minRole: 'parent' },
] as const

const ROLE_RANK: Record<string, number> = { kid: 0, parent: 1, admin: 2 }

export function Sidebar() {
  const { activeProfileId, openPicker } = useProfileStore()
  const activeProfile = PROFILES.find((p) => p.id === activeProfileId)
  const role = getProfile(activeProfileId)?.role ?? 'kid'
  const { toggle: toggleSearch } = useSearchStore()

  return (
    <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-white/5 bg-[#0d0d0d] h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-6 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-accent-600 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
            <path d="M5 3l14 9-14 9V3z" fill="white" />
          </svg>
        </div>
        <span className="text-white font-semibold tracking-tight text-sm">StreamForest</span>
      </div>

      {/* Search trigger */}
      <div className="px-3 pt-3">
        <button
          onClick={toggleSearch}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/5 border border-white/8 hover:border-white/15 text-neutral-500 hover:text-neutral-300 transition-colors group"
        >
          <Search size={14} className="shrink-0" />
          <span className="flex-1 text-left text-sm">Search…</span>
          <kbd className="text-xs font-mono bg-white/5 border border-white/10 rounded px-1 py-0.5 group-hover:border-white/20 transition-colors">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5">
        {NAV_MAIN.filter((item) => (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[item.minRole] ?? 0)).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent-600/20 text-accent-400 font-medium'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Icon size={17} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Profile section */}
      <div className="px-3 py-3 border-t border-white/5">
        <button
          onClick={openPicker}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
        >
          {activeProfile ? (
            <>
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: activeProfile.color }}
              >
                {activeProfile.name[0]}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm text-white font-medium truncate">{activeProfile.name}</p>
                <p className="text-xs text-neutral-600 group-hover:text-neutral-500 transition-colors">Switch profile</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-7 h-7 rounded-lg bg-neutral-700 flex items-center justify-center shrink-0">
                <span className="text-neutral-400 text-xs">?</span>
              </div>
              <span className="text-sm text-neutral-400">Select profile</span>
            </>
          )}
        </button>
      </div>

      {/* Settings + footer */}
      <div className="px-3 pb-3 border-t border-white/5 pt-2">
        {NAV_BOTTOM.filter((item) => (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[item.minRole] ?? 0)).map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent-600/20 text-accent-400 font-medium'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`
            }
          >
            <Icon size={17} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
        <p className="text-xs text-neutral-600 px-3 pt-2">Private use only</p>
      </div>
    </aside>
  )
}
