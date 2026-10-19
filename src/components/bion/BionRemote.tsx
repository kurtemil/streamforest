import { useEffect, useReducer } from 'react'
import { Pause, Play, RotateCcw, RotateCw, Square, Tv } from 'lucide-react'
import { bionAlive, bionVisible, useBionStore } from '@/stores/bionStore'
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

/**
 * Bion, the kiosk in the basement, from the phone: the button that turns Bion mode
 * on and off (every Play then goes there), and the remote that floats above the tab
 * bar while the mode is on or something is playing there. The button shows only
 * while the kiosk has been heard from, or the mode is already on.
 */
export function BionRemote() {
  const t = useT()
  const { mode, status, pending, clockSkew, failed, setMode, poll, send } = useBionStore()
  const active = bionVisible({ status, pending, clockSkew })
  const alive = bionAlive({ status, clockSkew })
  // Re-render on a timer too, so a status that goes stale takes the remote away.
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    let alive = true
    let timer = 0
    const loop = async () => {
      if (document.visibilityState === 'visible') await useBionStore.getState().poll()
      if (!alive) return
      tick()
      const s = useBionStore.getState()
      timer = window.setTimeout(loop, bionVisible(s) ? ACTIVE_POLL_MS : s.mode ? MODE_POLL_MS : IDLE_POLL_MS)
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

  const showToggle = mode || alive || active
  const showBar = active || mode

  const state = pending ? 'loading' : active ? status?.state ?? 'loading' : 'idle'
  const title = pending?.title ?? (active ? status?.title : undefined) ?? ''
  const label = state === 'failed' ? 'Bion'
    : state === 'paused' ? t('bion.paused')
    : state === 'playing' ? t('bion.playing')
    : state === 'loading' ? t('bion.starting')
    : alive ? `Bion · ${t('bion.ready')}` : t('bion.offline')
  const pct = status && active && !pending ? progressPercent(status.position ?? 0, status.duration ?? 0) : 0
  const live = state === 'playing' || state === 'paused'
  const seekable = live && !status?.live
  const button = 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-transform'

  return (
    <>
      {showToggle && (
        <button
          onClick={() => setMode(!mode)}
          aria-pressed={mode}
          aria-label={mode ? t('bion.toggleOff') : t('bion.playOn')}
          title={mode ? t('bion.toggleOff') : t('bion.playOn')}
          className={`fixed z-40 right-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom,0px))] md:right-4 md:bottom-4 w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-xl ring-1 shadow-cinema active:scale-95 transition-all ${
            mode ? 'bg-accent-600 ring-accent-400/60 text-white' : 'bg-surface-200/80 ring-white/12 text-neutral-300'
          }`}
        >
          <Tv size={20} />
        </button>
      )}
      {showBar && (
        <div
          role="region"
          aria-label={t('bion.remote')}
          className="fixed z-40 left-3 right-[4.5rem] bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:left-auto md:right-20 md:bottom-4 md:w-[26rem] rounded-2xl bg-surface-200/90 backdrop-blur-xl ring-1 ring-white/12 shadow-cinema overflow-hidden"
        >
          {/* Title on its own row and the buttons under it: four 44px buttons beside
              the title left it about 90px on a phone, and the time was cut off. */}
          <div className="flex items-center gap-2.5 px-3 py-2 min-h-14">
            <Tv size={18} className={`shrink-0 ${alive || active ? 'text-accent-400' : 'text-neutral-500'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-caption text-neutral-400 leading-tight truncate">
                {label}
                {seekable && status?.position !== undefined && (
                  <span className="tabular-nums"> · {clock(status.position)}{status.duration ? ` / ${clock(status.duration)}` : ''}</span>
                )}
              </p>
              <p className="text-body text-white font-medium leading-tight truncate">
                {failed ? t('bion.sendFailed') : title || t('bion.readyHint')}
              </p>
            </div>
          </div>
          {(state === 'loading' || live) && (
            <div className="flex items-center justify-center gap-3 px-2 pb-1.5 -mt-1">
              {seekable && (
                <button onClick={() => void send({ type: 'seek', by: -10 })} aria-label={t('bion.back')} className={button}>
                  <RotateCcw size={18} />
                </button>
              )}
              {live && (
                <button
                  onClick={() => void send({ type: state === 'paused' ? 'resume' : 'pause' })}
                  aria-label={state === 'paused' ? t('bion.resume') : t('bion.pause')}
                  className={button}
                >
                  {state === 'paused' ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                </button>
              )}
              {seekable && (
                <button onClick={() => void send({ type: 'seek', by: 30 })} aria-label={t('bion.forward')} className={button}>
                  <RotateCw size={18} />
                </button>
              )}
              <button onClick={() => void send({ type: 'stop' })} aria-label={t('bion.stop')} className={button}>
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          )}
          {active && (
            <div className="h-0.5 bg-white/10">
              <div className="h-full bg-accent-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
