import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function ScrollableRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: false })
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); mo.disconnect() }
  }, [update])

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="group/row relative">
      <div ref={ref} className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 snap-x snap-proximity overscroll-x-contain">{children}</div>
      {/* Arrows are a pointer affordance: on touch the row is swiped instead,
          so they stay hover-gated and are marked for the touch audit. */}
      {canLeft && (
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Scroll left"
          data-pointer-affordance="row-scroll"
          className="absolute left-0 top-0 bottom-2 w-14 flex items-center justify-center bg-gradient-to-r from-surface-100/95 via-surface-100/60 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10"
        >
          <div className="w-9 h-9 rounded-full bg-surface-400/80 ring-1 ring-white/15 flex items-center justify-center hover:bg-accent-600/60 transition-colors">
            <ChevronLeft size={20} className="text-white" />
          </div>
        </button>
      )}
      {canRight && (
        <button
          onClick={() => scrollBy(1)}
          aria-label="Scroll right"
          data-pointer-affordance="row-scroll"
          className="absolute right-0 top-0 bottom-2 w-14 flex items-center justify-center bg-gradient-to-l from-surface-100/95 via-surface-100/60 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity z-10"
        >
          <div className="w-9 h-9 rounded-full bg-surface-400/80 ring-1 ring-white/15 flex items-center justify-center hover:bg-accent-600/60 transition-colors">
            <ChevronRight size={20} className="text-white" />
          </div>
        </button>
      )}
    </div>
  )
}

export function SectionHeader({
  title,
  to,
  onSeeAll,
}: {
  title: string
  to?: string
  onSeeAll?: () => void
}) {
  const linkClass =
    'flex items-center gap-0.5 min-h-11 py-3 -my-3 pl-3 -ml-3 text-caption text-neutral-500 hover:text-accent-400 transition-colors'
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-heading-lg text-white">{title}</h2>
      {to && (
        <Link to={to} className={linkClass}>
          See all <ChevronRight size={13} />
        </Link>
      )}
      {!to && onSeeAll && (
        <button onClick={onSeeAll} className={linkClass}>
          See all <ChevronRight size={13} />
        </button>
      )}
    </div>
  )
}
