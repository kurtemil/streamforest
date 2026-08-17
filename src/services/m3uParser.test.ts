import { describe, it, expect } from 'vitest'
import { parseM3ULines, createM3UParser } from './m3uParser'
import type { Channel } from '@/types'

// Every name below is a real entry from the production playlist. The URLs are
// not: provider URLs carry the subscription username and password in the path,
// so they are replaced with a placeholder host here.
//
// This file is a characterisation test. It records what the seven series regexes
// currently do — including where they do it imperfectly — so that touching one
// pattern shows immediately which of the other 160 000 entries changed shape.

const HOST = 'http://example.invalid:2095/USER/PASS'

function entry(name: string, group: string, url: string): string[] {
  return [`#EXTINF:-1 tvg-id="" tvg-name="${name}" tvg-logo="" group-title="${group}",${name}`, url]
}

function parseOne(name: string, group: string, url: string): Channel {
  const [channel] = parseM3ULines(entry(name, group, url))
  return channel
}

function series(name: string, id = '336268'): Channel {
  return parseOne(name, 'Series: English [Multi-Sub]', `${HOST}/series/${id}.mkv`)
}

// ── Series naming formats found in the wild ───────────────────────────────────

const SERIES_NAMES = [
  // "Show S01 Show - S01E02 - Title" — by far the most common provider format
  'Helstrom S01 Helstrom - S01E01 - Mother’s Little Helpers',
  // same, without an episode title
  'Helstrom S01 Helstrom - S01E09',
  // show name containing a comma
  'Love, Victor S03 Love, Victor - S03E01',
  // dot separators inside the show name
  'The.Blacklist ar S01 The.Blacklist - S01E01',
  // letter-O typo in the season code, plus a trailing language tag
  'Leif & Billy S01 Leif Och Billy SO1E01 SE',
  // multi-episode files, both separators the provider uses
  'Mr. Robot S02 Mr. Robot - S02E01-E02',
  'Paw Patrol S09 PAW Patrol - S09E01-02',
  // parenthesised suffix on the episode title
  'American Song Contest S01 American Song Contest - S01E07 - The Live Semi-Finals (2)',
  'Law & Order: Organized Crime S03 Law & Order: Organized Crime - S03E01 - Gimme Shelter (I)',
  // space between the season and episode codes
  'Wanderlust S01 Wanderlust S01 E01',
  // season with no episode number at all
  'Morden i Sandhamn S01 Morden I Sandhamn S01',
] as const

describe('parseM3ULines — series', () => {
  it('matches the whole corpus of real naming formats', () => {
    const parsed = SERIES_NAMES.map((name) => {
      const c = series(name)
      return {
        name,
        showName: c.showName ?? null,
        season: c.season ?? null,
        episode: c.episode ?? null,
        episodeTitle: c.episodeTitle ?? null,
      }
    })
    expect(parsed).toMatchSnapshot()
  })

  it('extracts show, season, episode and title from the dominant format', () => {
    const c = series('Helstrom S01 Helstrom - S01E01 - Mother’s Little Helpers')
    expect(c.showName).toBe('Helstrom')
    expect(c.season).toBe(1)
    expect(c.episode).toBe(1)
    expect(c.episodeTitle).toBe('Mother’s Little Helpers')
  })

  it('leaves episodeTitle undefined when the name has none', () => {
    const c = series('Helstrom S01 Helstrom - S01E09')
    expect(c.showName).toBe('Helstrom')
    expect(c.episode).toBe(9)
    expect(c.episodeTitle).toBeUndefined()
  })

  it('keeps a comma inside the show name', () => {
    const c = series('Love, Victor S03 Love, Victor - S03E01')
    expect(c.showName).toBe('Love, Victor')
    expect(c.season).toBe(3)
  })

  it('turns dot separators into spaces', () => {
    const c = series('The.Blacklist ar S01 The.Blacklist - S01E01')
    expect(c.showName).toBe('The Blacklist ar')
  })

  it('corrects the letter-O season typo and strips a trailing language tag', () => {
    const c = series('Leif & Billy S01 Leif Och Billy SO1E01 SE')
    expect(c.showName).toBe('Leif & Billy')
    expect(c.season).toBe(1)
    expect(c.episode).toBe(1)
  })

  it('reduces a multi-episode file to its first episode', () => {
    expect(series('Mr. Robot S02 Mr. Robot - S02E01-E02').episode).toBe(1)
    expect(series('Paw Patrol S09 PAW Patrol - S09E01-02').episode).toBe(1)
  })

  it('does not split "Mr. Robot" on its abbreviating dot', () => {
    expect(series('Mr. Robot S02 Mr. Robot - S02E01-E02').showName).toBe('Mr. Robot')
  })

  it('keeps a colon inside the show name', () => {
    const c = series('Law & Order: Organized Crime S03 Law & Order: Organized Crime - S03E01 - Gimme Shelter (I)')
    expect(c.showName).toBe('Law & Order: Organized Crime')
    expect(c.season).toBe(3)
    expect(c.episode).toBe(1)
  })

  it('decodes HTML entities in the name', () => {
    expect(series('Tom &amp; Jerry S01 Tom &amp; Jerry - S01E03').showName).toBe('Tom & Jerry')
  })
})

// ── Movies ────────────────────────────────────────────────────────────────────

