import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHomeLibraryStore } from './homeLibraryStore'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) },
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size },
  }
}

function withPermission(state: PermissionState | null) {
  vi.stubGlobal('navigator', {
    userAgent: 'test',
    permissions: {
      query: async () => {
        if (!state) throw new TypeError('unknown permission')
        return { state, addEventListener() {}, removeEventListener() {} }
      },
    },
  })
}

describe('home library store', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/System/Info/Public')) return new Response('{}')
      if (url.endsWith('/Users/AuthenticateByName')) return new Response(JSON.stringify({ AccessToken: 't', User: { Id: 'u' } }))
      return new Response(JSON.stringify({ Items: [{ Id: 'm1', Name: 'Ice Age 4', Type: 'Movie' }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    useHomeLibraryStore.setState({ status: 'unknown', profileId: null, userName: null, session: null, items: [], playing: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('says "blocked" without a single request when the browser was refused the home network', async () => {
    withPermission('denied')
    await useHomeLibraryStore.getState().load('vera', 'Vera')
    expect(useHomeLibraryStore.getState().status).toBe('blocked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the profile’s list when allowed, and where the browser does not ask at all (Safari)', async () => {
    for (const state of ['granted', null] as const) {
      withPermission(state)
      useHomeLibraryStore.setState({ profileId: null })
      await useHomeLibraryStore.getState().load('vera', 'Vera')
      expect(useHomeLibraryStore.getState()).toMatchObject({ status: 'ready', items: [expect.objectContaining({ name: 'Ice Age 4' })] })
    }
  })

  it('clears the previous profile’s titles before loading another', async () => {
    withPermission('granted')
    await useHomeLibraryStore.getState().load('elof', 'Elof')
    fetchMock.mockImplementation(async () => { throw new TypeError('offline') })
    const pending = useHomeLibraryStore.getState().load('vera', 'Vera')
    expect(useHomeLibraryStore.getState().items).toEqual([])
    await pending
    expect(useHomeLibraryStore.getState().status).toBe('unreachable')
  })
})
