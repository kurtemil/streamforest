import { useEffect, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { CommandPalette } from '@/components/search/CommandPalette'
import { InstallPrompt } from '@/components/ui/InstallPrompt'
import { useSearchStore } from '@/stores/searchStore'

export function Layout({ children }: { children: ReactNode }) {
  const { toggle } = useSearchStore()

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
      <main className="flex-1 overflow-y-auto min-w-0 pb-16 md:pb-0">
        {children}
      </main>
      <BottomNav />
      <CommandPalette />
      <InstallPrompt />
    </div>
  )
}