function movie(name: string): Channel {
  return parseOne(name, 'VOD: Premiere Cinemas [Multi-Sub]', `${HOST}/movie/67227.mkv`)
}

describe('parseM3ULines — movies', () => {
  it('splits the year out of the title', () => {
    const c = movie('The Players [PRE] [2020]')
    expect(c.movieTitle).toBe('The Players')
    expect(c.year).toBe(2020)
  })

  it('uses the last year when a title contains two', () => {
    expect(movie('Blade Runner [1982] [2019]').year).toBe(2019)
  })

  it('leaves year undefined when there is none', () => {
    const c = movie('Tiger Shark Terror')
    expect(c.movieTitle).toBe('Tiger Shark Terror')
    expect(c.year).toBeUndefined()
  })
})

// ── Type detection, ids and skips ─────────────────────────────────────────────

describe('parseM3ULines — classification', () => {
  it('reads the type from the group prefix', () => {
    expect(parseOne('X', 'VOD: Action', `${HOST}/movie/1.mkv`).type).toBe('movie')
    expect(parseOne('X S01 X - S01E01', 'Series: Drama', `${HOST}/series/1.mkv`).type).toBe('series')
    expect(parseOne('SVT1', 'Sweden', `${HOST}/8102`).type).toBe('live')
  })

  it('falls back to the URL path when the group says nothing', () => {
    expect(parseOne('X', 'Random', `${HOST}/movie/1.mkv`).type).toBe('movie')
    expect(parseOne('X S01 X - S01E01', 'Random', `${HOST}/series/1.mkv`).type).toBe('series')
  })

  it('prefixes ids by type, so the provider id namespaces cannot collide', () => {
    expect(parseOne('X', 'VOD: A', `${HOST}/movie/4711.mkv`).id).toBe('m_4711')
    expect(parseOne('X S01 X - S01E01', 'Series: A', `${HOST}/series/4711.mkv`).id).toBe('s_4711')
    expect(parseOne('X', 'Sweden', `${HOST}/4711`).id).toBe('l_4711')
  })

  it('skips the "-= … =-" separator rows providers use as headings', () => {
    const lines = [
      ...entry('-= Sweden =-', 'Sweden', `${HOST}/8102`),
      ...entry('SVT1 HD', 'Sweden', `${HOST}/61182`),
    ]
    const parsed = parseM3ULines(lines)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('SVT1 HD')
  })

  it('assigns sortIndex in playlist order', () => {
    const lines = [
      ...entry('A', 'Sweden', `${HOST}/1`),
      ...entry('B', 'Sweden', `${HOST}/2`),
      ...entry('C', 'Sweden', `${HOST}/3`),
    ]
    expect(parseM3ULines(lines).map((c) => c.sortIndex)).toEqual([0, 1, 2])
  })

  it('ignores an #EXTINF with no URL after it', () => {
    const lines = ['#EXTINF:-1 group-title="Sweden",Orphan', '#EXTINF:-1 group-title="Sweden",Real', `${HOST}/1`]
    const parsed = parseM3ULines(lines)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('Real')
  })

  it('carries tvg-id through when present, and omits it when blank', () => {
    const withId = parseM3ULines([
      `#EXTINF:-1 tvg-id="svt1.se" tvg-logo="" group-title="Sweden",SVT1`,
      `${HOST}/1`,
    ])[0]
    expect(withId.tvgId).toBe('svt1.se')
    expect(parseOne('SVT1', 'Sweden', `${HOST}/1`).tvgId).toBeUndefined()
  })
})

// ── Incremental parsing ───────────────────────────────────────────────────────

describe('createM3UParser', () => {
  const lines = [
    ...entry('Arrival [2016]', 'VOD: Sci-Fi', `${HOST}/movie/1.mkv`),
    ...entry('Helstrom S01 Helstrom - S01E01 - Mother’s Little Helpers', 'Series: Drama', `${HOST}/series/2.mkv`),
    ...entry('-= Sweden =-', 'Sweden', `${HOST}/3`),
    ...entry('SVT1 HD', 'Sweden', `${HOST}/4`),
    ...entry('Dune [2021]', 'VOD: Sci-Fi', `${HOST}/movie/5.mkv`),
  ]

  it('matches the one-shot parser regardless of where the stream is split', () => {
    const expected = parseM3ULines(lines)
    // Every split point, including ones that cut between an #EXTINF and its URL —
    // which is exactly what a network chunk boundary does.
    for (let split = 0; split <= lines.length; split++) {
      const parser = createM3UParser()
      const streamed = [
        ...parser.push(lines.slice(0, split)),
        ...parser.push(lines.slice(split)),
      ]
      expect(streamed, `split at ${split}`).toEqual(expected)
    }
  })

  it('numbers sortIndex continuously across batches', () => {
    const parser = createM3UParser()
    const first = parser.push(lines.slice(0, 4))
    const rest = parser.push(lines.slice(4))
    expect([...first, ...rest].map((c) => c.sortIndex)).toEqual([0, 1, 2, 3])
  })

  it('emits nothing for a batch that ends mid-entry', () => {
    const parser = createM3UParser()
    expect(parser.push([lines[0]])).toEqual([])
    expect(parser.push([lines[1]])).toHaveLength(1)
  })
})
