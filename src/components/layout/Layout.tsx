import { useEffect, useRef, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { CommandPalette } from '@/components/search/CommandPalette'
import { InstallPrompt } from '@/components/ui/InstallPrompt'
import { useSearchStore } from '@/stores/searchStore'
import { getProfile, PROFILES, useProfileStore } from '@/stores/profileStore'

export function Layout({ children }: { children: ReactNode }) {
  const { toggle } = useSearchStore()
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const openPicker = useProfileStore((s) => s.openPicker)
  const activeProfile = PROFILES.find((p) => p.id === activeProfileId)
  const role = getProfile(activeProfileId)?.role ?? 'kid'
  const canSeeSettings = role === 'parent' || role === 'admin'

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {/* pt-safe here rather than in six hand-rolled page headers: every page's
          content lives inside this element, so one inset covers them all and no
          future page can forget it.

          The bottom pad has to clear the tab bar *and* the home indicator. Plain
          pb-16 cleared only the bar, so the last row of every list sat behind the
          gesture area. */}
      <main
        ref={mainRef}
        className="flex-1 overflow-y-auto min-w-0 pt-safe px-safe pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0"
      >
        {children}
      </main>
      {/* Profile switching existed only in the sidebar, which is hidden below md.
          Signed in as one of the kids on a phone, there was no way back without
          clearing localStorage. The avatar floats over the content rather than
          taking a sixth slot in a tab bar that is already tight at 375px. */}
      <button
        onClick={openPicker}
        aria-label={activeProfile ? `Profile: ${activeProfile.name} — switch` : 'Choose profile'}
        className="fixed top-[calc(0.75rem+env(safe-area-inset-top,0px))] right-3 z-40 flex md:hidden items-center justify-center w-11 h-11"
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold ring-1 ring-white/20 shadow-lg"
          style={{ backgroundColor: activeProfile?.color ?? '#404040' }}
        >
          {activeProfile?.name[0] ?? '?'}
        </span>
      </button>

      <BottomNav />
      {canSeeSettings && (
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `fixed bottom-20 right-3 z-50 flex md:hidden items-center justify-center w-11 h-11 rounded-full ring-1 ring-white/10 shadow-lg transition-colors ${
              isActive ? 'bg-accent-600 text-white ring-accent-500' : 'bg-surface-200 text-neutral-400'
            }`
          }
        >
          <Settings size={16} />
        </NavLink>
      )}
      <CommandPalette />
      <InstallPrompt />
    </div>
  )
}
