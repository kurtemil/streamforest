// Whether this page is the kiosk on the screen in the basement ("Bion").
//
// The kiosk opens https://streamforest.krutofv.se/?kiosk=bion once (the URL in its
// container, hemma/bio/kiosk/start.sh). The flag is kept in localStorage so a reload
// or a navigation that drops the query string is still the kiosk. `?kiosk=off`
// turns it back into an ordinary browser.

const KEY = 'sf-kiosk'

let cached: boolean | null = null

export function isKiosk(): boolean {
  if (cached !== null) return cached
  try {
    const param = new URLSearchParams(window.location.search).get('kiosk')
    if (param === 'off') localStorage.removeItem(KEY)
    else if (param) localStorage.setItem(KEY, param)
    cached = Boolean(localStorage.getItem(KEY))
  } catch {
    cached = false
  }
  return cached
}
