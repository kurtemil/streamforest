import { useEffect, useRef, useState } from 'react'
import { HomePlayer } from '@/components/player/HomePlayer'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { getProfile, useProfileStore } from '@/stores/profileStore'
import { usePlaybackPrefsStore } from '@/stores/playbackPrefsStore'
import { backdropUrl, type HomeItem } from '@/services/jellyfin'
import { pollBion, putBionStatus, type BionCommand, type BionStatus } from '@/services/bion'
import { getHomePlayerBridge, seekTarget } from '@/lib/homePlayerBridge'
import { progressPercent } from '@/lib/progress'
import { t, useLocale, useT, INTL_TAGS } from '@/lib/i18n'

const POLL_MS = 2_000
/** Status writes while a film is on; the phone's remote follows these. */
const STATUS_EVERY_MS = 5_000
/** While idle, only often enough for the phone to know the kiosk is alive. */
const IDLE_STATUS_EVERY_MS = 60_000
const FAILED_SHOWN_MS = 12_000
/** How often an idle kiosk looks for a newer build. It has no service worker and is never reloaded by hand. */
const UPDATE_CHECK_MS = 10 * 60_000

type Phase =
  | { state: 'idle' }
  | { state: 'loading'; item?: HomeItem }
  | { state: 'failed'; message: string }

interface Live { state: BionStatus['state']; position: number; duration: number }

/** Where the film stands, read from the player. Null when nothing is playing. */
function readLive(): Live | null {
  const bridge = getHomePlayerBridge()
  if (!bridge) return null
  const v = bridge.video
  if (bridge.failed) return { state: 'failed', position: 0, duration: bridge.duration }
  // Paused at zero is a film that has not started yet, not one somebody paused.
  const state: Live['state'] = v.paused
    ? (v.currentTime > 0 ? 'paused' : 'loading')
    : (v.readyState >= 3 ? 'playing' : 'loading')
  return { state, position: bridge.offset + v.currentTime, duration: bridge.duration }
}

/** The one build this page was loaded with, by its entry script. */
function currentBuild(): string | null {
  const src = Array.from(document.scripts).map((s) => s.src).find((s) => /\/assets\/index-[^/]+\.js$/.test(s))
  return src ? new URL(src).pathname : null
}

/**
 * StreamForest as the kiosk in the basement ("Bion"). No profile picker, no tab
 * bar, no browser controls: an idle screen with the time, and the home player when
 * the phone sends a film. Commands come from /api/bion every two seconds; the
 * status goes back the same way.
 */
