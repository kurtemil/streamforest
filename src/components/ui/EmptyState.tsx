import type { ReactNode } from 'react'

interface Props {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="text-neutral-600">{icon}</div>
      <div>
        <p className="text-white font-medium">{title}</p>
        <p className="text-neutral-500 text-sm mt-1 max-w-xs">{description}</p>
      </div>
      {action}
    </div>
  )
}
