import { parseM3ULines } from './m3uParser'
import { db, finishPlaylistSave, startPlaylistSave } from './db'
import type { Channel } from '@/types'
import type { WorkerRequest, WorkerResponse } from '@/workers/m3u.worker'
import { t } from '@/lib/i18n'

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

/**
 * Download the playlist and store it.
 *
 * The download and the parse happen in a worker, and entries are written to
 * IndexedDB as they arrive rather than after the whole file has been read. The
 * previous version held every line of a 60 MB file in one array before parsing
 * any of it, which froze the tab on a desktop and very likely exceeded what a
 * phone would allow at all.
 *
 * Falls back to the inline path if a worker cannot be constructed, so an
 * unusual browser degrades to slow rather than broken.
 */
export async function fetchAndStorePlaylist(
  m3uUrl: string,
  onProgress: (p: FetchProgress) => void,
): Promise<Channel[]> {
  onProgress({ phase: 'downloading', dlBytes: 0, dlTotal: 0, savePct: 0 })

  let worker: Worker
  try {
    worker = new Worker(new URL('../workers/m3u.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return fetchAndStorePlaylistInline(m3uUrl, onProgress)
  }

  try {
    return await new Promise<Channel[]>((resolve, reject) => {
      const channels: Channel[] = []
      // Writes are chained rather than awaited per message, so the worker is
      // never blocked by IndexedDB and the batches still land in order.
      let writes: Promise<unknown> = startPlaylistSave()
      let dlBytes = 0
      let dlTotal = 0

      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          dlBytes = msg.dlBytes
          dlTotal = msg.dlTotal
          onProgress({ phase: 'downloading', dlBytes, dlTotal, savePct: 0 })
          return
        }
        if (msg.type === 'channels') {
          channels.push(...msg.batch)
          const batch = msg.batch
          writes = writes.then(() => db.channels.bulkPut(batch))
          return
        }
        if (msg.type === 'done') {
          onProgress({ phase: 'saving', dlBytes, dlTotal, savePct: 90 })
          writes
            .then(() => finishPlaylistSave(channels, m3uUrl))
            .then(() => {
              onProgress({ phase: 'done', dlBytes, dlTotal, savePct: 100 })
              resolve(channels)
            })
            .catch(reject)
          return
        }
        reject(new Error(msg.message))
      }
      worker.onerror = () => reject(new Error(t('playlist.errWorker')))

      const req: WorkerRequest = { type: 'fetch', url: m3uUrl, proxyPath: PROXY_BASE }
      worker.postMessage(req)
    })
  } finally {
    worker.terminate()
  }
}

/** The original single-threaded path, kept as a fallback. */
async function fetchAndStorePlaylistInline(
  m3uUrl: string,
  onProgress: (p: FetchProgress) => void,
): Promise<Channel[]> {
  let response: Response
  try {
    response = await fetch(proxyUrl(m3uUrl))
  } catch {
    throw new Error(t('playlist.errNetwork'))
  }
  if (!response.ok) throw new Error(t('playlist.errStatus', { status: response.status }))

  const dlTotal = parseInt(response.headers.get('content-length') ?? '0')
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let dlBytes = 0
  const allLines: string[] = []

  for (;;) {
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

  const channels = parseM3ULines(allLines)
  onProgress({ phase: 'saving', dlBytes, dlTotal, savePct: 0 })
  await startPlaylistSave()
  await db.channels.bulkPut(channels)
  await finishPlaylistSave(channels, m3uUrl)
  onProgress({ phase: 'done', dlBytes, dlTotal, savePct: 100 })
  return channels
}
