/**
 * Which languages exist, and everything about a language that is not a string
 * in a catalog: how to detect it, how Intl should be told about it, and which
 * language TMDB should answer in.
 *
 * Kept apart from `index.ts` so the store can import the type without pulling
 * the catalogs — and without the two files importing each other.
 */

export const LOCALES = ['sv', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** What the switch is labelled with. Each language names itself, never the other. */
export const LOCALE_LABELS: Record<Locale, string> = {
  sv: 'Svenska',
  en: 'English',
}

/**
 * Intl and `localeCompare` want a full tag, not the bare language. `en-GB`
 * rather than `en-US`: this app writes 24-hour clocks and day-before-month
 * everywhere else, and an `en-US` tag would have `Intl` disagree with the rest
 * of the interface on the one screen that uses it.
 */
export const INTL_TAGS: Record<Locale, string> = {
  sv: 'sv-SE',
  en: 'en-GB',
}

/** What `language=` is set to on a TMDB request. */
export const TMDB_TAGS: Record<Locale, string> = {
  sv: 'sv-SE',
  en: 'en-US',
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

/**
 * The language of the device, when nothing has been chosen yet. `navigator.languages`
 * is in preference order, so the first entry we can actually serve wins — a phone
 * set to Swedish with English second lands on Swedish, and one set to German lands
 * on English rather than on whatever happens to be first in our own list.
 */
export function detectLocale(): Locale {
  const candidates =
    typeof navigator === 'undefined'
      ? []
      : [...(navigator.languages ?? []), navigator.language].filter(Boolean)

  for (const tag of candidates) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/**
 * `<html lang>` is not decoration: it is what tells iOS which hyphenation and
 * which voice to use, and Safari's reader and VoiceOver both read it. It has to
 * follow the switch, so it is set from code rather than left at the value baked
 * into `index.html`.
 */
export function applyDocumentLang(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
}
