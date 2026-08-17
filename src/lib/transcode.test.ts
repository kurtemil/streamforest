import { describe, it, expect } from 'vitest'
import {
  pickProxyMode,
  audioStreamLabel,
  subtitleStreamLabel,
} from './transcode'
import type { MediaInfo, AudioStream, SubtitleStream } from './transcode'

const baseInfo: MediaInfo = {
  duration: 7200,
  startTime: 0,
  audioCodec: 'aac',
  videoCodec: 'h264',
  audioStreams: [],
  subtitleStreams: [],
}

describe('pickProxyMode', () => {
  it('returns transcode for null info', () => {
    expect(pickProxyMode(null)).toBe('transcode')
  })

  it('returns copy for h264+aac (browser-native)', () => {
    expect(pickProxyMode(baseInfo)).toBe('copy')
  })

  it('returns transcode for AC3 audio', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'ac3' })).toBe('transcode')
  })

  it('returns transcode for EAC3 audio', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'eac3' })).toBe('transcode')
  })

  it('returns transcode for DTS audio', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'dts' })).toBe('transcode')
  })

  it('returns transcode for TrueHD audio', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'truehd' })).toBe('transcode')
  })

  it('is case-insensitive for codec names', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'AC3' })).toBe('transcode')
    expect(pickProxyMode({ ...baseInfo, audioCodec: 'EAC3' })).toBe('transcode')
  })

  it('returns copy for hevc+aac', () => {
    expect(pickProxyMode({ ...baseInfo, videoCodec: 'hevc', audioCodec: 'aac' })).toBe('copy')
  })

  it('returns copy for av1+aac', () => {
    expect(pickProxyMode({ ...baseInfo, videoCodec: 'av1', audioCodec: 'aac' })).toBe('copy')
  })

  it('returns transcode for unknown video codec', () => {
    expect(pickProxyMode({ ...baseInfo, videoCodec: 'mpeg4' })).toBe('transcode')
  })

  it('returns copy when audioCodec is null (no audio stream)', () => {
    expect(pickProxyMode({ ...baseInfo, audioCodec: null })).toBe('copy')
  })
})

describe('audioStreamLabel', () => {
  const base: AudioStream = { index: 0, codec: null, channels: null, lang: null, title: null }

  it('uses title if present', () => {
    expect(audioStreamLabel({ ...base, title: 'Director Commentary' })).toBe('Director Commentary')
  })

  it('uses lang uppercased when no title', () => {
    expect(audioStreamLabel({ ...base, lang: 'swe' })).toBe('SWE')
  })

  it('falls back to "Audio N" when no title or lang', () => {
    expect(audioStreamLabel({ ...base, index: 2 })).toBe('Audio 2')
  })

  it('appends 5.1 for 6 channels', () => {
    expect(audioStreamLabel({ ...base, lang: 'eng', channels: 6, codec: 'ac3' })).toBe('ENG · 5.1 AC3')
  })

  it('appends 7.1 for 8 channels', () => {
    expect(audioStreamLabel({ ...base, lang: 'eng', channels: 8 })).toBe('ENG · 7.1')
  })

  it('appends Stereo for 2 channels', () => {
    expect(audioStreamLabel({ ...base, lang: 'eng', channels: 2 })).toBe('ENG · Stereo')
  })

  it('appends Nch for other channel counts', () => {
    expect(audioStreamLabel({ ...base, lang: 'eng', channels: 4 })).toBe('ENG · 4ch')
  })

  it('appends codec uppercased', () => {
    expect(audioStreamLabel({ ...base, lang: 'eng', codec: 'eac3', channels: null })).toBe('ENG · EAC3')
  })
})

describe('subtitleStreamLabel', () => {
  const base: SubtitleStream = { index: 0, codec: null, lang: null, title: null }

  it('uses title if present', () => {
    expect(subtitleStreamLabel({ ...base, title: 'Forced English' })).toBe('Forced English')
  })

  it('uses lang uppercased when no title', () => {
    expect(subtitleStreamLabel({ ...base, lang: 'swe' })).toBe('SWE')
  })

  it('falls back to "Subtitle N" when neither', () => {
    expect(subtitleStreamLabel({ ...base, index: 3 })).toBe('Subtitle 3')
  })
})
