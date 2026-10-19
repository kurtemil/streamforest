import { describe, expect, it } from 'vitest'
import { playsHlsItself } from './nativeHls'

const says = (answer: string) => ({ canPlayType: () => answer as CanPlayTypeResult })

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
  // An iPad asks for the desktop site by default and says it is a Mac.
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  kiosk: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.79 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
}

describe('playsHlsItself', () => {
  it('lets Apple play it, in every iOS browser and in Safari', () => {
    expect(playsHlsItself(says('maybe'), UA.iphoneSafari)).toBe(true)
    expect(playsHlsItself(says('maybe'), UA.iphoneChrome)).toBe(true)
    expect(playsHlsItself(says('maybe'), UA.ipadDesktop)).toBe(true)
  })

  it('keeps Chromium on hls.js even when it says maybe — the kiosk could not parse the playlist', () => {
    expect(playsHlsItself(says('maybe'), UA.kiosk)).toBe(false)
    expect(playsHlsItself(says('maybe'), UA.macChrome)).toBe(false)
    expect(playsHlsItself(says('maybe'), UA.windowsEdge)).toBe(false)
  })

  it('never claims what the element denies', () => {
    expect(playsHlsItself(says(''), UA.iphoneSafari)).toBe(false)
  })
})
