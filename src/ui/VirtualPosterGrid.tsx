import { useRef, type ReactNode } from 'react'
import { useVirtualGrid } from '@/hooks/useVirtualGrid'

interface Props<T> {
  items: T[]
  /** Stable key per item — used as React key. */
  getKey: (item: T, index: number) => string
  /** Render a single card. The card should fill the cell without explicit width. */
  renderItem: (item: T, index: number) => ReactNode
  /** Optional: card aspect ratio. Defaults to 2/3 (poster). */
  aspect?: number
  /** Optional: extra height below each card for title/text. */
  textRowHeight?: number
  /** Optional: gap in px between cards. Default 16 (matches gap-4). */
  gap?: number
  /** Override the default responsive column counts. */
  columns?: Parameters<typeof useVirtualGrid>[0]['columns']
  /** Optional extra class on the scroll container. */
  className?: string
}

/**
 * Virtualized responsive poster grid. Only renders rows visible in the
 * scroll viewport, so a 25k-item list still scrolls at 60fps.
 *
 * The component takes over the scroll container — make sure its parent
 * provides the available height (e.g., `flex-1 min-h-0`).
 */
export function VirtualPosterGrid<T>({
  items,
  getKey,
  renderItem,
  aspect = 2 / 3,
  textRowHeight = 64,
  gap = 16,
  columns,
  className = '',
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const { rows, cols, totalSize, getItemsForRow, ready } = useVirtualGrid({
    itemCount: items.length,
    parentRef: ref,
    cardAspect: aspect,
    columns,
    gap,
    textRowHeight,
  })

  return (
    <div ref={ref} className={`overflow-y-auto h-full ${className}`}>
      <div
        style={{ height: ready ? totalSize : 'auto', position: 'relative' }}
      >
        {ready && rows.map((row) => {
          const indices = getItemsForRow(row.index)
          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                columnGap: `${gap}px`,
              }}
            >
              {indices.map((i) => (
                <div key={getKey(items[i], i)} className="min-w-0">
                  {renderItem(items[i], i)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
