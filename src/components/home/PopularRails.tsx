import { useNavigate } from 'react-router-dom'
import { MovieCard } from '@/components/movies/MovieCard'
import { ScrollableRow, SectionHeader } from '@/components/ui/MediaRow'
import { listItemMeta, useCatalogMovies, useCatalogShows } from '@/hooks/useCatalogList'
import { fetchTrending } from '@/services/tmdb'
import { useLocale, useT } from '@/lib/i18n'
import type { Channel, TmdbMeta } from '@/types'

/** A rail with fewer than this would look broken rather than curated: show none. */
const MIN_TITLES = 4

/**
 * "Popular right now": TMDB's trending films and shows of the week that exist in
 * this catalogue, in TMDB's order. Suggested in the feedback box ("show big titles
 * for both films and series, it must be fetchable from somewhere").
 */
export function PopularRails({ onMovie }: { onMovie: (channel: Channel, meta: TmdbMeta) => void }) {
  const t = useT()
  const locale = useLocale()
  const navigate = useNavigate()
  const movies = useCatalogMovies(() => fetchTrending('movie', locale), `trending-movie@${locale}`)
  const shows = useCatalogShows(() => fetchTrending('tv', locale), `trending-tv@${locale}`)

  return (
    <>
      {movies.matches.length >= MIN_TITLES && (
        <section>
          <SectionHeader title={t('home.popularMovies')} />
          <ScrollableRow>
            {movies.matches.map(({ channel, item }) => {
              const meta = listItemMeta(item, channel.id, 'movie')
              return (
                <div key={channel.id} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                  <MovieCard channel={channel} tmdbMeta={meta} onClick={() => onMovie(channel, meta)} />
                </div>
              )
            })}
          </ScrollableRow>
        </section>
      )}
      {shows.matches.length >= MIN_TITLES && (
        <section>
          <SectionHeader title={t('home.popularShows')} />
          <ScrollableRow>
            {shows.matches.map(({ channel, showKey, item }) => (
              <div key={showKey} className="flex-shrink-0 w-40 sm:w-44 lg:w-48 snap-start">
                <MovieCard
                  channel={channel}
                  tmdbMeta={listItemMeta(item, showKey, 'tv')}
                  onClick={() => navigate(`/series?show=${encodeURIComponent(showKey)}`)}
                />
              </div>
            ))}
          </ScrollableRow>
        </section>
      )}
    </>
  )
}
