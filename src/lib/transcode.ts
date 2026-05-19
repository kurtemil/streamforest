const MKV_EXT = /\.mkv(\?.*)?$/i

// Audio codecs Chrome can't play in MP4/MKV natively — must be re-encoded.
const UNSUPPORTED_AUDIO_CODECS = new Set([
  'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'dtshd',
])

// Video codecs the browser can stream-copy through an MP4 container. Anything
// outside this set forces a full re-encode (mode=transcode).
const COPY_SAFE_VIDEO_CODECS = new Set([
  'h264', 'hevc', 'h265', 'av1', 'vp9',
])

export interface AudioStream {
  index: number
  codec: string | null
  channels: number | null
  lang: string | null
  title: string | null
}

export interface SubtitleStream {
  index: number
  codec: string | null
  lang: string | null
  title: string | null
}

export interface MediaInfo {
  duration: number | null
  startTime: number  // format-level PTS start offset in seconds; 0 for files that begin at PTS 0
  audioCodec: string | null
  videoCodec: string | null
  audioStreams: AudioStream[]
  subtitleStreams: SubtitleStream[]
}

function proxyBase(): string | null {
  const base = import.meta.env.VITE_TRANSCODE_PROXY_URL as string | undefined
  if (!base) return null
  return base.replace(/\/+$/, '')
}

export function isTranscodeProxyConfigured(): boolean {
  return proxyBase() !== null
}

export function mightNeedTranscode(url: string): boolean {
  return MKV_EXT.test(url)
}

export type ProxyMode = 'copy' | 'transcode'

export interface TranscodeOptions {
  startSeconds?: number
  audioIndex?: number | null
  mode?: ProxyMode
  subtitleIndices?: number[]
  vstart?: number
}

export function transcodeUrl(url: string, opts: TranscodeOptions = {}): string {
  const base = proxyBase()
  if (!base) return url
  const params = new URLSearchParams({ url })
  if (opts.startSeconds && opts.startSeconds > 0) {
    params.set('start', String(Math.floor(opts.startSeconds)))
  }
  if (opts.audioIndex != null) {
    params.set('audio', String(opts.audioIndex))
  }
  if (opts.mode === 'copy') {
    params.set('mode', 'copy')
  }
  if (opts.subtitleIndices && opts.subtitleIndices.length > 0) {
    params.set('subs', opts.subtitleIndices.join(','))
  }
  if (opts.vstart && opts.vstart > 0.01) {
    params.set('vstart', String(opts.vstart))
  }
  return `${base}/transcode?${params.toString()}`
}

// Live MPEG-TS sources (Xtream Codes channels) get a stream-copy remux to
// fragmented MP4. No -ss (live), default to copy (cheap); transcode only if
// the upstream codecs aren't browser-compatible (AC3 audio, etc.).
export function liveStreamUrl(url: string, mode: ProxyMode = 'copy'): string | null {
  const base = proxyBase()
  if (!base) return null
  const params = new URLSearchParams({ url, live: '1' })
  if (mode === 'copy') params.set('mode', 'copy')
  return `${base}/transcode?${params.toString()}`
}

// Pick proxy mode from probe info: copy when the upstream codecs are
// browser-compatible (cheap remux, no re-encode), transcode otherwise.
export function pickProxyMode(info: MediaInfo | null): ProxyMode {
  if (!info) return 'transcode'
  const audio = info.audioCodec?.toLowerCase()
  const video = info.videoCodec?.toLowerCase()
  if (audio && UNSUPPORTED_AUDIO_CODECS.has(audio)) return 'transcode'
  if (video && !COPY_SAFE_VIDEO_CODECS.has(video)) return 'transcode'
  return 'copy'
}

export function subtitleVttUrl(url: string, index: number, vstart = 0, start = 0): string | null {
  const base = proxyBase()
  if (!base) return null
  const params = new URLSearchParams({ url, index: String(index) })
  if (vstart > 0) params.set('vstart', String(vstart))
  if (start > 0) params.set('start', String(Math.floor(start)))
  return `${base}/subtitle?${params.toString()}`
}

export async function getKeyframeTime(url: string, start: number): Promise<number> {
  const base = proxyBase()
  if (!base || start <= 0) return start
  try {
    const res = await fetch(
      `${base}/keyframe?${new URLSearchParams({ url, start: String(Math.floor(start)) }).toString()}`,
    )
    if (!res.ok) return start
    const data = (await res.json()) as { keyframe?: number }
    return typeof data.keyframe === 'number' && isFinite(data.keyframe) ? data.keyframe : start
  } catch {
    return start
  }
}

export function epgProxyUrl(url: string, force = false): string | null {
  const base = proxyBase()
  if (!base) return null
  const params = new URLSearchParams({ url })
  if (force) params.set('force', '1')
  return `${base}/epg?${params.toString()}`
}

export async function tmdbCacheGet(id: string): Promise<unknown> {
  const base = proxyBase()
  if (!base) return null
  try {
    const res = await fetch(`${base}/tmdb?${new URLSearchParams({ id }).toString()}`)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export function tmdbCachePut(meta: object): void {
  const base = proxyBase()
  if (!base) return
  fetch(`${base}/tmdb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  }).catch(() => {})
}

export async function probeMedia(url: string, signal?: AbortSignal): Promise<MediaInfo | null> {
  const base = proxyBase()
  if (!base) return null
  try {
    const res = await fetch(`${base}/probe?${new URLSearchParams({ url }).toString()}`, { signal })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.warn(`[probeMedia] proxy ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
      return null
    }
    const data = (await res.json()) as Partial<MediaInfo>
    return {
      duration: typeof data.duration === 'number' && isFinite(data.duration) ? data.duration : null,
      startTime: typeof data.startTime === 'number' && isFinite(data.startTime) ? data.startTime : 0,
      audioCodec: typeof data.audioCodec === 'string' ? data.audioCodec : null,
      videoCodec: typeof data.videoCodec === 'string' ? data.videoCodec : null,
      audioStreams: Array.isArray(data.audioStreams) ? data.audioStreams : [],
      subtitleStreams: Array.isArray(data.subtitleStreams) ? data.subtitleStreams : [],
    }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return null
    console.warn('[probeMedia] failed:', err)
    return null
  }
}

export function needsTranscode(info: MediaInfo | null): boolean {
  if (!info?.audioCodec) return false
  return UNSUPPORTED_AUDIO_CODECS.has(info.audioCodec.toLowerCase())
}

export function audioStreamLabel(s: AudioStream): string {
  const head = s.title ?? (s.lang ? s.lang.toUpperCase() : `Audio ${s.index}`)
  const meta: string[] = []
  if (s.channels === 6) meta.push('5.1')
  else if (s.channels === 8) meta.push('7.1')
  else if (s.channels === 2) meta.push('Stereo')
  else if (s.channels) meta.push(`${s.channels}ch`)
  if (s.codec) meta.push(s.codec.toUpperCase())
  return meta.length > 0 ? `${head} · ${meta.join(' ')}` : head
}

export function subtitleStreamLabel(s: SubtitleStream): string {
  if (s.title) return s.title
  if (s.lang) return s.lang.toUpperCase()
  return `Subtitle ${s.index}`
}
