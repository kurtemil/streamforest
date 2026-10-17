import { describe, expect, it } from 'vitest'
import { estimatePosition, type Handoff } from './vlcHandoff'

const h: Handoff = { at: 0, kind: 'sf', profileId: 'elof', title: 'Paul', id: 'm1', start: 600, durationSec: 6000 }

describe('estimatePosition', () => {
  it('adds the time away to where VLC started, less a moment to get going', () => {
    expect(estimatePosition(h, 30 * 60_000)).toBe(600 + 1800 - 15)
  })

  it('never guesses past the end', () => {
    expect(estimatePosition(h, 5 * 3600_000)).toBe(6000)
  })

  it('guesses without an end when the length is unknown', () => {
    expect(estimatePosition({ ...h, durationSec: null }, 5 * 3600_000)).toBe(600 + 18000 - 15)
  })
})
