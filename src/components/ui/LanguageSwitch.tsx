import { Languages } from 'lucide-react'
import { LOCALES, LOCALE_LABELS, useLocale, useT } from '@/lib/i18n'
import { useLocaleStore } from '@/stores/localeStore'

/**
 * The language switch itself — one pill per language, the active one filled.
 *
 * It appears in two places, and both are needed. Settings is the obvious home,
 * but Settings is parent-and-admin only: a kid signed in on their own phone
 * could not reach it, and the language is a per-device setting rather than a
 * parental one. So the same control also sits on the profile picker, which is
 * the first screen everybody sees and the one screen no role is kept out of.
 *
 * Each language is written in itself — "Svenska", never "Swedish" — because the
 * person who needs the switch is the one who cannot read the current language.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const setLocale = useLocaleStore((s) => s.setLocale)

  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label={t('settings.language')}
    >
      {compact && <Languages size={14} className="text-neutral-500 shrink-0" />}
      {LOCALES.map((code) => {
        const active = code === locale
        return (
          <button
            key={code}
            onClick={() => setLocale(code)}
            aria-pressed={active}
            lang={code}
            className={`min-h-11 px-4 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-accent-600/20 text-accent-400 ring-1 ring-accent-600/40'
                : 'text-neutral-400 bg-white/5 hover:bg-white/10 hover:text-white'
            }`}
          >
            {LOCALE_LABELS[code]}
          </button>
        )
      })}
    </div>
  )
}
