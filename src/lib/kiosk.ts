// Whether this page is a kiosk, and which one: the screen in the basement ("Bion",
// `?kiosk=bion`) or the TV in the living room (`?kiosk=vardagsrum`).
//
// The basement kiosk opens https://streamforest.krutofv.se/?kiosk=bion once (the URL in
// its container, hemma/bio/kiosk/start.sh); the TV's app (hemma/tv/startskarm) opens
// `?kiosk=vardagsrum`. The name is kept in localStorage so a reload or a navigation that
// drops the query string is still the kiosk. `?kiosk=off` turns it back into an
// ordinary browser.

import { BION_DEVICES, type BionDevice } from '@/services/bion'

const KEY = 'sf-kiosk'

let cached: string | null | undefined

function stored(): string | null {
  if (cached !== undefined) return cached
  try {
    const param = new URLSearchParams(window.location.search).get('kiosk')
    if (param === 'off') localStorage.removeItem(KEY)
    else if (param) localStorage.setItem(KEY, param)
    cached = localStorage.getItem(KEY)
  } catch {
    cached = null
  }
  return cached
}

export function isKiosk(): boolean {
  return Boolean(stored())
}

/** Which kiosk this is. Anything but a known name is Bion, as every kiosk was before there were two. */
export function kioskDevice(): BionDevice {
  const name = stored()
  return BION_DEVICES.find((d) => d === name) ?? 'bion'
}

/**
 * Where the kiosk starts reading the command queue, from `?after=`. The TV's app is
 * opened by the Play it is meant to show, so it passes the seq before that Play;
 * without it the first poll only learns where the queue stands.
 */
export function kioskStartCursor(): number | null {
  try {
    const after = new URLSearchParams(window.location.search).get('after')
    if (after === null) return null
    const n = Number(after)
    return Number.isInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}
