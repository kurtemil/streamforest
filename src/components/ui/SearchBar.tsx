import { Search, X } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder = 'Search…' }: Props) {
  return (
    <div className="relative">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/8 rounded-lg min-h-11 pl-9 pr-8 py-2.5 text-base can-hover:text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-accent-600/60 focus:bg-white/8 transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-neutral-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
