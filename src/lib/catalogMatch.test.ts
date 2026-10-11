import { describe, expect, it } from 'vitest'
import { buildMovieIndex, buildShowIndex, matchMovies, matchShows, titleKey } from './catalogMatch'
import type { Channel } from '@/types'
import type { TmdbListItem } from '@/services/tmdb'

const movie = (id: string, title: string, year: number | undefined, groupTitle = 'Movies'): Channel =>
  ({ id, type: 'movie', name: title, movieTitle: title, year, groupTitle, url: '', logo: '', sortIndex: 0 }) as Channel
const episode = (id: string, showName: string, groupTitle = 'Series'): Channel =>
  ({ id, type: 'series', name: `${showName} - S01E01`, showName, season: 1, episode: 1, groupTitle, url: '', logo: '', sortIndex: 0 }) as Channel
const item = (title: string, originalTitle: string, year: number | null): TmdbListItem =>
  ({ tmdbId: 1, title, originalTitle, year, posterPath: null, backdropPath: null, rating: 7, overview: '' })
const all = () => true

describe('titleKey', () => {
  it('ignores case, accents, punctuation, "&" and a leading "The"', () => {
    expect(titleKey('The Matrix')).toBe(titleKey('matrix'))
    expect(titleKey('Amélie')).toBe('amelie')
    expect(titleKey('Robot & Frank')).toBe(titleKey('Robot and Frank'))
    expect(titleKey('Spider-Man: No Way Home')).toBe('spider man no way home')
  })
})

describe('matchMovies', () => {
  const index = buildMovieIndex([
    movie('m1', 'Troy', 2004), movie('m2', 'Troy', 2004, 'VOD: 4K'), movie('m3', 'Dune', 1984),
    movie('m4', 'Dune', 2021), movie('m5', 'Barbie', 2023, 'Hidden'),
  ])
  it('finds a film by its original title when the localised one differs, in list order', () => {
    const r = matchMovies([item('Troja', 'Troy', 2004), item('Dune: Del ett', 'Dune', 2021)], index, all)
    expect(r.map((x) => x.channel.id)).toEqual(['m1', 'm4'])
  })
  it('requires the year to agree within one, so a remake does not stand in for the original', () => {
    expect(matchMovies([item('Dune', 'Dune', 2021)], index, all).map((x) => x.channel.id)).toEqual(['m4'])
    expect(matchMovies([item('Dune', 'Dune', 1990)], index, all)).toEqual([])
  })
  it('skips what the profile may not see', () => {
    expect(matchMovies([item('Barbie', 'Barbie', 2023)], index, (ch) => ch.groupTitle !== 'Hidden')).toEqual([])
  })
})

describe('matchShows', () => {
  it('finds a show once, by localised or original name, and gives the Series page key', () => {
    const index = buildShowIndex([episode('e1', 'The Penguin'), episode('e2', 'The Penguin'), episode('e3', 'Bäckström')])
    const r = matchShows([item('Pingvinen', 'The Penguin', 2024), item('Backstrom', 'Bäckström', 2020), item('X', 'Nope', 2020)], index, all)
    expect(r.map((x) => x.channel.id)).toEqual(['e1', 'e3'])
    expect(r[0].showKey).toBe('the penguin')
  })
})
