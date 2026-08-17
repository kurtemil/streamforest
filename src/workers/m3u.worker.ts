/// <reference lib="webworker" />
// Downloads and parses the playlist off the main thread.
//
// This used to run inline: every line of a 60 MB file was pushed into one array
// — hundreds of thousands of JavaScript strings held at once — then parsed in a
// single synchronous pass, and only then written to IndexedDB. On a desktop that
// is a freeze; on a phone it is a few hundred megabytes of heap in a tab with a
// hard budget, which is the likeliest reason the playlist could not be refreshed
// from one at all.
//
// Here nothing accumulates: lines are parsed as they arrive and posted onward in
// batches, so peak memory is a batch rather than a file.

import { createM3UParser } from '@/services/m3uParser'
import type { Channel } from '@/types'

export type WorkerRequest = { type: 'fetch'; url: string; proxyPath: string }

export type WorkerResponse =
  | { type: 'progress'; dlBytes: number; dlTotal: number }
  | { type: 'channels'; batch: Channel[] }
  | { type: 'done'; total: number }
  | { type: 'error'; message: string }

// Large enough that postMessage overhead is negligible, small enough that the
// main thread gets a chance to write and paint between batches.
const BATCH_SIZE = 2000

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type !== 'fetch') return
  const { url, proxyPath } = e.data

  const post = (msg: WorkerResponse) => ctx.postMessage(msg)

  try {
    const res = await fetch(`${proxyPath}?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`Server returned ${res.status}`)
    if (!res.body) throw new Error('Playlist response had no body')

    const dlTotal = parseInt(res.headers.get('content-length') ?? '0')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createM3UParser()

    let dlBytes = 0
    let remainder = ''
    let pending: Channel[] = []
    let total = 0
    let lastProgress = 0

    const flush = (force: boolean) => {
      if (pending.length === 0) return
      if (!force && pending.length < BATCH_SIZE) return
      post({ type: 'channels', batch: pending })
      total += pending.length
      pending = []
    }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      dlBytes += value.length
      // stream: true keeps a multi-byte character split across chunks intact.
      const text = remainder + decoder.decode(value, { stream: true })
      const lastNewline = text.lastIndexOf('\n')
      if (lastNewline === -1) {
        // No complete line yet — hold it and read more.
        remainder = text
        continue
      }
      remainder = text.slice(lastNewline + 1)
      pending.push(...parser.push(text.slice(0, lastNewline).split('\n')))
      flush(false)

      // Progress at ~30fps rather than per chunk; the receiver only paints a bar.
      const now = Date.now()
      if (now - lastProgress > 32) {
        lastProgress = now
        post({ type: 'progress', dlBytes, dlTotal })
      }
    }

    remainder += decoder.decode()
    if (remainder.trim()) pending.push(...parser.push(remainder.split('\n')))
    flush(true)

    post({ type: 'progress', dlBytes, dlTotal })
    post({ type: 'done', total })
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : 'Network error — check your connection or M3U URL',
    })
  }
}
