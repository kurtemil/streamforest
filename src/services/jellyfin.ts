// The home library: Jellyfin on the home server, as a second source beside IPTV.
//
// Reached only from the home network and the tailnet, never through Cloudflare (the
// free plan's terms forbid video in bulk). It has a real HTTPS name because iOS
// Safari refuses http from an https page, fetch and <video> alike. Everything here
// runs in the browser: no Cloudflare Function can reach the server, and none needs
// to.
//
// Each StreamForest profile signs in as the Jellyfin user of the same name. Those
// users have no password, so signing in needs no prompt. Jellyfin then decides what
// each profile may see (the kids see an allowlist of tagged titles) and keeps the
// watch position, which is what lets Swiftfin and this app resume each other.

export const JELLYFIN_URL =
  ((import.meta.env.VITE_JELLYFIN_URL as string | undefined) ?? 'https://jellyfin.krutofv.se').replace(/\/+$/, '')

const APP_VERSION = '1.0'
const DEVICE_KEY = 'sf-jf-device'
const sessionKey = (profileId: string) => `sf-jf-session:${profileId}`
const TICKS_PER_SECOND = 10_000_000

export interface JellyfinSession {
  token: string
  userId: string
}

/**
 * One file of a film that is split in several (cd1, cd2). Jellyfin lists the film
 * once, but only ever plays its first file: the rest are "additional parts" with
 * their own ids and their own watch state. Until 2026-10-17 StreamForest played
 * only part one, so Avatar stopped after 59 of its 161 minutes.
 */
export interface HomePart {
  id: string
  durationSec: number
  positionSec: number
  played: boolean
  lastPlayedAt: number
}

/** A subtitle stream of the file being played, as the server offers it to this app. */
export interface HomeSubtitle {
  index: number
  lang?: string
  /** The stream's own title, if it has one ("Forced", "SDH"). */
  title?: string
  /** Text (SubRip, ASS…): a WebVTT file beside the video. Otherwise a picture (DVD, Blu-ray) that has to be burnt in. */
  text: boolean
  /** Where the WebVTT is, for a text stream. */
  url?: string
  forced: boolean
  isDefault: boolean
}

export interface HomeItem {
  id: string
  name: string
  year?: number
  overview?: string
  kind: 'movie' | 'video'
  /** The Jellyfin library it lives in, as named there: "Filmer", "Fotboll". */
  library: string
  durationSec: number
  positionSec: number
  played: boolean
  /** When this profile last played it; 0 if never. Orders "continue" first. */
  lastPlayedAt: number
  imageTag?: string
  backdropTag?: string
  addedAt: number
  tmdbId?: string
  genres: string[]
  /** TMDb's average as Jellyfin stores it, 0–10. */
  rating?: number
  /** The age limit as written on the film: "SE-11", "PG-13". */
  ageRating?: string
  /**
   * Set when the film is split in several files, the first being the item itself.
   * Duration, position, played and last played above are then for the whole film.
   */
  parts?: HomePart[]
}

/** What the detail sheet adds to a list item: the people, fetched when it opens. */
export interface HomeDetails {
  director?: string
  cast: { name: string; character?: string; image: string | null }[]
  /** Jellyfin's "similar" for the film, as ids in this profile's library. */
  similar: string[]
}

