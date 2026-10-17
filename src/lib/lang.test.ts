import { describe, expect, it } from 'vitest'
import { canonicalLang, langMatches } from './lang'

describe('langMatches', () => {
  it('matches the stored two-letter code against three-letter track tags', () => {
    expect(langMatches('sv', { lang: 'swe' })).toBe(true)
    expect(langMatches('es', { lang: 'spa' })).toBe(true)
    expect(langMatches('de', { lang: 'ger' })).toBe(true)
    expect(langMatches('no', { lang: 'nob' })).toBe(true)
  })

  it('still matches a track tag remembered for a title', () => {
    expect(langMatches('swe', { lang: 'swe' })).toBe(true)
    expect(langMatches('eng', { lang: 'en' })).toBe(true)
  })

  it('reads the language from the title when the tag is missing', () => {
    expect(langMatches('sv', { lang: 'und', name: 'Svenska' })).toBe(true)
    expect(langMatches('en', { lang: null, name: 'English SDH' })).toBe(true)
    expect(langMatches('sv', { lang: null, name: 'Track 2' })).toBe(false)
  })

  it('does not take one language for another', () => {
    expect(langMatches('sv', { lang: 'nor' })).toBe(false)
    expect(langMatches('', { lang: 'swe' })).toBe(false)
  })
})

describe('canonicalLang', () => {
  it('drops regions and knows "und" means nothing', () => {
    expect(canonicalLang('sv-SE')).toBe('sv')
    expect(canonicalLang('und')).toBeNull()
    expect(canonicalLang('tlh')).toBe('tlh')
  })
})
