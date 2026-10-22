import { useEffect, useRef, useState } from 'react'
import { HomePlayer } from '@/components/player/HomePlayer'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { usePlayerStore } from '@/stores/playerStore'
import { usePlaylistStore } from '@/stores/playlistStore'
import { getProfile, useProfileStore, type Profile } from '@/stores/profileStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import { channelTitle } from '@/stores/bionStore'
import { syncFromRemote } from '@/services/sync'
import { clearProgress } from '@/services/db'
import { backdropUrl } from '@/services/jellyfin'
import { pollBion, putBionStatus, type BionCommand, type BionSource, type BionStatus } from '@/services/bion'
import { kioskDevice, kioskStartCursor } from '@/lib/kiosk'
import { getPlayerBridge, seekTarget, type PlayerBridge } from '@/lib/playerBridge'
import { progressPercent } from '@/lib/progress'
import { t, useLocale, useT, INTL_TAGS } from '@/lib/i18n'

const POLL_MS = 2_000
/** Status writes while a film is on; the phone's remote follows these. */
const STATUS_EVERY_MS = 5_000
/** While idle, only often enough for the phone to know the kiosk is switched on. */
const IDLE_STATUS_EVERY_MS = 60_000
const FAILED_SHOWN_MS = 12_000
/** A film that has ended with no next episode coming is put away after this long. */
const ENDED_CLOSE_MS = 15_000
/** How often an idle kiosk looks for a newer build. It has no service worker and is never reloaded by hand. */
const UPDATE_CHECK_MS = 10 * 60_000
/**
 * The longest a `hold` keeps a film still: a projector cooling down (~100 s), then
 * warming up (~25 s) and finding its input. Home Assistant normally sends `resume`
 * well before; this is for when it never does.
 */
const HOLD_MS = 4 * 60_000
/** What the phone is offered of a film's tracks, so the status stays small. */
const MAX_TRACKS = 30
const MAX_TRACK_NAME = 60

declare global {
  interface Window {
    /**
     * The TV's app (hemma/tv/startskarm), when this page runs in it: told the kiosk's
     * state whenever it changes, so it can keep the screen on during a film and go
     * back to the TV's home screen when nothing is on.
     */
    KioskHost?: { state?: (state: string) => void }
  }
}

/** Which kiosk this page is, and so which queue it reads and which status it writes. */
const DEVICE = kioskDevice()

/**
 * Set while Home Assistant warms the projector up: every film that starts playing
 * is stopped at once and waits for `resume`. One kiosk, one hold, so it lives here.
 */
let hold: { until: number } | null = null
/** Set by a seek: the phone's scrubber should not jump back for want of a status. */
let writeStatusNow = false

function holdFilm() {
  hold = { until: Date.now() + HOLD_MS }
  const video = getPlayerBridge()?.video
  if (video && !video.paused) video.pause()
}

type Phase =
  | { state: 'idle' }
  | { state: 'loading'; title?: string; backdrop?: string | null }
  | { state: 'failed'; message: string }

interface Live { state: BionStatus['state']; position: number; duration: number; live: boolean; ended: boolean }

/** What is open in either player: its id, name and where it came from. */
interface Film { source: BionSource; id: string; title: string; backdrop: string | null }

function currentFilm(): Film | null {
  const home = useHomeLibraryStore.getState().playing
  if (home) return { source: 'home', id: home.id, title: home.name, backdrop: backdropUrl(home) }
  const channel = usePlayerStore.getState().current
  if (channel) return { source: 'iptv', id: channel.id, title: channelTitle(channel), backdrop: null }
  return null
}

/** Where the film stands, read from the player. Null when nothing is playing. */
function readLive(): Live | null {
  const bridge = getPlayerBridge()
  if (!bridge) return null
  const v = bridge.video
  const base = { position: bridge.position(), duration: bridge.duration(), live: bridge.live, ended: v.ended }
  if (bridge.failed) return { ...base, state: 'failed' }
  if (hold) return { ...base, state: 'waiting' }
  // Paused at zero is a film that has not started yet, not one somebody paused.
  const state: Live['state'] = v.paused
    ? (v.currentTime > 0 ? 'paused' : 'loading')
    : (v.readyState >= 3 ? 'playing' : 'loading')
  return { ...base, state }
}