export function KioskApp() {
  const tr = useT()
  const playing = useHomeLibraryStore((s) => s.playing)
  const [phase, setPhase] = useState<Phase>({ state: 'idle' })
  const [live, setLive] = useState<Live | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  // Back to idle when the film is closed or has ended, unless a failure is showing.
  useEffect(() => {
    if (playing) setPhase((p) => (p.state === 'loading' ? { state: 'idle' } : p))
    else setPhase((p) => (p.state === 'failed' ? p : { state: 'idle' }))
  }, [playing])

  useEffect(() => {
    if (phase.state !== 'failed') return
    const timer = window.setTimeout(() => setPhase({ state: 'idle' }), FAILED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  // A film the player could not open is shown as failed for a while, then put away.
  useEffect(() => {
    if (live?.state !== 'failed') return
    const timer = window.setTimeout(() => useHomeLibraryStore.getState().close(), FAILED_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [live?.state])

  // Commands. The first poll only learns where the queue stands, so a restart never
  // replays a film somebody asked for before it.
  useEffect(() => {
    let alive = true
    let after: number | null = null
    let timer = 0

    const start = async (c: Extract<BionCommand, { type: 'play' }>) => {
      const profile = getProfile(c.profileId)
      if (!profile) return
      const home = useHomeLibraryStore.getState()
      home.close()
      setPhase({ state: 'loading' })
      useProfileStore.getState().setProfile(profile.id)
      // Subtitle language and size are the profile's, as on the phone.
      await usePlaybackPrefsStore.getState().syncFromRemote(profile.id).catch(() => {})
      await home.load(profile.id, profile.name)
      const fresh = useHomeLibraryStore.getState()
      const item = fresh.status === 'ready' ? fresh.items.find((i) => i.id === c.itemId) : undefined
      if (!item) {
        setPhase({ state: 'failed', message: t('bion.notFound', { name: profile.name }) })
        return
      }
      setPhase({ state: 'loading', item })
      fresh.play(item, { fromStart: c.fromStart })
    }

    const apply = async (c: BionCommand) => {
      const video = getHomePlayerBridge()?.video
      if (c.type === 'play') return start(c)
      if (c.type === 'stop') { useHomeLibraryStore.getState().close(); return }
      if (!video) return
      if (c.type === 'pause') video.pause()
      if (c.type === 'resume') void video.play().catch(() => {})
      if (c.type === 'seek') video.currentTime = seekTarget(video.currentTime, c.by, video.duration)
    }

    const loop = async () => {
      const poll = await pollBion(after ?? undefined)
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

  // Status, every second read and written when it changes, or as often as the phone needs it.
  useEffect(() => {
    let sentKey = ''
    let sentAt = 0
    const timer = window.setInterval(() => {
      const current = readLive()
      setLive((prev) => (prev?.state === current?.state && Math.floor(prev?.position ?? 0) === Math.floor(current?.position ?? 0) ? prev : current))
      const film = useHomeLibraryStore.getState().playing
      const p = phaseRef.current
      const status: Omit<BionStatus, 'updated'> = film && current?.state === 'failed'
        ? { state: 'failed', itemId: film.id, title: t('home.playFailed') }
        : film && current
        ? {
            state: current.state,
            profileId: useProfileStore.getState().activeProfileId ?? undefined,
            itemId: film.id,
            title: film.name,
            position: Math.round(current.position),
            duration: Math.round(current.duration),
          }
        : p.state === 'loading' ? { state: 'loading', itemId: p.item?.id, title: p.item?.name }
        : p.state === 'failed' ? { state: 'failed', title: p.message }
        : { state: film ? 'loading' : 'idle' }
      const key = `${status.state}|${status.itemId ?? ''}|${status.title ?? ''}`
      const now = Date.now()
      const every = status.state === 'idle' ? IDLE_STATUS_EVERY_MS : STATUS_EVERY_MS
      if (key !== sentKey || now - sentAt >= every) {
        putBionStatus(status)
        sentKey = key
        sentAt = now
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  // A new build is picked up while nothing is on, never in the middle of a film.
  useEffect(() => {
    const mine = currentBuild()
    if (!mine) return
    const timer = window.setInterval(async () => {
      if (useHomeLibraryStore.getState().playing || phaseRef.current.state !== 'idle') return
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text()
        if (!html.includes(mine)) window.location.reload()
      } catch { /* offline: try again next time */ }
    }, UPDATE_CHECK_MS)
    return () => window.clearInterval(timer)
  }, [])

  const film = playing
  const loadingItem = phase.state === 'loading' ? phase.item ?? null : null
  const showLoading = phase.state === 'loading' || (film && (!live || live.state === 'loading'))
  // The player shows its own failure line over the picture; the loading screen must not cover it.
  const filmFailed = live?.state === 'failed'
  const loadingTitle = film?.name ?? loadingItem?.name

  return (
    <div className="fixed inset-0 bg-black text-white cursor-none select-none overflow-hidden">
      {!film && phase.state !== 'loading' && <Idle message={phase.state === 'failed' ? phase.message : null} />}
      <HomePlayer />
      {showLoading && !filmFailed && (
        <Loading title={loadingTitle} backdrop={(film ?? loadingItem) ? backdropUrl((film ?? loadingItem)!) : null} />
      )}
      {film && live?.state === 'paused' && (
        <div className="fixed inset-x-0 bottom-0 z-[60] px-16 pb-14 pt-40 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
          <p className="text-2xl text-white/60">{tr('bion.pausedLabel')}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight">{film.name}</p>
          <div className="mt-6 h-1.5 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full bg-white/80" style={{ width: `${progressPercent(live.position, live.duration)}%` }} />
          </div>
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
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-white/35">Bion</p>
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
