import { describe, it, expect } from 'vitest'
import { pickRecentlyAdded, type SeenRow } from './recentlyAdded'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_760_000_000_000

const rows = (...pairs: [string, number][]): SeenRow[] =>
  pairs.map(([id, firstSeenAt]) => ({ id, firstSeenAt }))

describe('pickRecentlyAdded', () => {
  it('says nothing on a fresh install', () => {
    // Every id arrived in the same first import. That is a library, not an
    // arrival, and the row it feeds hides itself on an empty result.
    expect(pickRecentlyAdded(rows(['a', NOW], ['b', NOW], ['c', NOW]), NOW)).toEqual([])
  })

  it('returns only what a later import brought', () => {
    const r = rows(['old1', NOW - 30 * DAY], ['old2', NOW - 30 * DAY], ['new', NOW - DAY])
    expect(pickRecentlyAdded(r, NOW)).toEqual(['new'])
  })

  it('orders newest first', () => {
    const r = rows(
      ['base', NOW - 40 * DAY],
      ['mid', NOW - 10 * DAY],
      ['newest', NOW - DAY],
      ['older', NOW - 20 * DAY],
    )
    expect(pickRecentlyAdded(r, NOW)).toEqual(['newest', 'mid', 'older'])
  })

  it('stops calling a stale delivery recent', () => {
    // The original bug in a different shape: a library that stopped being
    // updated would otherwise present its last delivery as new indefinitely.
    const r = rows(['base', NOW - 400 * DAY], ['stale', NOW - 90 * DAY])
    expect(pickRecentlyAdded(r, NOW)).toEqual([])
    expect(pickRecentlyAdded(r, NOW, 120)).toEqual(['stale'])
  })

  it('handles an empty history', () => {
    expect(pickRecentlyAdded([], NOW)).toEqual([])
  })

  it('ignores a duplicated baseline row', () => {
    // getRecentlyAddedIds prepends the oldest row to the pool it queried, so the
    // baseline can appear twice.
    const r = rows(['base', NOW - 50 * DAY], ['base', NOW - 50 * DAY], ['new', NOW - 2 * DAY])
    expect(pickRecentlyAdded(r, NOW)).toEqual(['new'])
  })
})