/** The tracks worth offering on the phone: audio when there is a choice, subtitles when there are any. */
function trackStatus(bridge: PlayerBridge | null): Pick<BionStatus, 'audio' | 'audioActive' | 'subtitles' | 'subtitleActive'> {
  const tracks = bridge?.tracks?.()
  if (!tracks) return {}
  const trim = (list: { id: number; name: string }[]) =>
    list.slice(0, MAX_TRACKS).map((x) => ({ id: x.id, name: x.name.slice(0, MAX_TRACK_NAME) }))
  return {
    ...(bridge?.selectAudio && tracks.audio.length > 1 ? { audio: trim(tracks.audio), audioActive: tracks.audioActive } : {}),
    ...(bridge?.selectSubtitle && tracks.subtitles.length > 0
      ? { subtitles: trim(tracks.subtitles), subtitleActive: tracks.subtitleActive }
      : {}),
  }
}

/** The one build this page was loaded with, by its entry script. */
function currentBuild(): string | null {
  const src = Array.from(document.scripts).map((s) => s.src).find((s) => /\/assets\/index-[^/]+\.js$/.test(s))
  return src ? new URL(src).pathname : null
}

/**
 * The IPTV playlist, on a kiosk that may never have had one. The same steps a new
 * phone takes: what is stored, then the address from D1, then a fetch. Shared, so
 * a play that arrives while it runs waits for the same fetch.
 */
let playlistReady: Promise<void> | null = null
function ensurePlaylist(force = false): Promise<void> {
  if (playlistReady && !force) return playlistReady
  playlistReady = (async () => {
    const store = usePlaylistStore.getState()
    if (!force) {
      await store.loadFromDB()
      if (usePlaylistStore.getState().channels.length > 0) return
      await store.syncM3uUrlFromRemote()
    }
    if (usePlaylistStore.getState().m3uUrl) await usePlaylistStore.getState().refresh()
  })().catch(() => {})
  return playlistReady
}

function closeBoth() {
  const bridge = getPlayerBridge()
  if (bridge) bridge.close()
  useHomeLibraryStore.getState().close()
  usePlayerStore.getState().close()
}

/**
 * StreamForest as the kiosk in the basement ("Bion"). No profile picker, no tab
 * bar, no controls on screen: an idle screen with the time, and the home player or
 * the IPTV player when the phone sends something. Commands come from /api/bion
 * every two seconds; the status goes back the same way.
 */
