// Playback diagnostics — the only window into what the player actually does on a
// phone in the living room. Every playback attempt gets an id; every step in the
// chain emits an event under it, so the server log can be read as a timeline
// rather than a pile of unrelated lines.
//
// Events are batched: a stalling stream can emit waiting/playing pairs several
// times a second, and one fetch per event would add network noise to the very
// thing being measured.

const FLUSH_INTERVAL_MS = 3000
const FLUSH_AT_QUEUED = 20
const MAX_QUEUE = 200

function proxyBase(): string | null {
  const base = import.meta.env.VITE_TRANSCODE_PROXY_URL as string | undefined
  if (!base) return null
  return base.replace(/\/+$/, '')
}

// ── Client context ────────────────────────────────────────────────────────────

export interface ClientContext {
  ua: string
  /** Rendering engine, which on iOS is WebKit no matter which browser is installed. */
  engine: 'webkit' | 'blink' | 'gecko' | 'unknown'
  /** Browser brand as advertised. On iOS this is a UI shell, not an engine. */
  brand: string
  isIos: boolean
  iosVersion: string | null
  /** True when launched from the home screen (Apple's legacy flag). */
  standalone: boolean
  /** True when the manifest display mode is active (the standards-based check). */
  displayModeStandalone: boolean
  screen: string
  viewport: string
  dpr: number
  /** Resolved safe-area insets in CSS pixels — top/right/bottom/left. */
  insets: string
  connection: string | null
  lang: string
  tz: string
}

// iOS reports WebKit regardless of the browser shell. Order matters: the iOS
// shells advertise their own token *and* Safari's, so they must be tested first.
function detectBrand(ua: string): string {
  if (/CriOS\//.test(ua)) return 'chrome-ios'
  if (/FxiOS\//.test(ua)) return 'firefox-ios'
  if (/EdgiOS\//.test(ua)) return 'edge-ios'
  if (/OPiOS\/|OPT\//.test(ua)) return 'opera-ios'
  if (/Edg\//.test(ua)) return 'edge'
  if (/OPR\//.test(ua)) return 'opera'
  if (/Firefox\//.test(ua)) return 'firefox'
  if (/Chrome\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua)) return 'safari'
  return 'unknown'
}

function detectIos(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS 13+ reports itself as desktop Safari; touch points give it away.
  return typeof navigator !== 'undefined'
    && navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1
}

// Reads what the browser actually resolved env(safe-area-inset-*) to. Emulated
// insets in a test browser and real insets on a notched phone are different
// numbers, and only the real one tells us whether a padding fix landed.
//
// Exported because the value moves. `getClientContext()` caches its whole record
// for the session, which is right for a log line stamped once per load and wrong
// for a live readout: iOS resolved these to 0/0/0/0 at boot and 34px for the
// bottom a moment later, so the Device panel spent the tab-bar investigation
// reporting no insets while the bar it was measuring carried 34px of them.
// Anything reading insets to decide something has to call this itself.
export function readSafeAreaInsets(): string {
  if (typeof document === 'undefined') return 'n/a'
  try {
    const probe = document.createElement('div')
    probe.style.cssText = [
      'position:fixed', 'visibility:hidden', 'pointer-events:none',
      'top:0', 'left:0', 'width:0', 'height:0',
      'padding-top:env(safe-area-inset-top,0px)',
      'padding-right:env(safe-area-inset-right,0px)',
      'padding-bottom:env(safe-area-inset-bottom,0px)',
      'padding-left:env(safe-area-inset-left,0px)',
    ].join(';')
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const insets = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
      .map(v => parseFloat(v) || 0)
      .join('/')
    probe.remove()
    return insets
  } catch {
    return 'error'
  }
}

let cachedContext: ClientContext | null = null

export function getClientContext(): ClientContext {
  if (cachedContext) return cachedContext
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const isIos = detectIos(ua)
  const brand = detectBrand(ua)
  const engine: ClientContext['engine'] =
    isIos ? 'webkit'
    : /Chrome\/|Edg\/|OPR\//.test(ua) ? 'blink'
    : /Firefox\//.test(ua) ? 'gecko'
    : /Safari\//.test(ua) ? 'webkit'
    : 'unknown'
  const iosMatch = ua.match(/OS (\d+)[_.](\d+)/)
  const conn = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number }
  }).connection

  cachedContext = {
    ua,
    engine,
    brand,
    isIos,
    iosVersion: iosMatch ? `${iosMatch[1]}.${iosMatch[2]}` : null,
    standalone: !!(navigator as Navigator & { standalone?: boolean }).standalone,
    displayModeStandalone:
      typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches,
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'n/a',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'n/a',
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
    insets: readSafeAreaInsets(),
    connection: conn?.effectiveType ? `${conn.effectiveType}@${conn.downlink ?? '?'}Mbps` : null,
    lang: typeof navigator !== 'undefined' ? navigator.language : 'n/a',
    tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'n/a' } })(),
  }
  return cachedContext
}

