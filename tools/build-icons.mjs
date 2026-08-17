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

const GREEN = '#15803d'

// The standard mark: rounded square, play triangle, edge to edge.
const standard = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <rect width="512" height="512" rx="128" fill="${GREEN}"/>
    <path d="M160 128l224 128-224 128V128z" fill="white"/>
  </svg>`

// Maskable: Android applies its own shape and crops to it, so the background
// runs to the edges and the mark stays inside the inner 80% safe zone. Reusing
// the standard art here would have the play triangle clipped on a circle mask.
const maskable = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
    <rect width="512" height="512" fill="${GREEN}"/>
    <path d="M198 154l160 102-160 102V154z" fill="white"/>
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
