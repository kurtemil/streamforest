import { useState, useEffect, useRef, useCallback } from 'react'

export function useInfiniteScroll(pageSize = 60) {
  const [count, setCount] = useState(pageSize)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => setCount(pageSize), [pageSize])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    // Use the actual scroll container as root so intersection is checked against
    // its scroll viewport, not the document viewport.
    const root = document.querySelector('main') ?? undefined
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setCount((c) => c + pageSize) },
      { root, rootMargin: '0px 0px 300px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [count, pageSize])

  return { count, sentinelRef, reset }
}
