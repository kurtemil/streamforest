import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { Connect } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

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
    {
      name: 'dev-proxy',
      configureServer(server) {
        server.middlewares.use(devProxyMiddleware())
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
