import { type HTMLAttributes } from 'react'

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual variant. `text` is shorter+rounded; `card` is a rectangle; `poster` is a 2:3; `circle` is round. */
  variant?: 'text' | 'rect' | 'card' | 'poster' | 'circle'
  /** Optional explicit width — pass any CSS length. */
  width?: string | number
  /** Optional explicit height. */
  height?: string | number
}

const VARIANT_CLASS: Record<NonNullable<SkeletonProps['variant']>, string> = {
  text:   'h-3.5 rounded-md',
  rect:   'rounded-md',
  card:   'rounded-xl aspect-video',
  poster: 'rounded-xl aspect-[2/3]',
  circle: 'rounded-full aspect-square',
}

export function Skeleton({
  variant = 'rect',
  width,
  height,
  className = '',
  style,
  ...rest
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`shimmer ${VARIANT_CLASS[variant]} ${className}`}
      style={{ width, height, ...style }}
      {...rest}
    />
  )
}

/** Three stacked text bars — common loading row shape. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  )
}

/** Poster + 2 text lines — used for any title card while metadata loads. */
export function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton variant="poster" />
      <Skeleton variant="text" />
      <Skeleton variant="text" style={{ width: '50%' }} />
    </div>
  )
}
