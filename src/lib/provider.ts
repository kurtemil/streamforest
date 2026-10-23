// The provider is reached through a name we own, not one it owns.
//
// Its domains die: iptvworld.xyz, then nsclient.xyz, which lost its A record on
// 2026-09-23 and took the whole catalogue down with it. Its IP outlives them, but
// Cloudflare will not fetch a bare IP from a Worker ("error code: 1003"), and the
// playlist download runs on Cloudflare. So the IP gets a name in our own zone:
// PROVIDER_HOST is a DNS-only A record pointing at it. When the provider moves,
// that record is the one thing that changes (`node tools/provider.mjs <ip>`).
//
// The playlist is fetched from PROVIDER_HOST, but the stream URLs inside it carry
// whatever domain the provider's panel was configured with, which may be dead.
// Every one of them has the account's username and password in its path, so they
// can be recognised and pointed at the host the playlist itself came from.

export const PROVIDER_HOST = 'iptv.krutofv.se'

/**
 * True when saving this playlist URL means moving PROVIDER_HOST: it names the
 * provider by its own IP or domain. Settings then posts it to /api/provider, which
 * repoints the record and stores the URL on our name.
 */
export function needsProviderMove(m3uUrl: string): boolean {
  try {
    const u = new URL(m3uUrl.trim())
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== PROVIDER_HOST
  } catch {
    return false
  }
}

interface Account {
  hostname: string
  user: string
  pass: string
}

function account(m3uUrl: string | null | undefined): Account | null {
  if (!m3uUrl) return null
  try {
    const u = new URL(m3uUrl)
    const user = u.searchParams.get('username')
    const pass = u.searchParams.get('password')
    if (!user || !pass) return null
    return { hostname: u.hostname, user, pass }
  } catch {
    return null
  }
}

/**
 * Points a provider stream URL at the host the playlist is fetched from.
 * Only the host name changes. The port stays the stream's own: the panel serves
 * the playlist on one port (80) and names another for streaming (2095), and only
 * its domain is unreliable. Anything that is not one of the provider's stream URLs
 * is returned unchanged.
 */
export function toPlaylistHost(url: string, m3uUrl: string | null | undefined): string {
  const acc = account(m3uUrl)
  if (!acc) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  if (u.hostname === acc.hostname) return url
  const creds = [
    `/${acc.user}/${acc.pass}/`,
    `/${encodeURIComponent(acc.user)}/${encodeURIComponent(acc.pass)}/`,
  ]
  if (!creds.some((c) => u.pathname.includes(c))) return url
  u.hostname = acc.hostname
  return u.toString()
}

/** What stands for the account's name and password in a stream URL that leaves the device. */
const REDACTED = '/~/~/'

/**
 * A stream URL without the account in it, for the kiosks' queue (/api/bion), which
 * anyone can read. Null when the URL does not carry this playlist's account, since a
 * kiosk could not fill it back in.
 */
export function redactStreamUrl(url: string, m3uUrl: string | null | undefined): string | null {
  const acc = account(m3uUrl)
  if (!acc) return null
  const creds = [
    `/${acc.user}/${acc.pass}/`,
    `/${encodeURIComponent(acc.user)}/${encodeURIComponent(acc.pass)}/`,
  ]
  const found = creds.find((c) => url.includes(c))
  return found ? url.replace(found, REDACTED) : null
}

/** The other way, on a kiosk, from its own playlist address. */
export function restoreStreamUrl(url: string, m3uUrl: string | null | undefined): string | null {
  const acc = account(m3uUrl)
  if (!acc || !url.includes(REDACTED)) return null
  return url.replace(REDACTED, `/${encodeURIComponent(acc.user)}/${encodeURIComponent(acc.pass)}/`)
}
