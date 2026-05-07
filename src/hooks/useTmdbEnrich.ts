import { useEffect, useRef, useState } from 'react'
import type { Channel, TmdbMeta } from '@/types'
import { getTmdbMetaBulk } from '@/services/db'
import { enrichMovie, enrichTV } from '@/services/tmdb'
import { normalizeShowKey } from '@/lib/utils'

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
 */
export function useTmdbEnrich(channels: Channel[]): MetaMap {
  const [metaMap, setMetaMap] = useState<MetaMap>(new Map())
  const inFlight = useRef(new Set<string>())
  const queue    = useRef<Array<{ id: string; fn: () => Promise<TmdbMeta | null> }>>([])
  const running  = useRef(0)
  const mounted  = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

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

    const run = async () => {
      // 1. Load all cached entries instantly
      const cached = await getTmdbMetaBulk(ids)
      if (!mounted.current) return

      if (cached.size > 0) {
        setMetaMap((prev) => {
          const next = new Map(prev)
          cached.forEach((v, k) => next.set(k, v))
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
            fn: () => enrichMovie(id, ch.movieTitle ?? ch.name, ch.year ?? null),
          })
        } else {
          queue.current.push({
            id,
            fn: () => enrichTV(id, ch.showName!),
          })
        }
      }

      drain()
    }

    run()
  // Only re-run when the list of channel ids changes, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.map((c) => (c.type === 'series' && c.showName ? normalizeShowKey(c.showName) : c.id)).join(',')])

  function drain() {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const item = queue.current.shift()!
      running.current++

      item.fn().then((result) => {
        running.current--
        if (!mounted.current) return

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
