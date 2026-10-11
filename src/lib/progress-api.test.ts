// /api/progress against a fake D1: single rows as before, and lists for marking a
// whole season or show watched. Lives here because every file in functions/ is a route.
import { describe, expect, it } from 'vitest'
import { onRequest } from '../../functions/api/progress'

function fakeDb() {
  const batches: unknown[][][] = []
  const stmt = (sql: string) => {
    const s = {
      sql,
      args: [] as unknown[],
      bind(...a: unknown[]) { return { ...s, args: a } },
      async run() { return {} },
      async all() { return { results: [] } },
      async first() { return null },
    }
    return s
  }
  return {
    batches,
    db: {
      prepare: stmt,
      async batch(list: { args: unknown[] }[]) { batches.push(list.map((x) => x.args)); return [] },
    },
  }
}

const call = (env: unknown, method: string, query: string, body?: unknown) =>
  onRequest({
    request: new Request(`https://x/api/progress${query}`, { method, body: body ? JSON.stringify(body) : undefined }),
    env: env as never,
  })

const entry = (channelId: string) => ({ profileId: 'elof', channelId, position: 10, duration: 10, lastWatched: 1, completed: true })

describe('/api/progress', () => {
  it('writes one entry as before', async () => {
    const f = fakeDb()
    expect((await call({ DB: f.db }, 'PUT', '', entry('m1'))).status).toBe(200)
    expect(f.batches).toEqual([[['elof', 'm1', 10, 10, 1, 1]]])
  })

  it('writes a list in one batch — a whole season marked watched is one request', async () => {
    const f = fakeDb()
    await call({ DB: f.db }, 'PUT', '', [entry('e1'), entry('e2'), entry('e3')])
    expect(f.batches).toHaveLength(1)
    expect(f.batches[0].map((args) => args[1])).toEqual(['e1', 'e2', 'e3'])
  })

  it('deletes one by query, or many from a JSON body', async () => {
    const f = fakeDb()
    await call({ DB: f.db }, 'DELETE', '?profileId=elof&channelId=m1')
    await call({ DB: f.db }, 'DELETE', '?profileId=elof', { channelIds: ['e1', 'e2'] })
    expect(f.batches).toEqual([[['elof', 'm1']], [['elof', 'e1'], ['elof', 'e2']]])
    expect((await call({ DB: f.db }, 'DELETE', '?profileId=elof')).status).toBe(400)
  })
})
