import { type HTMLAttributes, type ReactNode } from 'react'

type Variant = 'neutral' | 'accent' | 'outline'
type Size    = 'sm' | 'md'

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
  size?: Size
  selected?: boolean
  leadingIcon?: ReactNode
}

const VARIANT: Record<Variant, string> = {
  neutral: 'bg-white/8 text-neutral-200 ring-1 ring-white/10',
  accent:  'bg-accent-600/20 text-accent-300 ring-1 ring-accent-600/40',
  outline: 'bg-transparent text-neutral-300 ring-1 ring-white/15',
}

const SIZE: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-micro',
  md: 'px-2.5 py-1 text-caption',
}

export function Chip({
  variant = 'neutral',
  size = 'sm',
  selected,
  leadingIcon,
  className = '',
  children,
  ...rest
}: Props) {
  const variantClass = selected ? VARIANT.accent : VARIANT[variant]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium tracking-tight ${variantClass} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {leadingIcon}
      {children}
    </span>
  )
}
