import { useEffect, useState } from 'react'
import { getClientContext } from '@/lib/diagnostics'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'sf_install_dismissed'

export type InstallKind =
  /** Chromium-style: the browser hands us an event and we can install in one tap. */
  | 'prompt'
  /** WebKit: no API exists, so all we can do is explain where the button is. */
  | 'ios-manual'
  | null

/**
 * Whether to offer installation, and how.
 *
 * The previous version listened only for `beforeinstallprompt` — an event WebKit
 * has never fired and shows no sign of adding. On iPhone the prompt therefore
 * never appeared at all, which is the one platform where the installed app
 * differs most from the tab: standalone display, no browser chrome, and the
 * safe-area handling this app now depends on.
 */
export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY))

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const ctx = getClientContext()
  // Already installed: nothing to offer. navigator.standalone is Apple's older
  // flag and the display-mode query is the standards-based one; a home-screen
  // app satisfies one or the other depending on how it was added.
  const installed = ctx.standalone || ctx.displayModeStandalone

  const kind: InstallKind =
    installed || dismissed ? null
    : promptEvent ? 'prompt'
    : ctx.isIos ? 'ios-manual'
    : null

  const install = async () => {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    if (outcome === 'accepted') setPromptEvent(null)
  }

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setDismissed(true)
  }

  return { kind, visible: kind !== null, install, dismiss }
}
