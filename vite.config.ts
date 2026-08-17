import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { createHash } from 'crypto'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

// Hashes only — plaintext PINs are stored in D1 (production)
const DEV_PIN_HASHES: Record<string, string> = {
  elof:   'd982309a461bcc3abc15489201522c8df291aa650eabafda45f1583b03992cc9',
  jossan: 'd982309a461bcc3abc15489201522c8df291aa650eabafda45f1583b03992cc9',
  vera:   'd07164a628596323ebcf8796dee0e5c164620e0922b52483bc805f54416ee73c',
  noah:   '8cfecd937a9328ecb71d3c08e5dd312058ca7d75171e7ba6e3af7573e210cd6c',
}

function devPinMiddleware(): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next) => {
    if (req.method !== 'POST' || req.url !== '/api/pin') return next()
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk })
    req.on('end', () => {
      try {
        const { profile_id, pin } = JSON.parse(body) as { profile_id: string; pin: string }
        const hash = createHash('sha256').update(pin).digest('hex')
        const ok = DEV_PIN_HASHES[profile_id] === hash
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok }))
      } catch {
        res.statusCode = 400
        res.end('{"ok":false}')
      }
    })
  }
}

// Dev-only middleware that mimics the Cloudflare Pages Function at /proxy
function devProxyMiddleware(): Connect.NextHandleFunction {
  return async (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith('/proxy')) return next()

    const params = new URLSearchParams(req.url.replace(/^\/proxy\??/, ''))
    const target = params.get('url')

    if (!target) {
      res.statusCode = 400
      res.end('Missing url parameter')
      return
    }

    try {
      const upstream = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StreamForest/1.0)' },
      })

      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'text/plain')
      const cl = upstream.headers.get('Content-Length')
      if (cl) res.setHeader('Content-Length', cl)
      res.statusCode = upstream.status

      if (!upstream.body) { res.end(); return }
      const reader = upstream.body.getReader()
      const pump = async () => {
        const { done, value } = await reader.read()
        if (done) { res.end(); return }
        res.write(value)
        pump()
      }
      pump()
    } catch (err) {
      res.statusCode = 502
      res.end(String(err))
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'StreamForest',
        short_name: 'StreamForest',
        description: 'Personal IPTV player',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/proxy/, /^\/transcode/],
      },
    }),
    {
      name: 'dev-proxy',
      configureServer(server) {
        server.middlewares.use(devPinMiddleware())
        server.middlewares.use(devProxyMiddleware())
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Default to node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock, which keeps the pure-logic suite fast.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Playwright specs live in e2e/ and are driven by playwright.config.ts.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'db': ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
})
