import { useState } from 'react'
import { Film, Tv, Radio } from 'lucide-react'
import type { ContentType } from '@/types'

interface Props {
  src: string
  alt: string
  type: ContentType
  className?: string
}

const FallbackIcon = ({ type }: { type: ContentType }) => {
  const Icon = type === 'movie' ? Film : type === 'series' ? Tv : Radio
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
      <Icon size={28} className="text-neutral-600" />
    </div>
  )
}

export function Poster({ src, alt, type, className = '' }: Props) {
  const [failed, setFailed] = useState(!src)

  if (failed) return (
    <div className={className}>
      <FallbackIcon type={type} />
    </div>
  )

  return (
    <img
      src={src}
      alt={alt}
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