export interface PlaybackSource {
  url: string
  /** Jellyfin's HLS: hls.js outside Safari. A direct file plays in <video> as is. */
  hls: boolean
  itemId: string
  mediaSourceId: string
  playSessionId: string
  /** Every subtitle stream in the file. */
  subtitles: HomeSubtitle[]
  /** The picture subtitle burnt into this source, if one was asked for. */
  burntIn?: number
}

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** Stable per browser: Jellyfin lists sessions by it, and Home Assistant sees it. */
function deviceId(): string {
  const s = storage()
  let id = s?.getItem(DEVICE_KEY)
  if (!id) {
    id = `sf-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    s?.setItem(DEVICE_KEY, id)
  }
  return id
}

// ASCII only. A header value with "ä" in it reaches Caddy as a Latin-1 byte, HTTP/2
// refuses it with 400 and no CORS headers, and the browser reports that as a CORS
// failure. "Webbläsare" took the whole library down on its first run.
export function authHeader(token?: string): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const device = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : 'Web browser'
  return `MediaBrowser Client="StreamForest", Device="${device}", DeviceId="${deviceId()}", Version="${APP_VERSION}"` +
    (token ? `, Token="${token}"` : '')
}

class JellyfinError extends Error {
  constructor(readonly status: number) { super(`Jellyfin ${status}`) }
}

async function call<T>(path: string, opts: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(JELLYFIN_URL + path, {
    method: opts.method ?? 'GET',
    headers: { Authorization: authHeader(opts.token), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  })
  if (!res.ok) throw new JellyfinError(res.status)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/**
 * Chrome and Edge (142+) ask once before a public site may reach a device on the
 * home network, and the server's name resolves to a home address. The permission
 * was called `local-network-access`, and since Chrome 145 `local-network`. Safari
 * does not ask (yet); there the query throws and this says 'unsupported'.
 */
export type LocalNetworkPermission = 'granted' | 'prompt' | 'denied' | 'unsupported'

async function queryLocalNetwork(): Promise<PermissionStatus | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null
  for (const name of ['local-network-access', 'local-network']) {
    try { return await navigator.permissions.query({ name: name as PermissionName }) } catch { /* try the next name */ }
  }
  return null
}

export async function localNetworkPermission(): Promise<LocalNetworkPermission> {
  return (await queryLocalNetwork())?.state ?? 'unsupported'
}

/** Calls `onChange` when the user answers the browser's question, or changes it later. */
export async function watchLocalNetworkPermission(onChange: () => void): Promise<() => void> {
  const status = await queryLocalNetwork()
  if (!status) return () => {}
  status.addEventListener('change', onChange)
  return () => status.removeEventListener('change', onChange)
}

/**
 * Whether the server answers from here: home network, or tailnet with Tailscale on.
 * While the browser is still asking for permission the first request waits on the
 * user, so it gets a minute rather than the usual three seconds.
 */
export async function isReachable(waitForUser = false): Promise<boolean> {
  try {
    await call('/System/Info/Public', { timeoutMs: waitForUser ? 60_000 : 3000 })
    return true
  } catch {
    return false
  }
}

/** The profile's session, signing in once if this device has none. */
export async function getSession(profileId: string, userName: string): Promise<JellyfinSession | null> {
  const s = storage()
  const saved = s?.getItem(sessionKey(profileId))
  if (saved) {
    try { return JSON.parse(saved) as JellyfinSession } catch { /* sign in again */ }
  }
  try {
    const r = await call<{ AccessToken: string; User: { Id: string } }>('/Users/AuthenticateByName', {
      method: 'POST', body: { Username: userName, Pw: '' },
    })
    const session = { token: r.AccessToken, userId: r.User.Id }
    s?.setItem(sessionKey(profileId), JSON.stringify(session))
    return session
  } catch {
    return null
  }
}

/**
 * A token the server has forgotten: drop it so the next getSession signs in afresh.
 * Only that token. A newer one saved in the meantime is the one that works.
 */
export function forgetSession(profileId: string, token: string): void {
  const s = storage()
  const saved = s?.getItem(sessionKey(profileId))
  try {
    if (saved && (JSON.parse(saved) as JellyfinSession).token !== token) return
  } catch { /* unreadable: drop it */ }
  s?.removeItem(sessionKey(profileId))
}

export function isAuthError(e: unknown): boolean {
  return e instanceof JellyfinError && e.status === 401
}

interface RawItem {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  Overview?: string
  RunTimeTicks?: number
  DateCreated?: string
  Genres?: string[]
  CommunityRating?: number
  OfficialRating?: string
  ImageTags?: { Primary?: string }
  BackdropImageTags?: string[]
  PartCount?: number
  ProviderIds?: { Tmdb?: string }
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean; LastPlayedDate?: string }
}

/**
 * Everything this profile may see, newest first, each with the library it is in.
 * Jellyfin applies the kids' allowlist. Libraries are read one by one because an
 * item's own parent is its folder, not its library; collections and series
 * libraries are skipped (a series is not a playable item).
 */
export async function listItems(session: JellyfinSession): Promise<HomeItem[]> {
  const views = await call<{ Items: { Id: string; Name: string; CollectionType?: string }[] }>(
    `/UserViews?userId=${session.userId}`, { token: session.token },
  )
  const playable = views.Items.filter((v) => v.CollectionType === 'movies' || v.CollectionType === 'homevideos')
  const perLibrary = await Promise.all(playable.map(async (view) => {
    const q = new URLSearchParams({
      userId: session.userId,
      parentId: view.Id,
      recursive: 'true',
      includeItemTypes: 'Movie,Video',
      fields: 'ProviderIds,Overview,DateCreated,Genres',
      enableUserData: 'true',
      sortBy: 'DateCreated,SortName',
      sortOrder: 'Descending,Ascending',
      limit: '500',
    })
    const r = await call<{ Items: RawItem[] }>(`/Items?${q}`, { token: session.token })
    return Promise.all(r.Items.map(async (i) => {
      const item = toHomeItem(i, view.Name)
      if ((i.PartCount ?? 1) > 1) await addParts(session, item)
      return item
    }))
  }))
  return perLibrary.flat()
}

/**
 * Reads the other files of a split film and makes the item speak for all of them.
 * If they cannot be read the item stays as Jellyfin lists it, which is part one.
 */
async function addParts(session: JellyfinSession, item: HomeItem): Promise<void> {
  try {
    const r = await call<{ Items: RawItem[] }>(`/Videos/${item.id}/AdditionalParts?userId=${session.userId}`, { token: session.token })
    const parts = [partOf(item), ...r.Items.map((p) => partOf(toHomeItem(p, item.library)))]
    Object.assign(item, { parts }, combineParts(parts))
  } catch {
    // see above
  }
}

function partOf(i: HomeItem): HomePart {
  return { id: i.id, durationSec: i.durationSec, positionSec: i.positionSec, played: i.played, lastPlayedAt: i.lastPlayedAt }
}

/**
 * A split film as one: its length is all parts, it is watched when every part is,
 * and its position is where the first unwatched part stands, counted from the
 * start of the film.
 */
export function combineParts(parts: readonly HomePart[]): Pick<HomeItem, 'durationSec' | 'positionSec' | 'played' | 'lastPlayedAt'> {
  const durationSec = parts.reduce((sum, p) => sum + p.durationSec, 0)
  const lastPlayedAt = Math.max(0, ...parts.map((p) => p.lastPlayedAt))
  const current = parts.findIndex((p) => !p.played)
  if (current === -1) return { durationSec, positionSec: 0, played: true, lastPlayedAt }
  const before = parts.slice(0, current).reduce((sum, p) => sum + p.durationSec, 0)
  const within = parts[current].positionSec > 10 ? parts[current].positionSec : 0
  return { durationSec, positionSec: before + within, played: false, lastPlayedAt }
}

/** Which part a position in the whole film falls in, and how far into it. */
export function locatePart(parts: readonly HomePart[], positionSec: number): { index: number; offsetSec: number } {
  let rest = Math.max(0, positionSec)
  for (let index = 0; index < parts.length; index++) {
    if (rest < parts[index].durationSec || index === parts.length - 1) return { index, offsetSec: rest }
    rest -= parts[index].durationSec
  }
  return { index: 0, offsetSec: 0 }
}

function toHomeItem(i: RawItem, library: string): HomeItem {
  return {
    id: i.Id,
    name: i.Name,
    year: i.ProductionYear,
    overview: i.Overview,
    kind: i.Type === 'Movie' ? 'movie' : 'video',
    library,
    durationSec: (i.RunTimeTicks ?? 0) / TICKS_PER_SECOND,
    positionSec: (i.UserData?.PlaybackPositionTicks ?? 0) / TICKS_PER_SECOND,
    played: i.UserData?.Played ?? false,
    lastPlayedAt: i.UserData?.LastPlayedDate ? Date.parse(i.UserData.LastPlayedDate) : 0,
    imageTag: i.ImageTags?.Primary,
    backdropTag: i.BackdropImageTags?.[0],
    addedAt: i.DateCreated ? Date.parse(i.DateCreated) : 0,
    tmdbId: i.ProviderIds?.Tmdb,
    genres: i.Genres ?? [],
    rating: i.CommunityRating,
    ageRating: i.OfficialRating,
  }
}

const CAST_SHOWN = 12

/**
 * The people in a film, for its detail sheet. Kept out of the list: every film
 * carries dozens of them, and only the one being looked at needs them.
 */
export async function getDetails(session: JellyfinSession, itemId: string): Promise<HomeDetails> {
  const [i, similar] = await Promise.all([
    call<{ People?: { Id: string; Name: string; Role?: string; Type?: string; PrimaryImageTag?: string }[] }>(
      `/Items/${itemId}?userId=${session.userId}`, { token: session.token },
    ),
    // The server applies the profile's limits here too, so a kid gets only its allowlist.
    call<{ Items: { Id: string }[] }>(`/Items/${itemId}/Similar?userId=${session.userId}&limit=12`, { token: session.token })
      .then((r) => r.Items.map((x) => x.Id))
      .catch(() => [] as string[]),
  ])
  const people = i.People ?? []
  return {
    similar,
    director: people.filter((p) => p.Type === 'Director').map((p) => p.Name).join(', ') || undefined,
    cast: people.filter((p) => p.Type === 'Actor').slice(0, CAST_SHOWN).map((p) => ({
      name: p.Name,
      character: p.Role || undefined,
      image: p.PrimaryImageTag ? `${JELLYFIN_URL}/Items/${p.Id}/Images/Primary?fillWidth=92&quality=90&tag=${p.PrimaryImageTag}` : null,
    })),
  }
}

/**
 * Puts the profile's place in a film at a given second of it, as Swiftfin will
 * also see it: in a split film the parts before are watched and the part it
 * falls in stands at that second. Used when the viewer says where VLC got to.
 */
export async function setPosition(session: JellyfinSession, item: HomeItem, positionSec: number): Promise<void> {
  const parts = item.parts ?? [{ id: item.id, durationSec: item.durationSec, positionSec: item.positionSec, played: item.played, lastPlayedAt: item.lastPlayedAt }]
  const { index, offsetSec } = locatePart(parts, positionSec)
  await Promise.all(parts.slice(0, index).map((p) => setPlayed(session, p.id, true)))
  await call(`/UserItems/${parts[index].id}/UserData?userId=${session.userId}`, {
    method: 'POST', token: session.token,
    body: { PlaybackPositionTicks: Math.round(offsetSec * TICKS_PER_SECOND), Played: false, LastPlayedDate: new Date().toISOString() },
  })
}

/**
 * Watched or not, on the server. The same flag Swiftfin shows, so marking a film
 * here marks it there.
 */
export async function setPlayed(session: JellyfinSession, itemId: string, played: boolean): Promise<void> {
  await call(`/UserPlayedItems/${itemId}?userId=${session.userId}`, {
    method: played ? 'POST' : 'DELETE', token: session.token,
  })
}

/** Poster from the server's own cache. Needs no token. */
export function posterUrl(item: HomeItem, width = 300): string | null {
  if (!item.imageTag) return null
  return `${JELLYFIN_URL}/Items/${item.id}/Images/Primary?fillWidth=${width}&quality=90&tag=${item.imageTag}`
}

/** The landscape still behind the detail sheet. Needs no token either. */
export function backdropUrl(item: HomeItem, width = 1280): string | null {
  if (!item.backdropTag) return null
  return `${JELLYFIN_URL}/Items/${item.id}/Images/Backdrop/0?fillWidth=${width}&quality=80&tag=${item.backdropTag}`
}

// What this app can play without help: H.264/AAC in MP4 straight from the file,
// everything else (the XviD AVIs, mostly) as HLS that the server transcodes on its
// GPU. Safari plays that HLS itself; elsewhere hls.js does.
const DEVICE_PROFILE = {
  MaxStreamingBitrate: 8_000_000,
  DirectPlayProfiles: [{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' }],
  TranscodingProfiles: [{
    Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac', Protocol: 'hls',
    Context: 'Streaming', MaxAudioChannels: '2', BreakOnNonKeyFrames: true,
  }],
  CodecProfiles: [],
  // Text subtitles come as a WebVTT file beside the video, which every browser
  // draws and which switches without stopping. Picture subtitles (DVD, Blu-ray)
  // cannot be drawn by a browser, so the server burns the chosen one in. With no
  // profile at all, as until 2026-10-17, the server burnt in whatever stream the
  // file marked default: Hit and Run always had Swedish subtitles, and they could
  // neither be changed nor turned off.
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'External' },
    ...['dvdsub', 'pgssub', 'dvbsub', 'xsub'].map((Format) => ({ Format, Method: 'Encode' })),
  ],
}

interface RawStream {
  Type: string; Index: number; Language?: string; Title?: string; IsTextSubtitleStream?: boolean
  DeliveryMethod?: string; DeliveryUrl?: string; IsForced?: boolean; IsDefault?: boolean
}

/**
 * Where to play a file from. The URL carries the token, because native HLS cannot
 * send headers. `burnIn` is the picture subtitle to burn into it; without one the
 * picture plays clean, with the text subtitles beside it.
 *
 * The server only listens to a subtitle choice that comes with a `MediaSourceId`;
 * without one it silently picks the file's default stream. For a film in one
 * version the media source has the item's own id.
 */
export async function getPlaybackSource(session: JellyfinSession, itemId: string, opts: { burnIn?: number } = {}): Promise<PlaybackSource> {
  const ask = (mediaSourceId: string) => call<{
    PlaySessionId: string
    MediaSources: { Id: string; Container?: string; SupportsDirectPlay?: boolean; TranscodingUrl?: string; MediaStreams?: RawStream[] }[]
  }>(`/Items/${itemId}/PlaybackInfo?userId=${session.userId}`, {
    method: 'POST', token: session.token,
    body: {
      DeviceProfile: DEVICE_PROFILE, UserId: session.userId, AutoOpenLiveStream: true,
      MediaSourceId: mediaSourceId, SubtitleStreamIndex: opts.burnIn ?? -1,
    },
  })
  let r = await ask(itemId)
  if (r.MediaSources[0] && r.MediaSources[0].Id !== itemId) r = await ask(r.MediaSources[0].Id)
  const ms = r.MediaSources[0]
  const subtitles: HomeSubtitle[] = (ms.MediaStreams ?? []).filter((st) => st.Type === 'Subtitle').map((st) => ({
    index: st.Index,
    lang: st.Language || undefined,
    title: st.Title || undefined,
    text: Boolean(st.IsTextSubtitleStream),
    url: st.IsTextSubtitleStream
      ? JELLYFIN_URL + (st.DeliveryUrl ?? `/Videos/${itemId}/${ms.Id}/Subtitles/${st.Index}/0/Stream.vtt?ApiKey=${session.token}`)
      : undefined,
    forced: Boolean(st.IsForced),
    isDefault: Boolean(st.IsDefault),
  }))
  const common = { itemId, mediaSourceId: ms.Id, playSessionId: r.PlaySessionId, subtitles, burntIn: opts.burnIn }
  if (ms.TranscodingUrl) {
    // Use the URL as given: the HLS routes are hidden from the 12.x API description,
    // and building them by hand is how a client breaks on the next release.
    return { url: JELLYFIN_URL + ms.TranscodingUrl, hls: true, ...common }
  }
  const q = new URLSearchParams({
    static: 'true', mediaSourceId: ms.Id, playSessionId: r.PlaySessionId, deviceId: deviceId(), ApiKey: session.token,
  })
  return { url: `${JELLYFIN_URL}/Videos/${itemId}/stream.${ms.Container ?? 'mp4'}?${q}`, hls: false, ...common }
}

export type PlaybackEvent = 'start' | 'progress' | 'stopped'

/**
 * Tells the server where playback is. This is the same watch state Swiftfin reads,
 * so a film paused here resumes there. Failures are swallowed: a missed report
 * costs at most ten seconds of position, a thrown one would stop the film.
 */
export async function reportPlayback(
  session: JellyfinSession, source: PlaybackSource, event: PlaybackEvent, positionSec: number, paused = false,
): Promise<void> {
  const path = event === 'start' ? '/Sessions/Playing' : event === 'progress' ? '/Sessions/Playing/Progress' : '/Sessions/Playing/Stopped'
  try {
    await call(path, {
      method: 'POST', token: session.token, timeoutMs: 8000,
      body: {
        ItemId: source.itemId,
        MediaSourceId: source.mediaSourceId,
        PlaySessionId: source.playSessionId,
        PositionTicks: Math.round(positionSec * TICKS_PER_SECOND),
        IsPaused: paused,
        CanSeek: true,
        PlayMethod: source.hls ? 'Transcode' : 'DirectPlay',
      },
    })
  } catch {
    // see above
  }
}
