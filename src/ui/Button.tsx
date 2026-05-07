import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'glass' | 'danger'
type Size    = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  loading?: boolean
  fullWidth?: boolean
}

const BASE = [
  'inline-flex items-center justify-center gap-2',
  'font-medium tracking-tight',
  'rounded-lg',
  'transition-all duration-150 ease-out-expo',
  'select-none whitespace-nowrap',
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
  'active:scale-[0.97]',
].join(' ')

const VARIANT: Record<Variant, string> = {
  primary:   'bg-accent-600 hover:bg-accent-500 text-white shadow-card hover:shadow-card-hover',
  secondary: 'bg-white/10 hover:bg-white/15 text-white ring-1 ring-white/10 hover:ring-white/20',
  ghost:     'bg-transparent hover:bg-white/5 text-neutral-300 hover:text-white',
  glass:     'bg-white/8 backdrop-blur-md text-white ring-1 ring-white/15 hover:bg-white/12',
  danger:    'bg-danger-600 hover:bg-danger-500 text-white shadow-card',
}

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-caption',
  md: 'px-4 py-2 text-body',
  lg: 'px-6 py-3 text-body-lg',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leadingIcon,
    trailingIcon,
    loading,
    fullWidth,
    className = '',
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        leadingIcon
      )}
      {children}
      {trailingIcon}
    </button>
  )
})
