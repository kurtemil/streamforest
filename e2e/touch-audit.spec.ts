import { test, expect } from './fixtures'

// The gate for the mobile rebuild (findings B4, B5 and NY 7).
//
// Each audit below is marked `test.fail()`: it documents a defect that exists
// today, so the suite stays green while it fails and turns *red* the moment the
// defect is fixed — which is the prompt to drop the annotation and let the test
// guard the fix from then on. A plain failing test would just be noise nobody
// trusts; this way the same assertion serves as both the record and the gate.

const AUDIT_PAGES = ["/", "/movies", "/settings"] as const
const MIN_TOUCH_TARGET = 44 // Apple's Human Interface Guidelines

interface Offender {
  page: string
  label: string
  detail: string
}

test.describe('touch readiness', () => {
  test.skip(({ isMobile }) => !isMobile, 'Touch audits only apply to touch viewports')

  test.fail(true, 'B4/B5: controls below 44 px still exist — remove this annotation once fixed')
  test('every visible control is at least 44 px on its shortest side', async ({ libraryPage: page }) => {
    const offenders: Offender[] = []

    for (const path of AUDIT_PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const found = await page.evaluate((min) => {
        const out: { label: string; detail: string }[] = []
        const nodes = document.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, [role="button"]',
        )
        for (const el of nodes) {
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          const style = getComputedStyle(el)
          if (style.visibility === 'hidden' || style.display === 'none') continue
          const shortest = Math.min(rect.width, rect.height)
          if (shortest < min) {
            out.push({
              label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
              detail: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
            })
          }
        }
        return out
      }, MIN_TOUCH_TARGET)

      offenders.push(...found.map((f) => ({ page: path, ...f })))
    }

    if (offenders.length) {
      console.log(`\n  ${offenders.length} control(s) below ${MIN_TOUCH_TARGET} px:`)
      for (const o of offenders.slice(0, 25)) {
        console.log(`    ${o.page}  ${o.detail.padEnd(9)} ${o.label}`)
      }
    }
    expect(offenders, `${offenders.length} controls below ${MIN_TOUCH_TARGET} px`).toEqual([])
  })

  test.fail(true, 'B5: hover-only controls are still invisible on touch — remove once fixed')
  test('no interactive control is hidden behind hover', async ({ libraryPage: page }) => {
    const offenders: Offender[] = []

    for (const path of AUDIT_PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const found = await page.evaluate(() => {
        const out: { label: string; detail: string }[] = []
        const nodes = document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input[type="range"]')
        for (const el of nodes) {
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          // Walk up: a zero-opacity ancestor hides the control just as effectively.
          let node: HTMLElement | null = el
          let hiddenBy: string | null = null
          while (node && node !== document.body) {
            if (parseFloat(getComputedStyle(node).opacity) === 0) {
              hiddenBy = node === el ? 'self' : node.className.toString().slice(0, 50)
              break
            }
            node = node.parentElement
          }
          if (hiddenBy) {
            out.push({
              label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40),
              detail: `opacity:0 via ${hiddenBy}`,
            })
          }
        }
        return out
      })

      offenders.push(...found.map((f) => ({ page: path, ...f })))
    }

    if (offenders.length) {
      console.log(`\n  ${offenders.length} hover-only control(s):`)
      for (const o of offenders.slice(0, 25)) console.log(`    ${o.page}  ${o.label} — ${o.detail}`)
    }
    expect(offenders, `${offenders.length} hover-only controls`).toEqual([])
  })

  test.fail(true, 'NY 7: inputs below 16 px still trigger iOS zoom-on-focus — remove once fixed')
  test('text inputs are at least 16 px, so iOS does not zoom on focus', async ({ libraryPage: page }) => {
    const offenders: Offender[] = []

    for (const path of AUDIT_PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      const found = await page.evaluate(() => {
        const out: { label: string; detail: string }[] = []
        for (const el of document.querySelectorAll<HTMLElement>('input, select, textarea')) {
          if (el instanceof HTMLInputElement && ['range', 'checkbox', 'radio'].includes(el.type)) continue
          const rect = el.getBoundingClientRect()
          if (rect.width === 0) continue
          const size = parseFloat(getComputedStyle(el).fontSize)
          if (size < 16) {
            out.push({
              label: (el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.tagName).slice(0, 40),
              detail: `${size}px`,
            })
          }
        }
        return out
      })

      offenders.push(...found.map((f) => ({ page: path, ...f })))
    }

    if (offenders.length) {
      console.log(`\n  ${offenders.length} input(s) that will zoom on focus:`)
      for (const o of offenders) console.log(`    ${o.page}  ${o.detail.padEnd(7)} ${o.label}`)
    }
    expect(offenders, `${offenders.length} inputs under 16 px`).toEqual([])
  })
})
