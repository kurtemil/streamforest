import { SUBTITLE_SIZES, type SubtitleSize } from '@/lib/subtitleSize'
import { useT } from '@/lib/i18n'

const GLYPH: Record<SubtitleSize, string> = { s: 'text-xs', m: 'text-sm', l: 'text-base', xl: 'text-lg' }

/**
 * Four sizes, each shown as an "A" of roughly that size, so the choice reads
 * without words. Used in both players' subtitle menus and in Settings; all three
 * write the same per-profile setting.
 */
export function SubtitleSizePicker({ value, onChange, tone = 'dark' }: {
  value: SubtitleSize
  onChange: (size: SubtitleSize) => void
  /** 'dark' inside a player menu, 'panel' on a settings card. */
  tone?: 'dark' | 'panel'
}) {
  const t = useT()
  return (
    <div role="radiogroup" aria-label={t('player.subSize')} className="flex items-center gap-1">
      {SUBTITLE_SIZES.map((size) => {
        const on = size === value
        return (
          <button
            key={size}
            role="radio"
            aria-checked={on}
            aria-label={t(`player.subSize_${size}`)}
            title={t(`player.subSize_${size}`)}
            onClick={() => onChange(size)}
            className={`flex-1 min-w-11 min-h-11 rounded-lg font-semibold transition-colors ${GLYPH[size]} ${
              on
                ? 'bg-accent-600/30 text-accent-300 ring-1 ring-accent-500/50'
                : tone === 'dark'
                  ? 'bg-white/5 hover:bg-white/15 text-white/70 hover:text-white'
                  : 'bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white'
            }`}
          >
            A
          </button>
        )
      })}
    </div>
  )
}
