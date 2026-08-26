import { describe, expect, it } from 'vitest'
import { en } from './en'
import { sv } from './sv'
import { LOCALES } from './locales'
import { formatRuntime, t } from './index'
import { useLocaleStore } from '@/stores/localeStore'

const CATALOGS = { en, sv } as Record<string, Record<string, string>>

function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('catalogs', () => {
  // `satisfies Messages` already makes a missing key a build error. What it
  // cannot see is a *placeholder* that got lost in translation: a Swedish string
  // without its `{count}` compiles perfectly and renders a sentence with the
  // number missing, which is exactly the kind of thing nobody notices until it
  // is in front of someone.
  it('every language fills the same placeholders as English', () => {
    const mismatched: string[] = []
    for (const [key, english] of Object.entries(en)) {
      const expected = placeholders(english)
      for (const locale of LOCALES) {
        if (locale === 'en') continue
        const other = CATALOGS[locale][key]
        if (JSON.stringify(placeholders(other)) !== JSON.stringify(expected)) {
          mismatched.push(`${locale}:${key} — expected {${expected}}, got {${placeholders(other)}}`)
        }
      }
    }
    expect(mismatched).toEqual([])
  })

  it('has both plural forms wherever it has one', () => {
    const lonely: string[] = []
    for (const locale of LOCALES) {
      const cat = CATALOGS[locale]
      for (const key of Object.keys(cat)) {
        if (key.endsWith('_one') && !(`${key.slice(0, -4)}_other` in cat)) lonely.push(`${locale}:${key}`)
        if (key.endsWith('_other') && !(`${key.slice(0, -6)}_one` in cat)) lonely.push(`${locale}:${key}`)
      }
    }
    expect(lonely).toEqual([])
  })

  it('leaves no English text in the Swedish catalog', () => {
    // Not a spellcheck — it catches the copy-paste that forgets to translate.
    // Anything genuinely identical in both languages is listed here on purpose.
    const allowed = new Set([
      'feedback.title',       // "Feedback" is the Swedish word too
      'time.minutes',         // "{count} min" either way
      'settings.metadata',    // "Metadata (TMDB)"
      'nav.feedback',
      'nav.liveShort',        // "Live"
      'series.seasonShort',   // S01E02 notation is not translated anywhere
    ])
    const untranslated = Object.keys(en).filter(
      (k) => !allowed.has(k) && (sv as Record<string, string>)[k] === (en as Record<string, string>)[k],
    )
    expect(untranslated).toEqual([])
  })
})

describe('t', () => {
  const setLocale = (l: 'sv' | 'en') => useLocaleStore.setState({ locale: l, chosen: l })

  it('interpolates named placeholders', () => {
    setLocale('en')
    expect(t('hero.goToSlide', { number: 3 })).toBe('Go to slide 3')
    setLocale('sv')
    expect(t('hero.goToSlide', { number: 3 })).toBe('Gå till bild 3')
  })

  it('picks the plural form from count', () => {
    setLocale('sv')
    expect(t('movies.count', { count: 1 })).toBe('1 titel')
    expect(t('movies.count', { count: 2 })).toBe('2 titlar')
    setLocale('en')
    expect(t('movies.count', { count: 1 })).toBe('1 title')
    expect(t('movies.count', { count: 2 })).toBe('2 titles')
  })

  it('groups thousands the way the language does', () => {
    setLocale('en')
    expect(t('movies.count', { count: 12345 })).toBe('12,345 titles')
    setLocale('sv')
    // A non-breaking space in Swedish, which is why this goes through Intl at
    // all rather than being interpolated as a bare number.
    expect(t('movies.count', { count: 12345 })).toBe('12 345 titlar')
  })

  it('leaves an unknown placeholder alone rather than printing "undefined"', () => {
    setLocale('en')
    expect(t('common.resultsFor', {})).toBe('Results for "{query}"')
  })
})

describe('formatRuntime', () => {
  it('reads as the language writes durations', () => {
    expect(formatRuntime(47, 'en')).toBe('47m')
    expect(formatRuntime(47, 'sv')).toBe('47 min')
    expect(formatRuntime(120, 'en')).toBe('2h')
    expect(formatRuntime(120, 'sv')).toBe('2 tim')
    expect(formatRuntime(107, 'en')).toBe('1h 47m')
    expect(formatRuntime(107, 'sv')).toBe('1 tim 47 min')
  })
})
