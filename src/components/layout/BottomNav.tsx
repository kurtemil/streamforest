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
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 md:hidden bg-surface-100/70 backdrop-blur-2xl backdrop-saturate-150 border-t border-white/10 pb-safe"
      // Its own compositing layer. A fixed element carrying a backdrop-filter
      // drifts off the bottom edge on iOS without this, which is how `lagom`
      // solves the same problem in the same place.
      style={{ transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
    >
      <div className="mx-auto grid w-full max-w-2xl grid-cols-5 px-1 pt-1.5">
      {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 rounded-2xl px-3 py-2 text-[10px] font-medium transition-colors press-deep ${
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
      </div>
    </nav>
  )
}
