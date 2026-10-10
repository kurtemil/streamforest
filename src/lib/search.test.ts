import { describe, expect, it } from 'vitest'
import { searchCatalogue } from './search'
import type { Channel } from '@/types'

const ch = (id: string, type: Channel['type'], name: string, groupTitle: string, extra: Partial<Channel> = {}): Channel =>
  ({ id, type, name, groupTitle, url: `http://x/${id}`, logo: '', sortIndex: 0, ...extra }) as Channel

const catalogue: Channel[] = [
  ch('m1', 'movie', 'American Psycho', 'VOD: Old Popular Movies', { movieTitle: 'American Psycho', year: 2000 }),
  ch('m2', 'movie', 'American Tail', 'VOD: Kids Movies', { movieTitle: 'An American Tail' }),
  ch('s1', 'series', 'American Dad S01E01', 'Series: English', { showName: 'American Dad' }),
  ch('l1', 'live', 'American Heroes', 'Live: Documentary'),
]
const labels = { movie: 'Film', show: 'Serie' }
const none = { movie: new Set<string>(), series: new Set<string>(), live: new Set<string>() }

describe('searchCatalogue', () => {
  it('finds movies, shows and channels', () => {
    const r = searchCatalogue(catalogue, 'american', none, labels)
    expect(r.movies.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(r.series.map((s) => s.title)).toEqual(['American Dad'])
    expect(r.live.map((l) => l.id)).toEqual(['l1'])
  })

  it('hides what the profile may not see — the leak that let a kid play a blocked film', () => {
    const kid = {
      movie: new Set(['VOD: Old Popular Movies']),
      series: new Set(['Series: English']),
      live: new Set(['Live: Documentary']),
    }
    const r = searchCatalogue(catalogue, 'american', kid, labels)
    expect(r.movies.map((m) => m.id)).toEqual(['m2'])
    expect(r.series).toEqual([])
    expect(r.live).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    expect(searchCatalogue(catalogue, '  ', none, labels)).toEqual({ movies: [], series: [], live: [] })
  })
})
