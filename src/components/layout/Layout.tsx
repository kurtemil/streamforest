import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { CommandPalette } from '@/components/search/CommandPalette'
import { InstallPrompt } from '@/components/ui/InstallPrompt'
import { useSearchStore } from '@/stores/searchStore'
import { PROFILES, useProfileStore } from '@/stores/profileStore'
import { useT } from '@/lib/i18n'

export function Layout({ children }: { children: ReactNode }) {
  const t = useT()
  const { toggle } = useSearchStore()
  const mainRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const openPicker = useProfileStore((s) => s.openPicker)
  const activeProfile = PROFILES.find((p) => p.id === activeProfileId)

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
      {/* Profile switching exists only in the sidebar on desktop, which is hidden
          below md — signed in as one of the kids on a phone there was no way back.
          It needs to float, but not from the top right: that corner belongs to the
          controls of whatever is under it. A rating chip on the first row of
          posters, the close button on a dialog, the search field in a page header
          — the avatar sat on top of all of them.
          
          Bottom right, above the tab bar, is both out of their way and the easiest
          place on a large phone for a thumb to reach. Settings used to be a second
          floating button in that same corner; it is a row inside the picker now,
          so there is one floating control instead of two fighting for the spot. */}
      <button
        onClick={openPicker}
        aria-label={
          activeProfile
            ? t('layout.profileSwitch', { name: activeProfile.name })
            : t('layout.chooseProfile')
        }
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-3 z-40 flex md:hidden items-center justify-center w-12 h-12 rounded-full bg-surface-200/80 backdrop-blur-xl ring-1 ring-white/12 shadow-cinema active:scale-95 transition-transform"
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
          style={{ backgroundColor: activeProfile?.color ?? '#404040' }}
        >
          {activeProfile?.name[0] ?? '?'}
        </span>
      </button>

      <BottomNav />
      <CommandPalette />
      <InstallPrompt />
    </div>
  )
}