export function KioskApp() {
  const tr = useT()
  const homeOpen = useHomeLibraryStore((s) => s.playing !== null)
  const iptvOpen = usePlayerStore((s) => s.current !== null)
  const filmOpen = homeOpen || iptvOpen
  const [phase, setPhase] = useState<Phase>({ state: 'idle' })
  const [live, setLive] = useState<Live | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // The playlist is fetched once up front, so the first IPTV film starts as fast as a home one.
  useEffect(() => { void ensurePlaylist() }, [])

  // Back to idle when the film is closed or has ended, unless a failure is showing.
  useEffect(() => {
    if (filmOpen) setPhase((p) => (p.state === 'loading' ? { state: 'idle' } : p))
    else setPhase((p) => (p.state === 'failed' ? p : { state: 'idle' }))
  }, [filmOpen])

  useEffect(() => {
    if (phase.state !== 'failed') return
    const timer = window.setTimeout(() => setPhase({ state: 'idle' }), FAILED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // A film the player could not open is shown as failed for a while, then put away.
  useEffect(() => {
    if (live?.state !== 'failed') return
    const timer = window.setTimeout(closeBoth, FAILED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [live?.state])

  // An ended film with no next episode would otherwise sit on its last frame.
  // A next episode replaces the player's bridge within ten seconds and resets this.
  useEffect(() => {
    if (!live?.ended) return
    const timer = window.setTimeout(() => { if (getPlayerBridge()?.video.ended) closeBoth() }, ENDED_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [live?.ended])

  // While the projector warms up, a film that gets going is stopped on its first
  // frame. `playing` does not bubble, so this listens on the way down.
  useEffect(() => {
    const onPlaying = (e: Event) => { if (hold && e.target instanceof HTMLMediaElement) e.target.pause() }
    document.addEventListener('playing', onPlaying, true)
    return () => document.removeEventListener('playing', onPlaying, true)
  }, [])

  // Commands. The first poll only learns where the queue stands, so a restart never
  // replays a film somebody asked for before it; unless the page was opened by that
  // film (the TV's app, `?after=`), and then it starts just before it.
  useEffect(() => {
    let alive = true
    let after: number | null = kioskStartCursor()
    let timer = 0

    const become = async (profile: Profile) => {
      useProfileStore.getState().setProfile(profile.id)
      // Subtitle language and size, and (for IPTV) where each film was left, are the
      // profile's, as on the phone. Home films keep their positions in Jellyfin.
      await Promise.all([
        usePlaybackPrefsStore.getState().syncFromRemote(profile.id).catch(() => {}),
        syncFromRemote(profile.id),
      ])
    }

    const startHome = async (c: Extract<BionCommand, { type: 'play' }>, profile: Profile) => {
      await become(profile)
      const home = useHomeLibraryStore.getState()
      await home.load(profile.id, profile.name)
      const fresh = useHomeLibraryStore.getState()
      const item = fresh.status === 'ready' ? fresh.items.find((i) => i.id === c.itemId) : undefined
      if (!item) return setPhase({ state: 'failed', message: t('bion.notFound', { name: profile.name }) })
      setPhase({ state: 'loading', title: item.name, backdrop: backdropUrl(item) })
      fresh.play(item, { fromStart: c.fromStart })
    }

    const startIptv = async (c: Extract<BionCommand, { type: 'play' }>, profile: Profile) => {
      setPhase({ state: 'loading' })
      await become(profile)
      await ensurePlaylist()
      const find = () => usePlaylistStore.getState().channels.find((ch) => ch.id === c.itemId)
      let channel = find()
      // The phone's playlist may be newer than this one.
      if (!channel) { await ensurePlaylist(true); channel = find() }
      if (!channel) return setPhase({ state: 'failed', message: t('bion.notFound', { name: profile.name }) })
      if (c.fromStart) await clearProgress(profile.id, channel.id).catch(() => {})
      setPhase({ state: 'loading', title: channelTitle(channel) })
      usePlayerStore.getState().play(channel)
    }

    const apply = async (c: BionCommand) => {
      if (c.type === 'play') {
        const profile = getProfile(c.profileId)
        if (!profile) return
        closeBoth()
        setPhase({ state: 'loading' })
        return c.source === 'iptv' ? startIptv(c, profile) : startHome(c, profile)
      }
      if (c.type === 'stop') { hold = null; closeBoth(); return }
      if (c.type === 'hold') { holdFilm(); return }
      // From Home Assistant when the picture is up, or from the phone: start anyway.
      if (c.type === 'resume') hold = null
      const bridge = getPlayerBridge()
      if (!bridge) return
      if (c.type === 'pause') bridge.video.pause()
      if (c.type === 'resume') void bridge.video.play().catch(() => {})
      if (c.type === 'seek' && !bridge.live) {
        bridge.seek(c.to !== undefined
          ? seekTarget(0, c.to, bridge.duration())
          : seekTarget(bridge.position(), c.by, bridge.duration()))
        writeStatusNow = true
      }
      if (c.type === 'audio') bridge.selectAudio?.(c.id)
      if (c.type === 'subtitle') bridge.selectSubtitle?.(c.id)
    }

    const loop = async () => {
      const poll = await pollBion(DEVICE, after ?? undefined)
      if (!alive) return
      if (poll) {
        if (after === null) after = poll.latest
        else {
          for (const c of poll.commands) {
            after = Math.max(after, c.seq)
            await apply(c)
          }
        }
      }
      timer = window.setTimeout(loop, POLL_MS)
    }
    void loop()
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])

  // Status, read every second and written when it changes, or as often as the phone needs it.
  useEffect(() => {
    let sentKey = ''
    let sentAt = 0
    let hostState = ''
    const timer = window.setInterval(() => {
      // A hold nobody lifted: the film starts, picture or not.
      if (hold && Date.now() > hold.until) {
        hold = null
        void getPlayerBridge()?.video.play().catch(() => {})
      }
      const current = readLive()
      setLive((prev) => (prev && current && prev.state === current.state && prev.ended === current.ended &&
        Math.floor(prev.position) === Math.floor(current.position) ? prev : current))
      const film = currentFilm()
      const p = phaseRef.current
      const status: Omit<BionStatus, 'updated'> = film && current?.state === 'failed'
        ? { state: 'failed', source: film.source, itemId: film.id, title: t('home.playFailed') }
        : film && current
        ? {
            state: current.state,
            source: film.source,
            live: current.live || undefined,
            profileId: useProfileStore.getState().activeProfileId ?? undefined,
            itemId: film.id,
            title: film.title,
            position: current.live ? undefined : Math.round(current.position),
            duration: current.live ? undefined : Math.round(current.duration),
            ...trackStatus(getPlayerBridge()),
          }
        : p.state === 'loading' ? { state: 'loading', title: p.title }
        : p.state === 'failed' ? { state: 'failed', title: p.message }
        : { state: film ? 'loading' : 'idle', title: film?.title }
      // A track switch is written at once, so the phone's menu ticks the new one.
      const key = `${status.state}|${status.itemId ?? ''}|${status.title ?? ''}|` +
        `${status.audio?.length ?? 0}:${status.audioActive ?? ''}|${status.subtitles?.length ?? 0}:${status.subtitleActive ?? ''}`
      const now = Date.now()
      const every = status.state === 'idle' ? IDLE_STATUS_EVERY_MS : STATUS_EVERY_MS
      if (status.state !== hostState) {
        hostState = status.state
        try { window.KioskHost?.state?.(status.state) } catch { /* not in the TV's app */ }
      }
      if (key !== sentKey || now - sentAt >= every || writeStatusNow) {
        putBionStatus(DEVICE, status)
        sentKey = key
        sentAt = now
        writeStatusNow = false
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  // A new build is picked up while nothing is on, never in the middle of a film.
  useEffect(() => {
    const mine = currentBuild()
    if (!mine) return
    const timer = window.setInterval(async () => {
      if (currentFilm() || phaseRef.current.state !== 'idle') return
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text()
        if (!html.includes(mine)) window.location.reload()
      } catch { /* offline: try again next time */ }
    }, UPDATE_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const film = filmOpen ? currentFilm() : null
  const filmFailed = live?.state === 'failed'
  const showLoading = !filmFailed &&
    (phase.state === 'loading' || (film && (!live || live.state === 'loading' || live.state === 'waiting')))
  const loadingTitle = phase.state === 'loading' ? phase.title ?? film?.title : film?.title
  const loadingBackdrop = phase.state === 'loading' && phase.backdrop !== undefined ? phase.backdrop : film?.backdrop ?? null

  return (
    <div className="fixed inset-0 bg-black text-white cursor-none select-none overflow-hidden">
      {!film && phase.state !== 'loading' && <Idle message={phase.state === 'failed' ? phase.message : null} />}
      <HomePlayer />
      <VideoPlayer />
      {showLoading && <Loading title={loadingTitle} backdrop={loadingBackdrop} />}
      {film && live?.state === 'paused' && (
        <div className="fixed inset-x-0 bottom-0 z-[60] px-16 pb-14 pt-40 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
          <p className="text-2xl text-white/60">{tr('bion.pausedLabel')}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">{film.title}</p>
          {!live.live && (
            <div className="mt-6 h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div className="h-full bg-white/80" style={{ width: `${progressPercent(live.position, live.duration)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Idle({ message }: { message: string | null }) {
  const tr = useT()
  const locale = useLocale()
  const [now, setNow] = useState(() => new Date())
  // The minute is all the clock shows, so it changes no more often than that.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  const tag = INTL_TAGS[locale]
  const time = now.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  const date = now.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_60%)]">
      <p className="text-[12rem] leading-none font-extralight tabular-nums tracking-tight text-white/90">{time}</p>
      <p className="mt-6 text-3xl font-light text-white/45 first-letter:uppercase">{date}</p>
      <div className="absolute bottom-20 inset-x-0 flex flex-col items-center gap-3 px-16 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-white/35">
          {DEVICE === 'vardagsrum' ? tr('bion.livingRoom') : 'Bion'}
        </p>
        <p className={`text-2xl ${message ? 'text-amber-300/90' : 'text-white/40'}`}>{message ?? tr('bion.idleHint')}</p>
      </div>
    </div>
  )
}

function Loading({ title, backdrop }: { title?: string; backdrop: string | null }) {
  const tr = useT()
  return (
    <div className="fixed inset-0 z-[60] bg-black flex items-end">
      {backdrop && <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />}
      <div className="relative w-full px-16 pb-16 pt-40 bg-gradient-to-t from-black via-black/70 to-transparent">
        <div className="h-10 w-10 mb-6 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
        <p className="text-5xl font-semibold tracking-tight">{title ? tr('bion.loading', { title }) : tr('bion.starting')}</p>
      </div>
    </div>
  )
}
