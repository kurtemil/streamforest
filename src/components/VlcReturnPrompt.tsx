import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { db } from '@/services/db'
import { pushProgress, syncFromRemote } from '@/services/sync'
import { markWatched } from '@/services/watched'
import { setPosition } from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { useProfileStore } from '@/stores/profileStore'
import { clearHandoff, estimatePosition, MAX_AWAY_MS, MIN_AWAY_MS, pendingHandoff, type Handoff } from '@/lib/vlcHandoff'
import { isCompleted } from '@/lib/progress'
import { formatTime } from '@/lib/time'
import { useT } from '@/lib/i18n'

/**
 * "How far did you get in VLC?" when the app comes back to the front after a
 * title was handed to VLC and nothing reported a position meanwhile (an iPhone,
 * or a computer without the reporting handler). The slider starts at what the
 * time away suggests; nothing is saved until the viewer says so.
 */
export function VlcReturnPrompt() {
  const t = useT()
  const activeProfileId = useProfileStore((s) => s.activeProfileId)
  const [handoff, setHandoff] = useState<Handoff | null>(null)
  const [position, setPos] = useState(0)

  const check = useCallback(async () => {
    const h = pendingHandoff()
    if (!h || h.profileId !== activeProfileId) return
    const away = Date.now() - h.at
    if (away < MIN_AWAY_MS) return
    if (away > MAX_AWAY_MS) { clearHandoff(); return }
    // Did something report while VLC played? Then that is the answer already.
    if (h.kind === 'sf') {
      await syncFromRemote(h.profileId)
      const row = await db.watchProgress.get(`${h.profileId}:${h.id}`)
      if (row && row.lastWatched > h.at) { clearHandoff(); return }
    } else {
      await useHomeLibraryStore.getState().reload()
      const item = useHomeLibraryStore.getState().items.find((i) => i.id === h.id)
      if (item && item.lastPlayedAt > h.at) { clearHandoff(); return }
    }
    setPos(estimatePosition(h, Date.now()))
    setHandoff(h)
  }, [activeProfileId])

  useEffect(() => {
    void check()
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [check])

  if (!handoff) return null
  const max = handoff.durationSec ?? Math.max(position + 1800, handoff.start + 3600)

  const done = () => { clearHandoff(); setHandoff(null) }

  const save = async (finished: boolean) => {
    const h = handoff
    done()
    if (h.kind === 'jf') {
      const store = useHomeLibraryStore.getState()
      const item = store.items.find((i) => i.id === h.id)
      if (!item) return
      if (finished) await store.markPlayed(item, true)
      else if (store.session) { await setPosition(store.session, item, position); await store.reload() }
      return
    }
    const duration = h.durationSec ?? 0
    if (finished || (duration > 0 && isCompleted(position, duration))) {
      await markWatched(h.profileId, [h.id], true)
      return
    }
    const entry = {
      id: `${h.profileId}:${h.id}`, profileId: h.profileId, channelId: h.id,
      position, duration, lastWatched: Date.now(), completed: false,
    }
    await db.watchProgress.put(entry)
    pushProgress(entry)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-4 pb-safe" role="dialog" aria-modal="true" aria-label={t('vlcReturn.title')}>
      <div className="w-full max-w-md rounded-2xl bg-surface-200 ring-1 ring-white/10 shadow-cinema p-5">
        <p className="text-caption text-neutral-400">{t('vlcReturn.title')}</p>
        <h2 className="text-heading-md text-white font-semibold mt-0.5 mb-4 line-clamp-2">{handoff.title}</h2>
        <label className="block text-body text-neutral-300 mb-2" htmlFor="vlc-return-pos">
          {t('vlcReturn.question')}
        </label>
        <input
          id="vlc-return-pos"
          type="range"
          min={0}
          max={Math.round(max)}
          step={30}
          value={Math.min(position, max)}
          onChange={(e) => setPos(Number(e.target.value))}
          className="w-full accent-accent-500 h-11"
        />
        <p className="text-center text-heading-md text-white tabular-nums mb-4">
          {formatTime(position)}
          {handoff.durationSec ? <span className="text-neutral-500 text-body"> / {formatTime(handoff.durationSec)}</span> : null}
        </p>
        <div className="flex flex-col gap-2">
          <button onClick={() => void save(false)} className="min-h-11 rounded-lg bg-white text-black font-semibold">
            {t('vlcReturn.save', { time: formatTime(position) })}
          </button>
          <button onClick={() => void save(true)} className="min-h-11 rounded-lg bg-white/8 ring-1 ring-white/15 text-neutral-200 flex items-center justify-center gap-2">
            <Check size={15} /> {t('vlcReturn.finished')}
          </button>
          <button onClick={done} className="min-h-11 rounded-lg text-neutral-400 hover:text-white">
            {t('vlcReturn.skip')}
          </button>
        </div>
        <p className="text-micro text-neutral-600 mt-3">{t('vlcReturn.why')}</p>
      </div>
    </div>
  )
}
