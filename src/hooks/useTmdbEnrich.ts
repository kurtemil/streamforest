import { useEffect, useRef, useState } from 'react'
import type { Channel, TmdbMeta } from '@/types'
import { getTmdbMetaBulk } from '@/services/db'
import { enrichMovie, enrichTV, tmdbCacheKey } from '@/services/tmdb'
import { normalizeShowKey } from '@/lib/utils'
import { useLocale } from '@/lib/i18n'

const CONCURRENCY = 3        // max parallel TMDB requests
const RATE_DELAY  = 250      // ms between batches (well under 50 req/s limit)

type MetaMap = Map<string, TmdbMeta>

/**
 * Given a list of channels, returns a live map of TMDB metadata keyed by:
 *   - channel.id      for movies
 *   - normalizeShowKey(showName) for series
 *
 * Loads cached entries from IndexedDB immediately, then fetches uncached ones
 * in the background with bounded concurrency.
 *
 * The returned map is stable (same reference while loading; new reference when
 * new entries arrive) so React re-renders are minimal.
 *
 * Its keys stay the channel id and the show key regardless of language — what
 * the language changes is which *row* those keys read, which is what
 * `tmdbCacheKey` decides. Callers never see the difference.
 */
export function useTmdbEnrich(channels: Channel[]): MetaMap {
  const locale = useLocale()
  const [metaMap, setMetaMap] = useState<MetaMap>(new Map())
  const inFlight = useRef(new Set<string>())
  const queue    = useRef<Array<{ id: string; fn: () => Promise<TmdbMeta | null> }>>([])
  const running  = useRef(0)
  const mounted  = useRef(true)
  // Which language the results still arriving belong to. A request started
  // before a switch resolves after it, and its answer is in the old language.
  const localeRef = useRef(locale)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // Switching language makes every entry already in the map the wrong language.
  // Dropping it — and the in-flight set with it — is what lets the same ids be
  // fetched again against the new catalog; without the reset they would all read
  // as already handled and the screen would stay in the language it opened in.
  useEffect(() => {
    localeRef.current = locale
    setMetaMap(new Map())
    inFlight.current.clear()
    queue.current.length = 0
  }, [locale])

  useEffect(() => {
    if (!channels.length) return

    // Deduplicate: one entry per unique cache key
    const seen = new Map<string, Channel>()
    for (const ch of channels) {
      if (ch.type === 'movie') {
        if (!seen.has(ch.id)) seen.set(ch.id, ch)
      } else if (ch.type === 'series' && ch.showName) {
        const key = normalizeShowKey(ch.showName)
        if (!seen.has(key)) seen.set(key, ch)
      }
    }
    const ids = Array.from(seen.keys())
    const storageIds = ids.map((id) => tmdbCacheKey(id, locale))

    const run = async () => {
      // 1. Load all cached entries instantly, translating the language-specific
      //    row keys back to the ids the caller asked about.
      const rows = await getTmdbMetaBulk(storageIds)
      if (!mounted.current) return
      const cached = new Map<string, TmdbMeta>()
      ids.forEach((id, i) => {
        const row = rows.get(storageIds[i])
        if (row) cached.set(id, row)
      })

      // Only expose found entries to the UI — notFound entries suppress the
      // re-queue (cached.has(id) is true) but don't pollute the map.
      const found = new Map([...cached].filter(([, v]) => !v.notFound))
      if (found.size > 0) {
        setMetaMap((prev) => {
          const next = new Map(prev)
          found.forEach((v, k) => next.set(k, v))
          return next
        })
      }

      // 2. Queue uncached ids for background fetch
      const uncached = ids.filter((id) => !cached.has(id) && !inFlight.current.has(id))
      for (const id of uncached) {
        const ch = seen.get(id)!
        inFlight.current.add(id)
        if (ch.type === 'movie') {
          queue.current.push({
            id,
            fn: () => enrichMovie(id, ch.movieTitle ?? ch.name, ch.year ?? null, locale),
          })
        } else {
          queue.current.push({
            id,
            fn: () => enrichTV(id, ch.showName!, locale),
          })
        }
      }

      drain()
    }

    run()
  // Only re-run when the list of channel ids changes, not on every render —
  // and when the language changes, since that is a different set of rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.map((c) => (c.type === 'series' && c.showName ? normalizeShowKey(c.showName) : c.id)).join(','), locale])

  function drain() {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const item = queue.current.shift()!
      running.current++

      const startedIn = localeRef.current
      item.fn().then((result) => {
        running.current--
        if (!mounted.current) return
        // Answer from before a language switch — the map has already been
        // cleared for the new one, and putting this back would un-clear it.
        if (startedIn !== localeRef.current) return

        if (result) {
          setMetaMap((prev) => {
            const next = new Map(prev)
            next.set(item.id, result)
            return next
          })
        }

        // Brief delay before draining next batch to respect rate limits
        setTimeout(drain, RATE_DELAY)
      })
    }
  }

  return metaMap
}
