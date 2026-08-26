/**
 * The translation layer. Hand-rolled, and deliberately: the whole thing is one
 * lookup, one plural rule and a `{name}` replace, which is less code than the
 * configuration of any library that would do it — and this app already refuses
 * a dependency it can write in twenty lines.
 *
 * Two ways in, and which one you want depends on where you are:
 *
 *   `useT()`   in a component. It subscribes to the locale, so switching the
 *              language re-renders the component and the strings change.
 *   `t()`      anywhere else — stores, effects, callbacks that must not gain a
 *              dependency. It reads the current locale without subscribing, so
 *              a string produced this way keeps whatever language it was made
 *              in until something else re-renders. That is correct for the
 *              things that use it: error messages already on screen.
 *
 * Never build a sentence by concatenating two translated fragments. Word order
 * is not shared between languages — use one key with placeholders.
 */
import { useMemo } from 'react'
import { en } from './en'
import { sv } from './sv'
import { INTL_TAGS, type Locale } from './locales'
import { useLocaleStore } from '@/stores/localeStore'

export * from './locales'

export type Messages = Record<keyof typeof en, string>

/**
 * A key that can be passed to `t`: every literal key, plus the base of each
 * `_one`/`_other` pair, which is what callers actually write.
 */
type PluralBase<K> = K extends `${infer Base}_other` ? Base : never
export type MessageKey = keyof Messages | PluralBase<keyof Messages>

export type Vars = Record<string, string | number>

const CATALOGS: Record<Locale, Messages> = { en, sv }

/**
 * Both languages here have exactly two plural forms and split on `n === 1`, so
 * that is the rule. A third language with more forms — Polish, Arabic — would
 * replace this with `Intl.PluralRules`, and the `_one`/`_other` key naming was
 * chosen to match its category names for exactly that reason.
 */
function pluralSuffix(count: number): 'one' | 'other' {
  return count === 1 ? 'one' : 'other'
}

function resolve(locale: Locale, key: string, vars?: Vars): string {
  const catalog = CATALOGS[locale] as Record<string, string | undefined>

  let template: string | undefined
  if (vars && typeof vars.count === 'number') {
    template = catalog[`${key}_${pluralSuffix(vars.count)}`]
  }
  template ??= catalog[key]

  // A missing key is a bug, not a runtime condition: fall back to English so the
  // screen still says something, and surface the key itself if even that is gone.
  if (template === undefined) {
    template = (en as Record<string, string | undefined>)[key] ?? key
  }

  if (!vars) return template

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    if (value === undefined) return whole
    // Counts are numbers people read, so they get thousands separators — which
    // are a space in Swedish and a comma in English, hence going through Intl
    // rather than through the template.
    return typeof value === 'number' ? formatNumber(value, locale) : value
  })
}

/** Non-reactive translate. See the note at the top for when this is the right one. */
export function t(key: MessageKey, vars?: Vars): string {
  return resolve(useLocaleStore.getState().locale, key, vars)
}

/** Translate inside a component, re-rendering it when the language changes. */
export function useT(): (key: MessageKey, vars?: Vars) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useMemo(() => (key: MessageKey, vars?: Vars) => resolve(locale, key, vars), [locale])
}

/** The active locale, for the places that need the tag rather than a string. */
export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale)
}

/** The active locale without subscribing — the `t()` of locales. */
export function currentLocale(): Locale {
  return useLocaleStore.getState().locale
}

export function intlTag(locale: Locale = useLocaleStore.getState().locale): string {
  return INTL_TAGS[locale]
}

// ── Formatting ─────────────────────────────────────────────────────────────────
//
// `Intl` objects are expensive to build and this app builds them per card, so
// each one is made once per locale and kept.

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()
const timeFormats = new Map<string, Intl.DateTimeFormat>()

export function formatNumber(value: number, locale?: Locale): string {
  const tag = intlTag(locale)
  let fmt = numberFormats.get(tag)
  if (!fmt) {
    fmt = new Intl.NumberFormat(tag)
    numberFormats.set(tag, fmt)
  }
  return fmt.format(value)
}

/** Date and clock together — "Last updated", "Last loaded". */
export function formatDateTime(ts: number, locale?: Locale): string {
  const tag = intlTag(locale)
  let fmt = dateTimeFormats.get(tag)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' })
    dateTimeFormats.set(tag, fmt)
  }
  return fmt.format(new Date(ts))
}

/** Clock only — the EPG strip, where the date is always today. */
export function formatClock(ts: number, locale?: Locale): string {
  const tag = intlTag(locale)
  let fmt = timeFormats.get(tag)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' })
    timeFormats.set(tag, fmt)
  }
  return fmt.format(new Date(ts))
}

/**
 * A running time in whole minutes, as "1h 47m" or "1 tim 47 min". Shared by the
 * hero, the detail modal and the EPG strip so the three cannot drift apart.
 */
export function formatRuntime(minutes: number, locale?: Locale): string {
  const loc = locale ?? useLocaleStore.getState().locale
  if (minutes < 60) return resolve(loc, 'time.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? resolve(loc, 'time.hours', { count: hours })
    : resolve(loc, 'time.hoursMinutes', { hours, minutes: rest })
}

/**
 * A comparator for sorting titles. `localeCompare` without a tag uses whatever
 * the device is set to, which puts Ä between A and B on a Swedish phone and at
 * the end of the alphabet on an English one — the same library sorting two ways
 * depending on whose phone it is opened on.
 */
export function titleCollator(locale?: Locale): Intl.Collator {
  return new Intl.Collator(intlTag(locale), { sensitivity: 'base', numeric: true })
}
