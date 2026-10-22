import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { Captions, Check, Minus, Pause, Play, Plus, Projector, RotateCcw, RotateCw, Sofa, Square, Volume2 } from 'lucide-react'
import { bionAlive, bionVisible, receiverVolume, useBionStore, VOLUME_STEP } from '@/stores/bionStore'
import type { BionDevice, BionTrack } from '@/services/bion'
import { progressPercent } from '@/lib/progress'
import { useT } from '@/lib/i18n'

/** Often while something is on, so pause and seek show up quickly; rarely otherwise. */
const ACTIVE_POLL_MS = 2_500
const MODE_POLL_MS = 5_000
const IDLE_POLL_MS = 15_000

function clock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** What the remote calls each kiosk. Bion's own strings came first, the living room's beside them. */
const WORDS = {
  bion: {
    playOn: 'bion.playOn', remote: 'bion.remote', starting: 'bion.starting', playing: 'bion.playing',
    paused: 'bion.paused', readyHint: 'bion.readyHint', sendFailed: 'bion.sendFailed',
  },
  vardagsrum: {
    playOn: 'bion.lr.playOn', remote: 'bion.lr.remote', starting: 'bion.lr.starting', playing: 'bion.lr.playing',
    paused: 'bion.lr.paused', readyHint: 'bion.lr.readyHint', sendFailed: 'bion.lr.sendFailed',
  },
} as const

/**
 * The kiosks from the phone: a button for each that turns Bion mode on for it
 * (every Play then goes there) and off, and the remote that floats above the tab
 * bar while a mode is on or something is playing. Bion's button shows only while
 * that kiosk has been heard from or a mode is on; the living room's always, since
 * Home Assistant switches the TV's kiosk on when a Play arrives.
 */
