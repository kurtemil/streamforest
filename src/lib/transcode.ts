const MKV_EXT = /\.mkv(\?.*)?$/i

// Audio codecs Chrome can't play in MP4/MKV natively. Only MKVs with these
// need the ffmpeg transcode detour; AAC/MP3 MKVs play fine via the <video> tag.
const UNSUPPORTED_AUDIO_CODECS = new Set([
  'ac3', 'eac3', 'dts', 'truehd', 'mlp', 'dtshd',
])

export interface MediaInfo {
  duration: number | null
  audioCodec: string | null
  videoCodec: string | null
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

export function transcodeUrl(url: string, startSeconds = 0): string {
  const base = proxyBase()
  if (!base) return url
  const params = new URLSearchParams({ url })
  if (startSeconds > 0) params.set('start', String(Math.floor(startSeconds)))
  return `${base}/transcode?${params.toString()}`
}

export async function probeMedia(url: string, signal?: AbortSignal): Promise<MediaInfo | null> {
  const base = proxyBase()
  if (!base) return null
  try {
    const res = await fetch(`${base}/probe?${new URLSearchParams({ url }).toString()}`, { signal })
    if (!res.ok) return null
    const data = (await res.json()) as Partial<MediaInfo>
    return {
      duration: typeof data.duration === 'number' && isFinite(data.duration) ? data.duration : null,
      audioCodec: typeof data.audioCodec === 'string' ? data.audioCodec : null,
      videoCodec: typeof data.videoCodec === 'string' ? data.videoCodec : null,
    }
  } catch {
    return null
  }
}

export function needsTranscode(info: MediaInfo | null): boolean {
  if (!info?.audioCodec) return false
  return UNSUPPORTED_AUDIO_CODECS.has(info.audioCodec.toLowerCase())
}
