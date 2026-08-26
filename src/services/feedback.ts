import type { Feedback, FeedbackKind } from '@/types'
import { getClientContext } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'

// The client half of `functions/api/feedback.ts`. Thin on purpose: this is a
// household suggestion box, not a ticketing system.

const API = '/api/feedback'

/**
 * The device line attached to a report, and the one shown to the person before
 * they send it.
 *
 * A bug report that does not say which phone and whether the app was launched
 * from the home screen costs a round of messages to establish, and those are
 * the two questions almost every playback problem in this app turns on. The app
 * already collects exactly this for the playback log — `getClientContext()` —
 * so nothing new is gathered here, and the summary is put on screen rather than
 * sent quietly.
 */
export function describeDevice(): string {
  const c = getClientContext()
  const device = c.isIos
    ? (/iPad/.test(c.ua) ? 'iPad' : 'iPhone') + (c.iosVersion ? ` ${c.iosVersion}` : '')
    : /Macintosh/.test(c.ua) ? 'Mac'
    : /Windows/.test(c.ua) ? 'Windows'
    : /Android/.test(c.ua) ? 'Android'
    : t('device.unknown')
  const home = c.standalone || c.displayModeStandalone
  return [device, c.brand, t(home ? 'device.homeScreen' : 'device.browser'), c.viewport]
    .filter(Boolean)
    .join(' · ')
}

/** The blob stored in `feedback.context`, read back by the inbox. */
export function collectContext(): string {
  try {
    return JSON.stringify(getClientContext())
  } catch {
    return ''
  }
}

export async function listFeedback(opts: { profileId?: string; all?: boolean }): Promise<Feedback[]> {
  const params = opts.all
    ? new URLSearchParams({ scope: 'all' })
    : new URLSearchParams({ profileId: opts.profileId ?? '' })
  const res = await fetch(`${API}?${params}`)
  if (!res.ok) throw new Error(String(res.status))
  return res.json() as Promise<Feedback[]>
}

export async function sendFeedback(input: {
  profileId: string
  authorName: string
  kind: FeedbackKind
  body: string
}): Promise<void> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, context: collectContext() }),
  })
  if (!res.ok) throw new Error(String(res.status))
}

export async function setFeedbackResolved(id: string, resolved: boolean): Promise<void> {
  await fetch(API, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, resolved }),
  })
}

export async function deleteFeedback(id: string): Promise<void> {
  await fetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
