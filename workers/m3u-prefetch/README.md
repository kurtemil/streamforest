# streamforest-m3u-prefetch

Standalone Cloudflare **Worker** that runs the nightly M3U prefetch on a cron.

## Why it's separate from the Pages app
Cloudflare **Pages does not support cron triggers** — a `[triggers]` block in the
Pages `wrangler.toml` fails config validation and breaks *every* deploy (this bit
us 2026-06-05 → 2026-06-12). Cron is a **Workers** feature, so the scheduled job
lives here as its own Worker. It binds the **same D1 and KV** as the Pages app, so
the Pages `/proxy` route transparently serves the cache this Worker fills.

The logic mirrors `prefetchM3u` in `../../functions/_worker.ts` — keep them in sync.

## Deploy
```bash
cd workers/m3u-prefetch
npx wrangler deploy
```
That's it — separate from the Pages deploy, and it can never break it.

## Test without waiting for the cron
```bash
curl https://streamforest-m3u-prefetch.<your-account>.workers.dev/__run
```
Then confirm a fresh `m3u:<hash>` key exists in the `M3U_CACHE` namespace, or load
the app and check the `/proxy` response has header `X-M3U-Source: kv-cache`.

## Schedule
`0 5 * * *` — 05:00 UTC nightly (06:00 CET / 07:00 CEST). Change in `wrangler.toml`.
