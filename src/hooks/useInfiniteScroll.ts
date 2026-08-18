import { useState, useEffect, useCallback } from 'react'

/**
 * Grows a rendered slice as its sentinel scrolls into view.
 *
 * `total` is the length of the full list, and it is not decoration: without it
 * the observer is rebuilt on every `count` change, and once the whole list is
 * rendered the still-visible sentinel keeps firing into a growth that can no
 * longer render anything — a render loop with nothing to show for it.
 */
export function useInfiniteScroll(total: number, pageSize = 60) {
  const [count, setCount] = useState(pageSize)

  // A callback ref rather than useRef, and this is the bug that stranded every
  // filtered list at its first 60 titles. The sentinel lives inside the grid
  // branch, which Movies and Series only render once there is a search or a
  // group — so on mount it does not exist. The effect read `null`, returned, and
  // had no dependency that could ever change to tell it the node had arrived:
  // `count` cannot advance without the observer that was never attached. Holding
  // the node in state makes its appearance the thing that runs the effect.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const sentinelRef = useCallback((el: HTMLDivElement | null) => setSentinel(el), [])

  const reset = useCallback(() => setCount(pageSize), [pageSize])

  const hasMore = count < total

  useEffect(() => {
    if (!sentinel || !hasMore) return
    // The app shell scrolls <main>, not the document, so intersection has to be
    // measured against that box. Resolved from the sentinel rather than looked up
    // globally: a root that does not contain the target reports no intersection
    // at all, so a wrong root fails the same silent way a missing one does.
    const root = sentinel.closest('main')
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setCount((c) => c + pageSize) },
      { root, rootMargin: '0px 0px 300px 0px' }
    )
    observer.observe(sentinel)
    // Rebuilt on each `count` so a sentinel that stays inside the 300px margin is
    // re-evaluated; an element that is already intersecting never emits again.
    return () => observer.disconnect()
  }, [sentinel, count, pageSize, hasMore])

  return { count, sentinelRef, reset }
}
