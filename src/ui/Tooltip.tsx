import { useState, useRef, type ReactNode } from 'react'

interface Props {
  label: ReactNode
  children: ReactNode
  /** Delay before showing in ms. */
  delay?: number
  /** Side relative to anchor. */
  side?: 'top' | 'bottom' | 'left' | 'right'
}

const SIDE_CLASS: Record<NonNullable<Props['side']>, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
}

export function Tooltip({ label, children, delay = 350, side = 'top' }: Props) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)

  const show = () => {
    timer.current = window.setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-surface-500/95 px-2 py-1 text-micro text-white ring-1 ring-white/10 shadow-cinema backdrop-blur-md animate-fade-in ${SIDE_CLASS[side]}`}
        >
          {label}
        </span>
      )}
    </span>
  )
}
