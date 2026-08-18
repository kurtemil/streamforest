import { test } from './fixtures'

// A measurement, not a guard: it asserts nothing and is tagged @probe so the
// normal suite skips it. `npm run probe:scroll` runs it.
//
// It reports what is on the page and how long frames take while scrollTop is
// stepped from inside a rAF chain. Read it as a comparison, never as a frame
// rate: stepping scroll this way forces a layout every tick, so the absolute
// numbers are worse than real scrolling, and it measures the main thread rather
// than the compositor — it cannot see what a stack of backdrop-filters costs.
// What it is good for is A/B against the same page: build, measure, change one
// thing, measure again. That is how the Ken Burns animation was found, at 47ms a
// frame against 16 with it gated off.
//
// Measure the production build. `npm run build` then `npx vite preview --port
// 5173` before running it, or Playwright starts the dev server and React's
// StrictMode double-renders everything you are trying to measure.
const PAGES = ['/', '/movies', '/live'] as const

test.describe('scroll cost @probe', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-shaped only')

  for (const path of PAGES) {
    test(`profile ${path}`, async ({ pagedPage: page }) => {
      await page.goto(path)
      await page.waitForTimeout(2500)

      const inventory = await page.evaluate(() => {
        const all = document.querySelectorAll<HTMLElement>('*')
        // getComputedStyle answers for display:none too, and this app hides a
        // per-card hover overlay that way below md. Counting those as cost would
        // have sent the fix at elements a phone never renders.
        const rendered = [...all].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        const vh = window.innerHeight
        let blurred = 0
        let blurredOnScreen = 0
        let shadowed = 0
        const byClass = new Map<string, number>()
        for (const el of rendered) {
          const cs = getComputedStyle(el)
          if (cs.boxShadow && cs.boxShadow !== 'none') shadowed++
          if (!cs.backdropFilter || cs.backdropFilter === 'none') continue
          blurred++
          const r = el.getBoundingClientRect()
          if (r.bottom > 0 && r.top < vh) blurredOnScreen++
          const key = `${el.tagName.toLowerCase()} ${(el.className.toString().match(/backdrop-blur-[a-z0-9]+/) ?? ['?'])[0]} ${el.className.toString().slice(0, 38)}`
          byClass.set(key, (byClass.get(key) ?? 0) + 1)
        }
        return {
          nodes: all.length,
          rendered: rendered.length,
          blurred,
          blurredOnScreen,
          top: [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
          shadowed,
          imgs: document.querySelectorAll('img').length,
          canvases: document.querySelectorAll('canvas').length,
          scrollHeight: document.querySelector('main')?.scrollHeight ?? 0,
          heroImgs: [...document.querySelectorAll('img')].slice(0, 3).map((i) => ({
            cls: i.className.slice(0, 70),
            w: Math.round(i.getBoundingClientRect().width),
            h: Math.round(i.getBoundingClientRect().height),
          })),
        }
      })

      // Mobile WebKit has no wheel, and a synthetic swipe measures the compositor
      // more than the page. Stepping scrollTop inside a rAF chain and timing each
      // frame measures what this app makes the main thread do per frame of
      // scrolling, which is the part the code controls.
      const frames = await page.evaluate(async () => {
        const main = document.querySelector('main')!
        const deltas: number[] = []
        let last = performance.now()
        await new Promise<void>((resolve) => {
          let i = 0
          const tick = () => {
            const now = performance.now()
            deltas.push(now - last)
            last = now
            main.scrollTop += 90
            if (++i < 90) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
        const d = deltas.slice(2)
        const sorted = [...d].sort((a, b) => a - b)
        const at = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0
        return {
          count: d.length,
          p50: +at(0.5).toFixed(1),
          p95: +at(0.95).toFixed(1),
          max: +Math.max(...d).toFixed(1),
          over32: d.filter((x) => x > 32).length,
        }
      })

      console.log(`\nPERF ${path}`)
      console.log(`  inventory  ${JSON.stringify(inventory)}`)
      console.log(`  frames     ${JSON.stringify(frames)}`)
    })
  }
})
