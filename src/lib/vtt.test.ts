import { describe, it, expect } from 'vitest'
import { parseVttTimestamp, parseVttBlock } from './vtt'

describe('parseVttTimestamp', () => {
  it('parses MM:SS.mmm', () => {
    expect(parseVttTimestamp('01:23.456')).toBeCloseTo(83.456)
  })

  it('parses HH:MM:SS.mmm', () => {
    expect(parseVttTimestamp('01:02:03.004')).toBeCloseTo(3723.004)
  })

  it('pads short milliseconds', () => {
    // "00:01.5" → 1.500s
    expect(parseVttTimestamp('00:01.5')).toBeCloseTo(1.5)
  })

  it('truncates long milliseconds to 3 digits', () => {
    expect(parseVttTimestamp('00:00.1234')).toBeCloseTo(0.123)
  })

  it('returns NaN for garbage', () => {
    expect(parseVttTimestamp('not-a-time')).toBeNaN()
    expect(parseVttTimestamp('')).toBeNaN()
  })
})

describe('parseVttBlock', () => {
  it('parses a basic cue', () => {
    const cue = parseVttBlock('00:00:01.000 --> 00:00:04.000\nHello world')
    expect(cue).not.toBeNull()
    expect(cue!.startTime).toBeCloseTo(1)
    expect(cue!.endTime).toBeCloseTo(4)
    expect(cue!.text).toBe('Hello world')
  })

  it('parses cue with optional cue id line', () => {
    const cue = parseVttBlock('1\n00:01:00.000 --> 00:01:03.500\nSome dialogue')
    expect(cue).not.toBeNull()
    expect(cue!.startTime).toBeCloseTo(60)
    expect(cue!.text).toBe('Some dialogue')
  })

  it('handles multi-line cue text', () => {
    const cue = parseVttBlock('00:00:10.000 --> 00:00:12.000\nLine one\nLine two')
    expect(cue).not.toBeNull()
    expect(cue!.text).toBe('Line one\nLine two')
  })

  it('ignores WEBVTT header block', () => {
    expect(parseVttBlock('WEBVTT\n\nKind: captions')).toBeNull()
  })

  it('ignores NOTE keepalive blocks', () => {
    expect(parseVttBlock('NOTE')).toBeNull()
    expect(parseVttBlock('NOTE keepalive from proxy')).toBeNull()
    // The proxy sends "\nNOTE\n\n" — after splitting on \n\n and trimming, block = "NOTE"
    expect(parseVttBlock('\nNOTE')).toBeNull()
  })

  it('ignores STYLE blocks', () => {
    expect(parseVttBlock('STYLE\n::cue { color: white }')).toBeNull()
  })

  it('ignores REGION blocks', () => {
    expect(parseVttBlock('REGION\nid:r1')).toBeNull()
  })

  it('returns null for empty block', () => {
    expect(parseVttBlock('')).toBeNull()
    expect(parseVttBlock('   \n   ')).toBeNull()
  })

  it('returns null when no timestamp line', () => {
    expect(parseVttBlock('just some text\nno timestamp')).toBeNull()
  })

  it('returns null when cue has no text content', () => {
    expect(parseVttBlock('00:00:01.000 --> 00:00:04.000')).toBeNull()
  })

  it('returns null when end <= start', () => {
    expect(parseVttBlock('00:00:05.000 --> 00:00:03.000\nBackwards')).toBeNull()
    expect(parseVttBlock('00:00:05.000 --> 00:00:05.000\nZero duration')).toBeNull()
  })

  it('strips cue settings from timestamp line', () => {
    // "position:50% align:center" must not break timestamp parsing
    const cue = parseVttBlock('00:00:02.000 --> 00:00:05.000 position:50% align:center\nCentered text')
    expect(cue).not.toBeNull()
    expect(cue!.startTime).toBeCloseTo(2)
    expect(cue!.endTime).toBeCloseTo(5)
  })

  it('handles large timestamps (full-length movie)', () => {
    // ~2h mark
    const cue = parseVttBlock('01:58:34.120 --> 01:58:36.800\nEnd credits begin')
    expect(cue).not.toBeNull()
    expect(cue!.startTime).toBeCloseTo(7114.12)
    expect(cue!.endTime).toBeCloseTo(7116.8)
  })
})
