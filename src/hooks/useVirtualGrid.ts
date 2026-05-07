import { useEffect, useMemo, useState, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

interface Options {
  /** Total number of items in the data set. */
  itemCount: number
  /** Scroll-parent ref. The grid scrolls inside this element. */
  parentRef: RefObject<HTMLElement>
  /** CSS aspect ratio of each card (e.g. 2/3 for posters). */
  cardAspect?: number
  /** Tailwind grid breakpoint columns (mobile-first). */
  columns?: { base: number; sm?: number; md?: number; lg?: number; xl?: number; '2xl'?: number }
  /** Gap in px between cards (matches Tailwind gap-N). */
  gap?: number
  /** Extra space below each card to fit title/year text. */
  textRowHeight?: number
  /** Extra rows rendered above/below viewport for smooth scroll. */
  overscan?: number
}

const TAILWIND_BREAKPOINTS: Record<keyof NonNullable<Options['columns']>, number> = {
  base: 0,
  sm:   640,
  md:   768,
  lg:   1024,
  xl:   1280,
  '2xl': 1536,
}

/** Pick the active column count based on the parent element's width. */
function pickColumns(width: number, columns: NonNullable<Options['columns']>): number {
  let active = columns.base
  for (const key of ['sm', 'md', 'lg', 'xl', '2xl'] as const) {
    if (columns[key] !== undefined && width >= TAILWIND_BREAKPOINTS[key]) {
      active = columns[key]!
    }
  }
  return active
}

/**
 * Hook that wraps `@tanstack/react-virtual` for a responsive poster grid.
 *
 * Returns:
 *   - `rows`: virtual row metadata (one entry per *row* of cards, not per card)
 *   - `cols`: current column count
 *   - `totalSize`: total scroll height in px
 *   - `getItemsForRow(rowIndex)`: indices of items in that row (cols of them, last row may be fewer)
 */
export function useVirtualGrid({
  itemCount,
  parentRef,
  cardAspect = 2 / 3,
  columns = { base: 2, sm: 3, md: 4, lg: 5, xl: 6, '2xl': 7 },
  gap = 16,
  textRowHeight = 64,
  overscan = 8,
}: Options) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [parentRef])

  const cols = useMemo(() => (width > 0 ? pickColumns(width, columns) : columns.base), [width, columns])
  const rowCount = Math.ceil(itemCount / cols)

  const cardWidth = cols > 0 && width > 0 ? (width - gap * (cols - 1)) / cols : 0
  const cardHeight = cardWidth / cardAspect
  const rowHeight = cardHeight + textRowHeight + gap

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  })

  const getItemsForRow = (rowIndex: number): number[] => {
    const start = rowIndex * cols
    const end = Math.min(start + cols, itemCount)
    const out: number[] = []
    for (let i = start; i < end; i++) out.push(i)
    return out
  }

  return {
    rows: virtualizer.getVirtualItems(),
    cols,
    rowHeight,
    cardWidth,
    cardHeight,
    totalSize: virtualizer.getTotalSize(),
    getItemsForRow,
    measureElement: virtualizer.measureElement,
    ready: width > 0,
  }
}