export function BionRemote() {
  const t = useT()
  const { target, status, pending, clockSkew, failed, receiver, volumeHeld, setTarget, poll, send, setVolume } = useBionStore()
  const watched: BionDevice = target ?? 'bion'
  const words = WORDS[watched]
  const volume = receiverVolume({ receiver, volumeHeld })
  const active = bionVisible({ status, pending, clockSkew })
  const alive = bionAlive({ status, clockSkew })
  // Re-render on a timer too, so a status that goes stale takes the remote away.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  // Where the scrubber is held while a finger is on it; sent when it lets go.
  const [drag, setDrag] = useState<number | null>(null)
  const [tracksOpen, setTracksOpen] = useState(false)

  useEffect(() => {
    let alive = true
    let timer = 0
    const loop = async () => {
      if (document.visibilityState === 'visible') await useBionStore.getState().poll()
      if (!alive) return
      tick()
      const s = useBionStore.getState()
      timer = window.setTimeout(loop, bionVisible(s) ? ACTIVE_POLL_MS : s.target ? MODE_POLL_MS : IDLE_POLL_MS)
    }
    void loop()
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  const showBionToggle = target !== null || alive || active
  const showBar = active || target !== null
  const name = watched === 'vardagsrum' ? t('bion.livingRoom') : 'Bion'
  const Icon = watched === 'vardagsrum' ? Sofa : Projector

  const state = pending ? 'loading' : active ? status?.state ?? 'loading' : 'idle'
  const title = pending?.title ?? (active ? status?.title : undefined) ?? ''
  const label = state === 'failed' ? name
    : state === 'paused' ? t(words.paused)
    : state === 'playing' ? t(words.playing)
    : state === 'waiting' ? t('bion.waiting')
    : state === 'loading' ? t(words.starting)
    : alive ? `${name} · ${t('bion.ready')}`
    // The TV's kiosk is off until a Play wakes it, which is not the same as not answering.
    : watched === 'vardagsrum' ? t('bion.lr.wakes') : t('bion.offline')
  const live = state === 'playing' || state === 'paused'
  const seekable = live && !status?.live
  const duration = status?.duration ?? 0
  const position = drag ?? status?.position
  const pct = status && active && !pending ? progressPercent(position ?? 0, duration) : 0
  const audio = live ? status?.audio ?? [] : []
  const subtitles = live ? status?.subtitles ?? [] : []
  const hasTracks = audio.length > 1 || subtitles.length > 0
  const button = 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-transform'

  // Pointer, touch and blur can all end one drag; the ref makes it one seek.
  const dragRef = useRef<number | null>(null)
  const move = (to: number) => { dragRef.current = to; setDrag(to) }
  const letGo = () => {
    const to = dragRef.current
    if (to === null) return
    dragRef.current = null
    setDrag(null)
    void send({ type: 'seek', to })
  }

  return (
    <>
      {/* Bion lowest, where its one button always was; the living room above it. */}
      <div className="fixed z-40 right-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom,0px))] md:right-4 md:bottom-4 flex flex-col-reverse gap-2">
        {showBionToggle && (
          <KioskToggle on={target === 'bion'} label={t(WORDS.bion.playOn)} offLabel={t('bion.toggleOff')} onClick={() => setTarget(target === 'bion' ? null : 'bion')}>
            <Projector size={20} />
          </KioskToggle>
        )}
        <KioskToggle
          on={target === 'vardagsrum'}
          label={t(WORDS.vardagsrum.playOn)}
          offLabel={t('bion.toggleOff')}
          onClick={() => setTarget(target === 'vardagsrum' ? null : 'vardagsrum')}
        >
          <Sofa size={20} />
        </KioskToggle>
      </div>
      {showBar && (
        <div
          role="region"
          aria-label={t(words.remote)}
          className="fixed z-40 left-3 right-[4.5rem] bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:left-auto md:right-20 md:bottom-4 md:w-[26rem] rounded-2xl bg-surface-200/90 backdrop-blur-xl ring-1 ring-white/12 shadow-cinema overflow-hidden"
        >
          {tracksOpen && hasTracks && (
            <div className="max-h-[45vh] overflow-y-auto border-b border-white/10 bg-surface-200 px-2 py-2">
              {audio.length > 1 && (
                <TrackList
                  heading={t('player.audio')}
                  tracks={audio}
                  active={status?.audioActive}
                  onPick={(id) => void send({ type: 'audio', id })}
                />
              )}
              {subtitles.length > 0 && (
                <TrackList
                  heading={t('player.subtitles')}
                  tracks={[{ id: -1, name: t('player.subtitlesOff') }, ...subtitles]}
                  active={status?.subtitleActive ?? -1}
                  onPick={(id) => void send({ type: 'subtitle', id })}
                />
              )}
            </div>
          )}
          {/* Title on its own row and the buttons under it: four 44px buttons beside
              the title left it about 90px on a phone, and the time was cut off. */}
          <div className="flex items-center gap-2.5 px-3 py-2 min-h-14">
            <Icon size={18} className={`shrink-0 ${alive || active ? 'text-accent-400' : 'text-neutral-500'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-caption text-neutral-400 leading-tight truncate">
                {label}
                {seekable && position !== undefined && (
                  <span className="tabular-nums"> · {clock(position)}{duration ? ` / ${clock(duration)}` : ''}</span>
                )}
              </p>
              <p className="text-body text-white font-medium leading-tight truncate">
                {failed ? t(words.sendFailed) : title || t(words.readyHint)}
              </p>
            </div>
          </div>
          {seekable && duration > 0 && (
            // The browser's own range is drawn dark on dark in Safari, so it is drawn
            // here and the real input lies invisible on top: a 40px strip to grab.
            <div className="relative mx-4 -mt-2 h-10">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div className="h-full bg-accent-500" style={{ width: `${pct}%` }} />
              </div>
              <div
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-accent-500 transition-[width,height] ${drag === null ? 'w-3.5 h-3.5' : 'w-5 h-5'}`}
                style={{ left: `${pct}%` }}
                aria-hidden="true"
              />
              <input
                type="range"
                min={0}
                max={Math.round(duration)}
                step={1}
                value={Math.round(position ?? 0)}
                onChange={(e) => move(Number(e.target.value))}
                onPointerUp={letGo}
                onTouchEnd={letGo}
                onKeyUp={letGo}
                onBlur={letGo}
                aria-label={t('bion.scrub')}
                aria-valuetext={clock(position)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
          )}
          {(state === 'loading' || state === 'waiting' || live) && (
            <div className="flex items-center justify-center gap-3 px-2 pb-1.5 -mt-1">
              {seekable && (
                <button onClick={() => void send({ type: 'seek', by: -10 })} aria-label={t('bion.back')} className={button}>
                  <RotateCcw size={18} />
                </button>
              )}
              {(live || state === 'waiting') && (
                <button
                  onClick={() => void send({ type: state === 'playing' ? 'pause' : 'resume' })}
                  aria-label={state === 'playing' ? t('bion.pause') : state === 'waiting' ? t('bion.startNow') : t('bion.resume')}
                  className={button}
                >
                  {state === 'playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
              )}
              {seekable && (
                <button onClick={() => void send({ type: 'seek', by: 30 })} aria-label={t('bion.forward')} className={button}>
                  <RotateCw size={18} />
                </button>
              )}
              {hasTracks && (
                <button
                  onClick={() => setTracksOpen(!tracksOpen)}
                  aria-label={t('bion.tracks')}
                  aria-expanded={tracksOpen}
                  className={`${button} ${tracksOpen ? 'bg-white/15' : ''}`}
                >
                  <Captions size={19} />
                </button>
              )}
              <button onClick={() => void send({ type: 'stop' })} aria-label={t('bion.stop')} className={button}>
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          )}
          {/* The receiver's volume, through Home Assistant: one dB a tap, shown the way
              HA's own slider shows it. Only while the receiver is on. */}
          {volume !== null && (
            <div className="flex items-center justify-center gap-3 px-2 pb-1.5">
              <button
                onClick={() => void setVolume(volume - VOLUME_STEP)}
                disabled={volume <= 0}
                aria-label={t('bion.volumeDown')}
                className={`${button} disabled:opacity-40`}
              >
                <Minus size={18} />
              </button>
              <p className="w-24 flex items-center justify-center gap-1.5 text-body text-white tabular-nums" aria-live="polite">
                <Volume2 size={16} className="text-neutral-400" aria-hidden="true" />
                {receiver?.muted ? t('bion.muted') : `${Math.round(volume * 100)} %`}
              </p>
              <button
                onClick={() => void setVolume(volume + VOLUME_STEP)}
                disabled={volume >= 0.8}
                aria-label={t('bion.volumeUp')}
                className={`${button} disabled:opacity-40`}
              >
                <Plus size={18} />
              </button>
            </div>
          )}
          {active && !(seekable && duration > 0) && (
            <div className="h-0.5 bg-white/10">
              <div className="h-full bg-accent-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

function KioskToggle({ on, label, offLabel, onClick, children }: {
  on: boolean
  label: string
  offLabel: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? offLabel : label}
      title={on ? offLabel : label}
      className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-xl ring-1 shadow-cinema active:scale-95 transition-all ${
        on ? 'bg-accent-600 ring-accent-400/60 text-white' : 'bg-surface-200/80 ring-white/12 text-neutral-300'
      }`}
    >
      {children}
    </button>
  )
}

function TrackList({ heading, tracks, active, onPick }: {
  heading: string
  tracks: BionTrack[]
  active: number | undefined
  onPick: (id: number) => void
}) {
  return (
    <div className="py-1">
      <p className="px-2 pb-1 text-caption uppercase tracking-wider text-neutral-500">{heading}</p>
      {tracks.map((track) => (
        <button
          key={track.id}
          onClick={() => onPick(track.id)}
          aria-pressed={track.id === active}
          className="w-full min-h-11 flex items-center gap-3 px-2 rounded-xl text-left text-body text-white hover:bg-white/10 active:bg-white/15"
        >
          <span className="w-5 shrink-0 text-accent-400">{track.id === active && <Check size={18} />}</span>
          <span className="truncate">{track.name}</span>
        </button>
      ))}
    </div>
  )
}
