import { useNavigate } from 'react-router-dom'
import { MovieCard } from '@/components/movies/MovieCard'
import { HomeCard } from '@/components/home/HomeCard'
import { ScrollableRow } from '@/components/ui/MediaRow'
import { listItemMeta, useRelatedMovies, useRelatedShows } from '@/hooks/useCatalogList'
import type { HomeItem } from '@/services/jellyfin'
import { useT } from '@/lib/i18n'
import type { Channel, TmdbMeta } from '@/types'

/**
 * Fewer than this reads as a broken row rather than a suggestion, so none is shown.
 * Same floor as Popular right now.
 */
export const MIN_RELATED = 4

function Heading() {
  const t = useT()
  return <h3 className="text-caption font-medium text-neutral-400 uppercase tracking-wider mb-3">{t('detail.related')}</h3>
}

const CELL = 'flex-shrink-0 w-28 sm:w-32 snap-start'

/**
 * "More like this" in a film's sheet (feedback box, 2026-10-15). TMDB's
 * recommendations for the film, kept to what this profile can play here, in
 * TMDB's order. A film TMDB cannot place, or whose suggestions are not in the
 * catalogue, gets no row rather than a row of whatever was nearby.
 */
export function RelatedMovies({ tmdbId, excludeId, onOpen }: {
  tmdbId: number | null
  excludeId?: string
  onOpen: (channel: Channel, meta: TmdbMeta) => void
}) {
  const { matches } = useRelatedMovies(tmdbId)
  const list = matches.filter((m) => m.channel.id !== excludeId).slice(0, 20)
  if (list.length < MIN_RELATED) return null
  return (
    <section className="mb-6">
      <Heading />
      <ScrollableRow>
        {list.map(({ channel, item }) => {
          const meta = listItemMeta(item, channel.id, 'movie')
          return (
            <div key={channel.id} className={CELL}>
              <MovieCard channel={channel} tmdbMeta={meta} onClick={() => onOpen(channel, meta)} />
            </div>
          )
        })}
      </ScrollableRow>
    </section>
  )
}

/** The same for a show, under its overview. A tap opens that show's overview. */
export function RelatedShows({ tmdbId, excludeKey }: { tmdbId: number | null; excludeKey: string }) {
  const navigate = useNavigate()
  const { matches } = useRelatedShows(tmdbId)
  const list = matches.filter((m) => m.showKey !== excludeKey).slice(0, 20)
  if (list.length < MIN_RELATED) return null
  return (
    <section className="mt-10">
      <Heading />
      <ScrollableRow>
        {list.map(({ channel, showKey, item }) => (
          <div key={showKey} className={CELL}>
            <MovieCard
              channel={channel}
              tmdbMeta={listItemMeta(item, showKey, 'tv')}
              onClick={() => navigate(`/series?show=${encodeURIComponent(showKey)}`)}
            />
          </div>
        ))}
      </ScrollableRow>
    </section>
  )
}

/** Jellyfin's own "similar" for a home film: the library is small, but all of it plays. */
export function RelatedHome({ items, onOpen }: { items: HomeItem[]; onOpen: (item: HomeItem) => void }) {
  if (items.length < MIN_RELATED) return null
  return (
    <section className="mb-6">
      <Heading />
      <ScrollableRow>
        {items.map((item) => (
          <div key={item.id} className={CELL}>
            <HomeCard item={item} onClick={() => onOpen(item)} />
          </div>
        ))}
      </ScrollableRow>
    </section>
  )
}
