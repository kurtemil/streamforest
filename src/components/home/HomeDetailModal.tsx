import { useEffect, useState } from 'react'
import { Play, Check, RotateCcw } from 'lucide-react'
import { backdropUrl, getDetails, posterUrl, type HomeDetails } from '@/services/jellyfin'
import { useHomeLibraryStore } from '@/stores/homeLibraryStore'
import { resumePoint } from '@/lib/progress'
import { formatRuntime, useLocale, useT } from '@/lib/i18n'
import { DetailSheet, sheetButton } from '@/components/ui/DetailSheet'

/** People change less often than this sheet is opened; one read per film per visit. */
const detailsCache = new Map<string, HomeDetails>()

/**
 * The detail sheet for a film on the home server. A tap on a Hemma card opens
 * this instead of the player (feedback box, 2026-10-15), as every other card in
 * the app does. Everything comes from Jellyfin: what the list already carries is
 * shown at once, and the people arrive a moment later.
 */
export function HomeDetailModal() {
  const t = useT()
  const locale = useLocale()
  const { detail: item, session, closeDetail, play, markPlayed } = useHomeLibraryStore()
  const [details, setDetails] = useState<HomeDetails | null>(null)

  useEffect(() => {
    if (!item || !session) return
    const cached = detailsCache.get(item.id)
    setDetails(cached ?? null)
    if (cached) return
    let alive = true
    getDetails(session, item.id)
      .then((d) => { detailsCache.set(item.id, d); if (alive) setDetails(d) })
      .catch(() => { /* the sheet is whole without the cast */ })
    return () => { alive = false }
  }, [item?.id, session]) // eslint-disable-line react-hooks/exhaustive-deps

  const resume = item ? resumePoint(item.positionSec, item.durationSec, item.played) : null
  const minutes = item && item.durationSec > 0 ? Math.round(item.durationSec / 60) : 0

  return (
    <DetailSheet
      open={item !== null}
      onClose={closeDetail}
      title={item?.name ?? ''}
      backdrop={item ? backdropUrl(item) : null}
      poster={item ? posterUrl(item, 342) : null}
      year={item?.year ?? null}
      runtime={minutes > 0 ? formatRuntime(minutes, locale) : null}
      rating={item?.rating ?? null}
      chips={item ? [t('homeDetail.source'), ...(item.ageRating ? [item.ageRating] : []), ...item.genres.slice(0, 3)] : []}
      progress={resume && {
        pct: resume.pct,
        label: resume.minutesLeft !== null
          ? t('modal.timeLeft', { time: formatRuntime(resume.minutesLeft, locale) })
          : t('card.watched', { time: formatRuntime(Math.round(resume.position / 60), locale) }),
      }}
      overview={item?.overview}
      director={details?.director}
      cast={details?.cast}
      actions={item && (
        <>
          <button onClick={() => play(item)} className={sheetButton('primary')}>
            <Play size={16} fill="black" />
            {resume ? t('modal.resume') : t('common.play')}
          </button>
          {resume && (
            <button onClick={() => play(item, { fromStart: true })} className={sheetButton('secondary')}>
              <RotateCcw size={15} />
              {t('modal.startOver')}
            </button>
          )}
          <button
            onClick={() => void markPlayed(item, !item.played)}
            aria-pressed={item.played}
            className={sheetButton(item.played ? 'active' : 'secondary')}
          >
            <Check size={15} />
            {item.played ? t('common.markUnwatched') : t('common.markWatched')}
          </button>
        </>
      )}
    />
  )
}