// ── Event queue ───────────────────────────────────────────────────────────────

interface QueuedEvent {
  ts: number
  sid: string
  pid?: string
  /** Milliseconds since the current playback attempt started. */
  t?: number
  ev: string
  level?: 'error'
  [k: string]: unknown
}

// Random enough to join a device's events together in the log; not an identifier
// we need to keep stable across reloads.
function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

const sessionId = shortId()
let playbackId: string | null = null
let playbackStart = 0

let queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(useBeacon = false): void {
  const base = proxyBase()
  if (!base || queue.length === 0) return
  const batch = queue
  queue = []
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }

  const url = `${base}/clientlog`
  const body = JSON.stringify(batch)

  // pagehide is the last moment iOS reliably gives us before freezing the tab,
  // and fetch() there is not guaranteed to run. sendBeacon is.
  if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      return
    } catch { /* fall through to fetch */ }
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => { /* diagnostics must never surface as a user-visible failure */ })
}

function enqueue(event: QueuedEvent): void {
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push(event)
  if (queue.length >= FLUSH_AT_QUEUED) { flush(); return }
  if (!flushTimer) flushTimer = setTimeout(() => flush(), FLUSH_INTERVAL_MS)
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Emit one diagnostic event. Attaches the session id, the current playback id
 * and the elapsed time since that playback started, so the server log reads as
 * a per-attempt timeline.
 */
export function trace(ev: string, data: Record<string, unknown> = {}): void {
  enqueue({
    ts: Date.now(),
    sid: sessionId,
    ...(playbackId ? { pid: playbackId, t: Date.now() - playbackStart } : {}),
    ev,
    ...data,
  })
}

/** Emit an event marked as an error, which the server also mirrors to its own log. */
export function traceError(ev: string, data: Record<string, unknown> = {}): void {
  trace(ev, { ...data, level: 'error' })
}

/** Emitted once per app load, so every session's events can be attributed to a device. */
export function traceSessionStart(): void {
  trace('session-start', { ...getClientContext() } as unknown as Record<string, unknown>)
  flush()
}

/**
 * Begin a new playback attempt. Everything traced after this carries the new
 * playback id and a millisecond offset, which is what turns the log into
 * answerable questions: how long until the first frame, and where did it fail.
 */
export function tracePlaybackStart(info: Record<string, unknown>): string {
  playbackId = shortId()
  playbackStart = Date.now()
  trace('open', info)
  return playbackId
}

export function tracePlaybackEnd(info: Record<string, unknown> = {}): void {
  if (!playbackId) return
  trace('close', info)
  playbackId = null
  flush()
}

/**
 * Snapshot of the media element's own view of the stream.
 *
 * `seekable` is the interesting field: for a growing HLS playlist without
 * EXT-X-PLAYLIST-TYPE, WebKit treats the stream as live and reports a seekable
 * window that starts well past zero. That single number decides finding A2, and
 * it can only be read on the device.
 */
export function mediaSnapshot(video: HTMLVideoElement): Record<string, unknown> {
  const range = (tr: TimeRanges) => {
    if (tr.length === 0) return null
    return `${tr.start(0).toFixed(1)}-${tr.end(tr.length - 1).toFixed(1)}`
  }
  return {
    currentTime: Number(video.currentTime.toFixed(2)),
    duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(1)) : String(video.duration),
    seekable: range(video.seekable),
    seekableCount: video.seekable.length,
    buffered: range(video.buffered),
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused,
  }
}

/**
 * Call play() and record what happened.
 *
 * Replaces the bare `.catch(() => {})` that used to hide every rejection. On iOS
 * a play() issued outside a user gesture is rejected with NotAllowedError and the
 * user is left staring at a spinner; without this we cannot tell that case apart
 * from a stream that never arrived.
 */
export type PlayOutcome = 'ok' | 'blocked' | 'failed'

export function safePlay(video: HTMLVideoElement, phase: string): Promise<PlayOutcome> {
  trace('play-call', { phase, paused: video.paused, readyState: video.readyState })
  const result = video.play()
  // Older WebKit returns undefined rather than a promise.
  if (!result || typeof result.then !== 'function') {
    trace('play-sync', { phase })
    return Promise.resolve('ok')
  }
  return result
    .then((): PlayOutcome => { trace('play-ok', { phase }); return 'ok' })
    .catch((err: unknown): PlayOutcome => {
      const name = (err as { name?: string })?.name ?? 'unknown'
      const message = (err as { message?: string })?.message ?? String(err)
      // NotAllowedError is the autoplay policy refusing a play() that arrived
      // outside a user gesture — a spent tap, not a broken stream. Telling the
      // two apart is the whole reason this wrapper exists: one deserves a tap
      // target, the other an error.
      traceError('play-rejected', { phase, name, message: message.slice(0, 200) })
      return name === 'NotAllowedError' ? 'blocked' : 'failed'
    })
}

/** Flush pending events now. Used by the harness and before a deliberate teardown. */
export function flushDiagnostics(): void {
  flush()
}
