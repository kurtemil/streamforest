#!/usr/bin/env node
// Renders the app icon to the PNG sizes iOS and Android actually use.
//
// iOS ignores an SVG apple-touch-icon entirely — the home screen showed a
// generic placeholder rather than the mark — and the manifest needs raster
// sizes too. Playwright is already a dev dependency for the WebKit tests, and
// a browser is the one SVG renderer guaranteed to agree with the one that
// displays the icon.
//
//   npm run icons

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.resolve(__dirname, '..', 'public')

// The mark: a play triangle whose trailing edge is cut into fir branches. It has
// to survive 16px in a browser tab, which rules out anything with interior
// detail — the notches work because they break the silhouette itself.
//
// Candidates were rendered side by side at 160/96/48/32/16 before this one was
// picked; the variants that softened the notches turned back into a plain arrow,
// and a literal tree lost every connection to playback.
const CANOPY = '#6ee7b7'
const MOSS = '#10b981'
const BARK_DARK = '#02150f'
const BARK = '#0d4a35'

const markGradient = `
  <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${CANOPY}"/><stop offset="1" stop-color="${MOSS}"/>
  </linearGradient>`

const backdropGradient = `
  <linearGradient id="backdrop" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${BARK}"/><stop offset="1" stop-color="${BARK_DARK}"/>
  </linearGradient>`

// Sharp notches, full bleed to the rounded square.
const MARK = 'M176 112 L392 256 L176 400 L176 344 L248 344 L176 296 L176 240 L248 240 L176 192 Z'

const standard = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <defs>${backdropGradient}${markGradient}</defs>
    <rect width="512" height="512" rx="120" fill="url(#backdrop)"/>
    <path d="${MARK}" fill="url(#mark)"/>
  </svg>`

// Maskable: Android crops to its own shape, so the backdrop runs to the edges and
// the mark is scaled into the inner 80% safe zone. Reusing the standard art would
// have the notches clipped off on a circle mask — which is the half that carries
// the identity.
const maskable = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <defs>${backdropGradient}${markGradient}</defs>
    <rect width="512" height="512" fill="url(#backdrop)"/>
    <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
      <path d="${MARK}" fill="url(#mark)"/>
    </g>
  </svg>`

const TARGETS = [
  { file: 'icon-192.png', size: 192, svg: standard },
  { file: 'icon-512.png', size: 512, svg: standard },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
  // 180 is what current iPhones ask for; iOS downscales it for smaller slots.
  { file: 'apple-touch-icon.png', size: 180, svg: standard },
]

const browser = await chromium.launch()
try {
  for (const { file, size, svg } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px">
         <div style="width:${size}px;height:${size}px">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</div>
       </body>`,
    )
    const out = path.join(PUBLIC, file)
    // omitBackground keeps the rounded corners transparent rather than white.
    await page.screenshot({ path: out, omitBackground: true })
    await page.close()
    console.log(`  ${file.padEnd(24)} ${size}×${size}  ${(fs.statSync(out).size / 1024).toFixed(1)} kB`)
  }
} finally {
  await browser.close()
}
