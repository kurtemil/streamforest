import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { untilCurrent } from './launchUpdate'

class FakeWorker extends EventTarget {
  state = 'installing'
  become(state: string) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

function registrationWith(update: () => Promise<unknown>, installing: FakeWorker | null = null) {
  return { update: vi.fn(update), installing, waiting: null } as unknown as ServiceWorkerRegistration
}

const ms = { check: 3000, install: 20_000 }

describe('untilCurrent', () => {
  let container: EventTarget
  let reload: ReturnType<typeof vi.fn<() => void>>
  let settled: boolean
  const track = (p: Promise<void>) => { void p.then(() => { settled = true }); return p }

  beforeEach(() => {
    vi.useFakeTimers()
    container = new EventTarget()
    vi.stubGlobal('navigator', { serviceWorker: container })
    reload = vi.fn<() => void>()
    settled = false
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lets the app start when the copy is the deployed build', async () => {
    await untilCurrent(Promise.resolve(registrationWith(async () => {})), reload, ms)
    expect(reload).not.toHaveBeenCalled()
  })

  it('lets the app start offline, and without a worker', async () => {
    await untilCurrent(Promise.resolve(registrationWith(async () => { throw new Error('offline') })), reload, ms)
    await untilCurrent(Promise.resolve(undefined), reload, ms)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stops waiting for an answer that does not come', async () => {
    track(untilCurrent(Promise.resolve(registrationWith(() => new Promise(() => {}))), reload, ms))
    await vi.advanceTimersByTimeAsync(2900)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(settled).toBe(true)
  })

  it('also when the registration itself never comes', async () => {
    track(untilCurrent(new Promise(() => {}), reload, ms))
    await vi.advanceTimersByTimeAsync(3100)
    expect(settled).toBe(true)
  })

  it('holds the app back while a new version installs, and reloads into it', async () => {
    const worker = new FakeWorker()
    track(untilCurrent(Promise.resolve(registrationWith(async () => {}, worker)), reload, ms))
    await vi.advanceTimersByTimeAsync(5000)
    expect(settled).toBe(false)
    worker.become('activated')
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
  })

  it('lets the app start when the new version fails to install', async () => {
    const worker = new FakeWorker()
    track(untilCurrent(Promise.resolve(registrationWith(async () => {}, worker)), reload, ms))
    await vi.advanceTimersByTimeAsync(100)
    worker.become('redundant')
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('and when it takes too long', async () => {
    track(untilCurrent(Promise.resolve(registrationWith(async () => {}, new FakeWorker())), reload, ms))
    await vi.advanceTimersByTimeAsync(19_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toBe(true)
  })
})
