import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Bookmark, Check, RotateCcw } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, addToWatchLater, removeFromWatchLater, clearProgress } from '@/services/db'
import { pushWatchLater, deleteRemoteWatchLater, deleteRemoteProgress } from '@/services/sync'
import { markWatched } from '@/services/watched'
import { useProfileStore } from '@/stores/profileStore'
import { usePlayerStore } from '@/stores/playerStore'
import { useDetailStore } from '@/stores/detailStore'
import { useTmdbEnrich } from '@/hooks/useTmdbEnrich'
import { backdropUrl, posterUrl, profileUrl } from '@/services/tmdb'
import { normalizeShowKey } from '@/lib/utils'
import { resumePoint } from '@/lib/progress'
import { openInVlc } from '@/lib/vlc'
import { formatRuntime, useLocale, useT } from '@/lib/i18n'
import { DetailSheet, sheetButton } from '@/components/ui/DetailSheet'
import { RelatedMovies } from '@/components/home/RelatedRails'
import type { Channel } from '@/types'

const NONE: Channel[] = []

/**
 * The detail sheet for a film from the provider. Mounted once (App.tsx) and opened
 * through `useDetailStore` from anywhere, so a film is never one tap from playing
 * without first being shown. The sheet owns what it offers: watch later, watched,
 * and continue or start over, read from the profile's own rows.
 */
export function MovieDetailModal() {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const { channel, tmdbMeta: given, close, openMovie } = useDetailStore()
  const play = usePlayerStore((s) => s.play)
  const activeProfileId = useProfileStore((s) => s.activeProfileId)

  // Search and the library open the sheet with only the channel. The lookup comes
  // from the cache when the title has been seen before, and from TMDB otherwise.
  const lookup = useTmdbEnrich(useMemo(() => (channel && !given ? [channel] : NONE), [channel, given]))
  const tmdbMeta = given ?? (channel ? lookup.get(channel.id) ?? null : null)

  const progress = useLiveQuery(
    () => (channel && activeProfileId ? db.watchProgress.get(`${activeProfileId}:${channel.id}`) : undefined),
    [channel?.id, activeProfileId],
  )
  const watched = Boolean(progress?.completed)
  const resume = progress ? resumePoint(progress.position, progress.duration, progress.completed) : null

  const watchLaterId = channel
    ? channel.type === 'series' && channel.showName ? normalizeShowKey(channel.showName) : channel.id
    : null
  const isWatchLater = useLiveQuery(
    async () => (activeProfileId && watchLaterId
      ? (await db.watchLater.get(`${activeProfileId}:${watchLaterId}`)) !== undefined
      : false),
    [activeProfileId, watchLaterId],
  ) ?? false

  const start = useCallback(async (fromStart: boolean) => {
    if (!channel) return
    // The player resumes from the saved row, so starting over means not having one.
    if (fromStart && activeProfileId) {
      await clearProgress(activeProfileId, channel.id)
      deleteRemoteProgress(activeProfileId, channel.id)
    }
    if (channel.type === 'movie') navigate(`/movies?playing=${channel.id}`)
    else navigate(`/series?show=${encodeURIComponent(normalizeShowKey(channel.showName ?? channel.name))}`)
    play(channel)
    close()
  }, [channel, activeProfileId, navigate, play, close])

  const toggleWatchLater = () => {
    if (!channel || !activeProfileId || !watchLaterId) return
    if (isWatchLater) {
      removeFromWatchLater(activeProfileId, watchLaterId)
      deleteRemoteWatchLater(activeProfileId, watchLaterId)
    } else {
      addToWatchLater(activeProfileId, watchLaterId, channel.type === 'series' ? 'series' : 'movie').then(pushWatchLater)
    }
  }

  const title = tmdbMeta?.title ?? channel?.movieTitle ?? channel?.showName ?? channel?.name ?? ''

  return (
    <DetailSheet
      open={channel !== null}
      onClose={close}
      title={title}
      backdrop={backdropUrl(tmdbMeta?.backdropPath ?? null, 1280)}
      poster={posterUrl(tmdbMeta?.posterPath ?? null, 342)}
      fallbackPoster={channel?.logo ?? ''}
      year={tmdbMeta?.year ?? channel?.year ?? null}
      runtime={tmdbMeta?.runtime ? formatRuntime(tmdbMeta.runtime, locale) : null}
      rating={tmdbMeta?.rating ?? null}
      chips={tmdbMeta?.genres?.slice(0, 3)}
      progress={resume && {
        pct: resume.pct,
        label: resume.minutesLeft !== null
          ? t('modal.timeLeft', { time: formatRuntime(resume.minutesLeft, locale) })
          : t('card.watched', { time: formatRuntime(Math.round(resume.position / 60), locale) }),
      }}
      overview={tmdbMeta?.overview}
      director={tmdbMeta?.director}
      cast={tmdbMeta?.cast?.map((m) => ({ name: m.name, character: m.character, image: profileUrl(m.profilePath, 92) }))}
      after={channel?.type === 'movie' && (
        <RelatedMovies tmdbId={tmdbMeta?.tmdbId || null} excludeId={channel.id} onOpen={openMovie} />
      )}
      actions={
        <>
          <button onClick={() => void start(false)} className={sheetButton('primary')}>
            <Play size={16} fill="black" />
            {resume ? t('modal.resume') : t('common.play')}
          </button>
          {resume && (
            <button onClick={() => void start(true)} className={sheetButton('secondary')}>
              <RotateCcw size={15} />
              {t('modal.startOver')}
            </button>
          )}
          <button onClick={toggleWatchLater} className={sheetButton(isWatchLater ? 'active' : 'secondary')}>
            <Bookmark size={15} fill={isWatchLater ? 'currentColor' : 'none'} />
            {isWatchLater ? t('common.saved') : t('common.watchLater')}
          </button>
          {channel?.type === 'movie' && activeProfileId && (
            <button
              onClick={() => void markWatched(activeProfileId, [channel.id], !watched)}
              aria-pressed={watched}
              className={sheetButton(watched ? 'active' : 'secondary')}
            >
              <Check size={15} />
              {watched ? t('common.markUnwatched') : t('common.markWatched')}
            </button>
          )}
          {channel && (
            <button
              onClick={() => openInVlc(channel, { durationSec: progress?.duration || (tmdbMeta?.runtime ? tmdbMeta.runtime * 60 : null) })}
              title={t('common.openInVlc')}
              className={sheetButton('secondary')}
            >
              <span className="w-2.5 h-2.5 rounded-sm bg-[#ff8800]" />
              VLC
            </button>
          )}
        </>
      }
    />
  )
}
