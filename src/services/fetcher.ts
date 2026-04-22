import { parseM3ULines } from './m3uParser'
import { saveChannels } from './db'
import type { Channel } from '@/types'

export type FetchProgress = {
  phase: 'downloading' | 'saving' | 'done' | 'error'
  // Download phase
  dlBytes: number
  dlTotal: number    // 0 if Content-Length unknown
  // Save phase (0–100, only valid when phase === 'saving')
  savePct: number
}

const PROXY_BASE = '/proxy'

export function proxyUrl(target: string) {
  return `${PROXY_BASE}?url=${encodeURIComponent(target)}`
}

export async function fetchAndStorePlaylist(
  m3uUrl: string,
  onProgress: (p: FetchProgress) => void,
): Promise<Channel[]> {
  onProgress({ phase: 'downloading', dlBytes: 0, dlTotal: 0, savePct: 0 })

  let response: Response
  try {
    response = await fetch(proxyUrl(m3uUrl))
  } catch {
    throw new Error('Network error — check your connection or M3U URL')
  }

  if (!response.ok) {
    throw new Error(`Server returned ${response.status}`)
  }

  const dlTotal = parseInt(response.headers.get('content-length') ?? '0')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let dlBytes = 0
  const allLines: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    dlBytes += value.length
    buffer += decoder.decode(value, { stream: true })

    const newlineIdx = buffer.lastIndexOf('\n')
    if (newlineIdx >= 0) {
      allLines.push(...buffer.slice(0, newlineIdx + 1).split('\n'))
      buffer = buffer.slice(newlineIdx + 1)
    }

    onProgress({ phase: 'downloading', dlBytes, dlTotal, savePct: 0 })
  }
  if (buffer) allLines.push(buffer)

  // Parse synchronously (fast, no I/O)
  const channels = parseM3ULines(allLines)

  // Save to IndexedDB with chunked progress
  onProgress({ phase: 'saving', dlBytes, dlTotal, savePct: 0 })
  await saveChannels(channels, m3uUrl, (savePct) => {
    onProgress({ phase: 'saving', dlBytes, dlTotal, savePct })
  })

  onProgress({ phase: 'done', dlBytes, dlTotal, savePct: 100 })
  return channels
}
