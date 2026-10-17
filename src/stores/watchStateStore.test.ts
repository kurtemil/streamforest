import { describe, expect, it } from 'vitest'
import { buildEpisodeIndex, summarizeWatched } from './watchStateStore'
import type { Channel, WatchProgress } from '@/types'

const ep = (id: string, showName: string): Channel =>
  ({ id, name: `${showName} ${id}`, url: '', logo: '', groupTitle: 'Series: Drama', type: 'series', sortIndex: 0, showName }) as Channel
const film = (id: string): Channel =>
  ({ id, name: id, url: '', logo: '', groupTitle: 'VOD: Film', type: 'movie', sortIndex: 0 }) as Channel
const row = (channelId: string, completed: boolean, position = 100): WatchProgress =>
  ({ id: `p:${channelId}`, profileId: 'p', channelId, position, duration: 1000, lastWatched: 1, completed })

describe('summarizeWatched', () => {
  const channels = [ep('s1', 'Severance'), ep('s2', 'Severance'), ep('s3', 'Severance'), ep('d1', 'Dark'), film('m1')]
  const index = buildEpisodeIndex(channels)

  it('counts finished episodes against how many the show has here', () => {
    const { shows } = summarizeWatched([row('s1', true), row('s2', false), row('d1', true)], index)
    expect(shows.get('severance')).toBe('1/3')
    expect(shows.get('dark')).toBe('1/1')
  })

  it('says nothing about a show where nothing is finished, so its card stays unmarked', () => {
    const { shows } = summarizeWatched([row('s1', false)], index)
    expect(shows.has('severance')).toBe(false)
  })

  it('keeps every row by channel, films included', () => {
    const { byId } = summarizeWatched([row('m1', true), row('s2', false, 300)], index)
    expect(byId.get('m1')?.completed).toBe(true)
    expect(byId.get('s2')?.position).toBe(300)
  })

  it('never claims more than the show has when the catalogue lost episodes', () => {
    const smaller = buildEpisodeIndex([ep('s1', 'Severance')])
    const { shows } = summarizeWatched([row('s1', true), row('s2', true)], smaller)
    expect(shows.get('severance')).toBe('1/1')
  })
})
