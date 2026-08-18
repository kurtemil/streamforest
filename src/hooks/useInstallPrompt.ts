import { useEffect, useState } from 'react'
import { getClientContext } from '@/lib/diagnostics'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'sf_install_dismissed'
const SHOWN_KEY = 'sf_install_shown'
/** How many launches may carry the offer before it stops asking. */
const MAX_SHOWN = 3
/** How long it may sit over the artwork before retiring itself for this launch. */
const VISIBLE_MS = 15_000

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
  const [dismissed, setDismissed] = useState(
    () => !!localStorage.getItem(DISMISSED_KEY) || Number(localStorage.getItem(SHOWN_KEY) ?? 0) >= MAX_SHOWN,
  )
  // The card is `fixed` over the content, so for as long as it is up it covers a
  // row of artwork. An offer worth making is worth making briefly: it retires
  // itself after a few seconds, and stops asking after a few launches, instead of
  // camping on the home screen until someone finds the little cross.
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    if (dismissed) return
    const n = Number(localStorage.getItem(SHOWN_KEY) ?? 0)
    localStorage.setItem(SHOWN_KEY, String(n + 1))
    const t = window.setTimeout(() => setExpired(true), VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [dismissed])

  const ctx = getClientContext()
  // Already installed: nothing to offer. navigator.standalone is Apple's older
  // flag and the display-mode query is the standards-based one; a home-screen
  // app satisfies one or the other depending on how it was added.
  const installed = ctx.standalone || ctx.displayModeStandalone

  const kind: InstallKind =
    installed || dismissed || expired ? null
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
