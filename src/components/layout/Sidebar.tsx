import { NavLink } from 'react-router-dom'
import { Home, Film, Tv, Radio, Settings } from 'lucide-react'

const NAV = [
  { to: '/',        icon: Home,     label: 'Home' },
  { to: '/movies',  icon: Film,     label: 'Movies' },
  { to: '/series',  icon: Tv,       label: 'TV Shows' },
  { to: '/live',    icon: Radio,    label: 'Live TV' },
  { to: '/settings',icon: Settings, label: 'Settings' },
]

export function Sidebar() {
  return (
    <aside className="flex flex-col w-56 shrink-0 border-r border-white/5 bg-[#0d0d0d] h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-6 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-accent-600 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
            <path d="M5 3l14 9-14 9V3z" fill="white" />
          </svg>
        </div>
        <span className="text-white font-semibold tracking-tight text-sm">StreamForest</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {NAV.map(({ to, icon: Icon, label }) => (
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

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/5">
        <p className="text-xs text-neutral-600">Private use only</p>
      </div>
    </aside>
  )
}
