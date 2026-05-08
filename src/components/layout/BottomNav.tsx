import { NavLink } from 'react-router-dom'
import { Home, Film, Tv, Radio, Library } from 'lucide-react'
import { getProfile, useProfileStore } from '@/stores/profileStore'

const NAV_ITEMS = [
  { to: '/',        icon: Home,    label: 'Home',    end: true  },
  { to: '/movies',  icon: Film,    label: 'Movies',  end: false },
  { to: '/series',  icon: Tv,      label: 'TV',      end: false },
  { to: '/live',    icon: Radio,   label: 'Live',    end: false },
  { to: '/library', icon: Library, label: 'Library', end: false },
] as const

export function BottomNav() {
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const role = getProfile(activeProfileId)?.role ?? 'kid'

  // Settings is parent-only; hide from kids but the nav items here are all kid-accessible
  void role

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden bg-[#0d0d0d]/95 backdrop-blur-md border-t border-white/8 pb-safe">
      {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              isActive ? 'text-accent-400' : 'text-neutral-500 active:text-neutral-300'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
