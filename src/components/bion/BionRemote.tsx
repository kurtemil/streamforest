import { useEffect, useReducer } from 'react'
import { Pause, Play, RotateCcw, RotateCw, Square, Tv } from 'lucide-react'
import { bionVisible, useBionStore } from '@/stores/bionStore'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { progressPercent } from '@/lib/progress'
import { useT } from '@/lib/i18n'

/** Often while something is on, so pause and seek show up quickly; rarely otherwise. */
const ACTIVE_POLL_MS = 2_500
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
 * The phone's remote for Bion, the kiosk in the basement. It floats above the tab
 * bar while a film is on there, and is gone otherwise. Polling only happens where
 * Bion can be reached at all: when the home library answers.
 */
export function BionRemote() {
  const t = useT()
  const homeReady = useHomeLibraryStore((s) => s.status === 'ready')
  const { status, pending, clockSkew, failed, poll, send } = useBionStore()
  const visible = bionVisible({ status, pending, clockSkew })
  // Re-render on a timer too, so a status that goes stale takes the remote away.
  const [, tick] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!homeReady) return
    let alive = true
    let timer = 0
    const loop = async () => {
      if (document.visibilityState === 'visible') await useBionStore.getState().poll()
      if (!alive) return
      tick()
      timer = window.setTimeout(loop, bionVisible(useBionStore.getState()) ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }
    void loop()
    const onVisible = () => { if (document.visibilityState === 'visible') void poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [homeReady, poll])

  if (!homeReady || !visible) return null

  const state = pending ? 'loading' : status?.state ?? 'loading'
  const title = pending?.title ?? status?.title ?? ''
  const label = state === 'failed' ? 'Bion'
    : state === 'paused' ? t('bion.paused')
    : state === 'playing' ? t('bion.playing')
    : t('bion.starting')
  const pct = status && !pending ? progressPercent(status.position ?? 0, status.duration ?? 0) : 0
  const live = state === 'playing' || state === 'paused'
  const button = 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-95 transition-transform disabled:opacity-40'

  return (
    <div
      role="region"
      aria-label={t('bion.remote')}
      className="fixed z-40 left-3 right-[4.5rem] bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:left-auto md:right-4 md:bottom-4 md:w-[26rem] rounded-2xl bg-surface-200/90 backdrop-blur-xl ring-1 ring-white/12 shadow-cinema overflow-hidden"
    >
      <div className="flex items-center gap-2 pl-3 pr-1 py-1.5">
        <Tv size={18} className="text-accent-400 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0 py-1">
          <p className="text-caption text-neutral-400 leading-tight truncate">
            {label}
            {live && status?.position !== undefined && (
              <span className="tabular-nums"> · {clock(status.position)}{status.duration ? ` / ${clock(status.duration)}` : ''}</span>
            )}
          </p>
          <p className="text-body text-white font-medium leading-tight truncate">
            {failed ? t('bion.sendFailed') : title}
          </p>
        </div>
        {live && (
          <>
            <button onClick={() => void send({ type: 'seek', by: -10 })} aria-label={t('bion.back')} className={button}>
              <RotateCcw size={18} />
            </button>
            <button
              onClick={() => void send({ type: state === 'paused' ? 'resume' : 'pause' })}
              aria-label={state === 'paused' ? t('bion.resume') : t('bion.pause')}
              className={button}
            >
              {state === 'paused' ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
            </button>
            <button onClick={() => void send({ type: 'seek', by: 30 })} aria-label={t('bion.forward')} className={button}>
              <RotateCw size={18} />
            </button>
          </>
        )}
        {state !== 'failed' && (
          <button onClick={() => void send({ type: 'stop' })} aria-label={t('bion.stop')} className={button}>
            <Square size={16} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="h-0.5 bg-white/10">
        <div className="h-full bg-accent-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
