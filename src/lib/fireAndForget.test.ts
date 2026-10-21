import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireAndForget } from './fireAndForget'

describe('fireAndForget', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('cancels the body nobody reads, so it does not hold a file open', async () => {
    const cancel = vi.fn(async () => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ body: { cancel } })))
    await fireAndForget('/api/bion', { method: 'PUT' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('never fails, offline or not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fireAndForget('/api/progress')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', vi.fn(async () => ({ body: null })))
    await expect(fireAndForget('/api/progress')).resolves.toBeUndefined()
  })
})
