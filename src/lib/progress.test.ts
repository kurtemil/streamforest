import { describe, it, expect } from 'vitest'
import { watchedFraction, isCompleted, resolveSaveDuration, progressPercent } from './progress'

// A two-hour film, resumed at 1:36 — the scenario behind finding C1.
const FILM_DURATION = 7200
const RESUME_AT = 5760
// The stream the proxy actually hands back when asked to start at 1:36: only the
// remainder of the film exists in it.
const STREAM_REMAINING = FILM_DURATION - RESUME_AT  // 1440

describe('resolveSaveDuration', () => {
  it('prefers the probed film duration over the stream length', () => {
    expect(resolveSaveDuration(FILM_DURATION, STREAM_REMAINING)).toBe(FILM_DURATION)
  })

  it('falls back to video.duration when the item was never probed', () => {
    expect(resolveSaveDuration(null, 5400)).toBe(5400)
  })

  it('returns 0 for Infinity — fragmented MP4 with no declared length', () => {
    expect(resolveSaveDuration(null, Infinity)).toBe(0)
  })

  it('returns 0 for NaN', () => {
    expect(resolveSaveDuration(null, NaN)).toBe(0)
  })

  it('ignores a zero or negative probed duration', () => {
    expect(resolveSaveDuration(0, 5400)).toBe(5400)
    expect(resolveSaveDuration(-1, 5400)).toBe(5400)
  })

  it('returns 0 when neither source is usable', () => {
    expect(resolveSaveDuration(null, 0)).toBe(0)
  })
})

describe('watchedFraction', () => {
  it('is the plain ratio for consistent inputs', () => {
    expect(watchedFraction(3600, 7200)).toBe(0.5)
  })

  it('is 0 when the duration is unknown', () => {
    expect(watchedFraction(3600, 0)).toBe(0)
    expect(watchedFraction(3600, Infinity)).toBe(0)
    expect(watchedFraction(3600, NaN)).toBe(0)
  })

  it('is 0 at or before the start', () => {
    expect(watchedFraction(0, 7200)).toBe(0)
    expect(watchedFraction(-5, 7200)).toBe(0)
  })
})

describe('isCompleted', () => {
  it('is false partway through', () => {
    expect(isCompleted(RESUME_AT, FILM_DURATION)).toBe(false)
  })

  it('is true past 90 %', () => {
    expect(isCompleted(6600, FILM_DURATION)).toBe(true)
  })

  it('is true at the very end', () => {
    expect(isCompleted(FILM_DURATION, FILM_DURATION)).toBe(true)
  })

  it('tolerates a small overshoot from keyframe rounding', () => {
    expect(isCompleted(FILM_DURATION + 30, FILM_DURATION)).toBe(true)
  })

  // The C1 defence. Saving a film position against a stream duration produces a
  // ratio of 4, which the old `position / duration > 0.9` read as "finished" —
  // and the title vanished from Continue Watching five seconds after resuming.
  it('refuses to call it finished when position and duration disagree wildly', () => {
    expect(RESUME_AT / STREAM_REMAINING).toBe(4)
    expect(isCompleted(RESUME_AT, STREAM_REMAINING)).toBe(false)
  })

  it('is false when the duration is unusable', () => {
    expect(isCompleted(3600, 0)).toBe(false)
    expect(isCompleted(3600, Infinity)).toBe(false)
  })
})

describe('progressPercent', () => {
  it('is the ratio as a percentage', () => {
    expect(progressPercent(1800, 7200)).toBe(25)
  })

  it('never exceeds 100, so a corrupt row cannot overflow a progress bar', () => {
    expect(progressPercent(RESUME_AT, STREAM_REMAINING)).toBe(100)
  })

  it('is 0 rather than NaN when the duration is missing', () => {
    expect(progressPercent(1800, 0)).toBe(0)
  })
})
