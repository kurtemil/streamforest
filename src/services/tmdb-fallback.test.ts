import { describe, expect, it } from 'vitest'
import { withEnglishFallback } from './tmdb'

// The shape TMDB actually sends for append_to_response=translations (checked
// against /tv/1399 on 2026-10-11): an object holding the list, not the list.
const detail = {
  overview: '',
  translations: {
    translations: [
      { iso_639_1: 'sv', data: { name: '', overview: '' } },
      { iso_639_1: 'en', data: { name: 'Comedians in Cars Getting Coffee', overview: 'Jerry picks up a friend.' } },
    ],
  },
}

describe('withEnglishFallback', () => {
  it('fills a missing Swedish overview from the English translation, without throwing', () => {
    expect(withEnglishFallback(detail as never, { title: 'Comedians in Cars Getting Coffee', overview: '' }))
      .toEqual({ title: 'Comedians in Cars Getting Coffee', overview: 'Jerry picks up a friend.' })
  })

  it('keeps Swedish text when there is some, and copes with no translations at all', () => {
    expect(withEnglishFallback(detail as never, { title: 'Bäckström', overview: 'En kommissarie.' }))
      .toEqual({ title: 'Bäckström', overview: 'En kommissarie.' })
    expect(withEnglishFallback({ overview: '' } as never, { title: 'X', overview: '' }))
      .toEqual({ title: 'X', overview: '' })
  })
})
