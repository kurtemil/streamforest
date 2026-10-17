import { describe, expect, it } from 'vitest'
import { pickHomeSubtitle, samePick, subtitleLabel, SUBTITLES_OFF } from './homeSubtitles'
import type { HomeSubtitle } from '@/services/jellyfin'

const sub = (index: number, over: Partial<HomeSubtitle> = {}): HomeSubtitle =>
  ({ index, text: true, forced: false, isDefault: false, ...over })

describe('pickHomeSubtitle', () => {
  // Hit and Run: three DVD streams, Swedish marked default.
  const hitAndRun = [sub(2, { lang: 'nor', text: false }), sub(3, { lang: 'swe', text: false, isDefault: true }), sub(4, { lang: 'fin', text: false })]

  it('finds Swedish for a profile that asked for "sv", although the stream says "swe"', () => {
    expect(pickHomeSubtitle(hitAndRun, undefined, 'sv')?.index).toBe(3)
  })

  it('remembers off for a title, over the profile language', () => {
    expect(pickHomeSubtitle(hitAndRun, SUBTITLES_OFF, 'sv')).toBeNull()
  })

  it('remembers a language for a title, over the profile language', () => {
    expect(pickHomeSubtitle(hitAndRun, 'fin', 'sv')?.index).toBe(4)
  })

  it('prefers a text stream to a picture one in the same language', () => {
    expect(pickHomeSubtitle([sub(1, { lang: 'swe', text: false }), sub(2, { lang: 'swe' })], undefined, 'sv')?.index).toBe(2)
  })

  it('takes an untagged default stream when nothing is tagged with the language (In Time)', () => {
    expect(pickHomeSubtitle([sub(0, { isDefault: true })], undefined, 'sv')?.index).toBe(0)
  })

  it('shows nothing to a profile that wants none, unless a stream is forced', () => {
    expect(pickHomeSubtitle(hitAndRun, undefined, '')).toBeNull()
    expect(pickHomeSubtitle([sub(1, { lang: 'eng' }), sub(2, { lang: 'eng', forced: true })], undefined, '')?.index).toBe(2)
  })
})

describe('samePick', () => {
  it('carries the choice to the next part by language, whatever its index there', () => {
    const next = [sub(5, { lang: 'eng' }), sub(6, { lang: 'swe' })]
    expect(samePick(next, sub(2, { lang: 'swe' }))?.index).toBe(6)
    expect(samePick(next, null)).toBeNull()
  })
})

describe('subtitleLabel', () => {
  it('names the language in the interface language', () => {
    expect(subtitleLabel(sub(1, { lang: 'swe' }), 'sv', 'Spår 1')).toBe('Svenska')
    expect(subtitleLabel(sub(1, { lang: 'eng', title: 'SDH' }), 'en', 'Track 1')).toBe('English · SDH')
    expect(subtitleLabel(sub(1), 'sv', 'Spår 1')).toBe('Spår 1')
  })
})
