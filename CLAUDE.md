# StreamForest — Agent Guide

Personal IPTV web player. React SPA on Cloudflare Pages; home transcode server on HP ProDesk 400 G4 exposed via Cloudflare Tunnel.

---

## Repo structure

```
/                         React+TS+Vite SPA (Cloudflare Pages)
  src/
    components/player/    VideoPlayer.tsx — main playback component
    lib/transcode.ts      URL builders + probe helper for the transcode proxy
    services/db.ts        Dexie (IndexedDB) schema + helpers
    stores/               Zustand stores (player, playlist, profile, etc.)
    pages/                Route-level pages
  functions/              Cloudflare Pages Functions — file-based routing.
    proxy.ts              /proxy — host-allowlisted CORS bypass + KV cache read
    api/progress.ts       /api/progress — D1-backed cross-device watch state
    _worker.ts            DOES NOT RUN — see the note at the top of that file
  transcode-proxy/        Node.js HTTP proxy that drives ffmpeg (runs on HP ProDesk)
    server.mjs            THE server — only file that matters at runtime
    Dockerfile            node:20-bookworm-slim + intel-media-va-driver (ProDesk image)
    fly.toml              Fly.io config (alternative cloud deployment, not active)
```

---

## Local dev

```bash
npm install
npm run dev          # Vite on :5173, dev proxy middleware handles /proxy
npm run dev:pages    # wrangler pages dev — needed for /api/* (D1) routes
npm test             # vitest unit tests
```

---

## OPEN: the tab bar sits too high in the installed PWA

**Status:** unresolved as of 2026-08-18. Two fixes were shipped on guesses and
neither worked. Do not ship a third guess — take the measurement first.

**Symptom.** In the home-screen app on an iPhone, the bottom tab bar sits well
above the bottom edge with a black band beneath it. Estimated from a device
screenshot: roughly **110 CSS px** between the labels and the bottom edge on a
402×874 viewport (iPhone 16 Pro, DPR 3), where about 44 would be correct. It does
not reproduce anywhere locally.

### Ruled out, with evidence

| Suspect | Why it is not that |
|---|---|
| Stale build / cache | Production serves the expected hashed assets (checked with curl against the live `index.html`). The PWA was also removed and reinstalled by hand. |
| The service worker never updating | Real, separate bug — the injected `registerSW.js` was a bare `register()` on `load`, so a home-screen app resumed from the app switcher never checked for updates. Fixed in `4fb9e92`. It was not the cause of this. |
| The viewport meta | Character-for-character identical to `lagom`, whose tab bar is correct. |
| An over-reported safe-area inset | Tried bounding it with `min(env(safe-area-inset-bottom), 2.25rem)`. No effect; reverted in `d52737e`. |
| A missing compositing layer | `lagom` carries a bare `translateZ(0)` on its nav for exactly this class of bug, so it was adopted in `d52737e`. Still wrong after a clean reinstall. |

### Take the measurement first

**Settings → Device** (admin only, `src/components/settings/ViewportReadout.tsx`)
reports what the phone actually has, including the tab bar's own rectangle. The
deciding row is **`bar reaches bottom`**:

- **`yes`** — the bar is positioned correctly and the gap *is* `env(safe-area-inset-bottom)`.
  Then the question is why that value is ~4× what an iPhone should report, and the
  fix belongs in how the inset is consumed, not in the bar's position.
- **`no — short by Npx`** — the bar is being laid out short and the inset is
  innocent. Then it is the layout, and the first suspect is below.

These need opposite fixes. Not knowing which one it was is precisely why two
guesses missed.

### The leading candidate if the bar is short

The one structural difference left between this app and `lagom`
(`~/gitRepos/Private/lagom`), whose tab bar is correct, is the scroll model:

- **lagom** scrolls the document — `src/routes/+layout.svelte` is
  `<main class="relative min-h-dvh pt-safe pb-safe">`, and the nav is
  `fixed inset-x-0 bottom-0` with plain `pb-safe`.
- **this app** uses an app shell — `src/components/layout/Layout.tsx` is
  `<div class="flex h-full overflow-hidden">` with `<main class="flex-1 overflow-y-auto">`,
  and `src/index.css` sets `html, body, #root { height: 100%; min-height: 100dvh }`.

A `height: 100%` chain resolves against the layout viewport, which on iOS with
`viewport-fit=cover` can be shorter than the visual viewport — and `position: fixed`
anchors to the same shorter box. That would place the bar high by exactly the
difference.

Switching to document scrolling is not a one-liner. It touches:
- `mainRef.current?.scrollTo(0, 0)` on route change in `Layout.tsx` → `window.scrollTo`
- the desktop sidebar, which is `h-full` inside the flex row and would need `sticky`
- `overscroll-behavior: none` in `index.css`, which currently depends on the shell
- the player, which is `fixed z-50` and should be unaffected — verify, do not assume

A cheaper probe before refactoring: set the shell to `height: 100dvh` instead of
`height: 100%` and re-read the readout on the device.

### Guard that already exists

`e2e/baseline.spec.ts` asserts the bar's bottom equals the viewport height. It
passes in every emulated viewport, which is the point of its own comment: Playwright
does not emulate safe-area insets, so it catches a bar mispositioned by layout, not
one lifted by `env()`.

---

## Diagnostics and tests

Nobody debugs this app on the phone it is watched on, so four tools stand in for
that. Use the one that owns the question.

| Question | Tool |
|----------|------|
| What did ffmpeg actually produce? | `npm run probe:hls` |
| Does the interface work under touch? | `npm run test:e2e` |
| What happened on a real device? | `npm run logs` |
| What is the viewport on the device right now? | Settings → Device |

**Settings → Device** — `src/components/settings/ViewportReadout.tsx`, admin only.
Viewport, visual viewport, screen, DPR, the four safe-area insets measured through a
probe element, display mode, and the tab bar's own rectangle with its computed
position and padding. There is a Copy button so the numbers can be pasted rather
than transcribed.

It exists because safe-area insets cannot be emulated: Playwright reports `0/0/0/0`
for all four, so anything that goes wrong at the screen edges is invisible in every
local test. See the open tab-bar investigation above for what it is currently
answering.

**`npm run probe:hls`** — `tools/hls-probe.mjs` generates a test clip with ffmpeg,
serves it over a throwaway HTTP origin, runs a fresh transcode-proxy against it and
inspects the resulting HLS session: playlist type, ENDLIST, segment container and
codec tags, disk growth, and whether the session hash separates audio tracks. Fully
self-contained — it costs the IPTV subscription nothing and answers the same way
every run. Non-zero exit on a failed check, so it works as a regression gate.
Pass `--url <stream>` to point it at a real provider stream instead.

**`npm run test:e2e`** — Playwright against **WebKit**, which is the engine every
iOS browser uses, Chrome for iPhone included. Projects: `iphone-webkit`,
`ipad-webkit`, `desktop-webkit`. `e2e/fixtures.ts` seeds a profile and a small
library into IndexedDB so card-level controls exist to test.

The audits in `e2e/touch-audit.spec.ts` are marked `test.fail()`: they record
defects that exist today, so the suite stays green while they fail and turns red
the moment one is fixed — which is the prompt to drop the annotation and let the
test guard the fix from then on.

*The honest limit:* WebKit-on-desktop is not iOS WebKit. Layout, pointer events and
CSS agree closely; media playback does not (no ManagedMediaSource, different
autoplay policy, different HLS implementation). Playback questions belong to the
client log.

**`npm run logs`** — reads the diagnostics the player posts from real devices via
`GET /clientlog` (token-protected; set `CLIENT_LOG_TOKEN` on both server and
client). Groups events by playback attempt and reports time-to-first-frame, probe
and hls-start timings, seek counts, and any `play()` rejections. `--since 24h`,
`--summary`, `--raw` for piping into jq.

Instrumentation lives in `src/lib/diagnostics.ts`. Events are batched and flushed
on `pagehide` via `sendBeacon`. Two fields carry most of the weight:
- `first-frame.seekable` — a window that does not start at 0 means WebKit took the
  playlist as live rather than as a movie.
- `play-rejected.name` — `NotAllowedError` means the autoplay policy refused,
  which is a spent user gesture, not a broken stream.

Required `.env.local` (copy from `.env.example`):
```
VITE_TRANSCODE_PROXY_URL=http://localhost:8787
VITE_TMDB_BEARER=<your token>
VITE_TMDB_API_KEY=<your key>
```

---

## Production deployment

**Frontend** — push to `main` → Cloudflare Pages auto-deploys.
- Live: https://streamforest.krutofv.se (also streamforest.pages.dev)
- GitHub: https://github.com/kurtemil/streamforest
- D1 database binding: `streamforest-profiles` (id in wrangler.toml)

**Transcode server** — manual deploy on the HP ProDesk:
```bash
# SSH to server (LAN, see below), then:
cd ~/streamforest && git pull
cd ~/services && docker compose up -d --build --force-recreate
```

The repo lives at `~/streamforest` on the ProDesk. Docker Compose lives at `~/services/docker-compose.yml` and builds from `~/streamforest/transcode-proxy/`. The `--build` flag is required because the Dockerfile COPYs server.mjs at image build time.

---

## Transcode server (HP ProDesk 400 G4)

**What it does:** Node.js HTTP server (`transcode-proxy/server.mjs`) that wraps ffmpeg. Endpoints:
- `GET /transcode?url=&start=&mode=copy|transcode&live=1&audio=&subs=` → `video/mp4` stream
- `GET /probe?url=` → JSON `{ duration, audioCodec, videoCodec, audioStreams, subtitleStreams }`
- `GET /subtitle?url=&index=&start=&vstart=` → WebVTT stream
- `GET /health` → `ok`

**Hardware:** HP ProDesk 400 G4 Desktop Mini, Intel HD Graphics 630 (Kaby Lake). QuickSync via `h264_vaapi + -qp 23` (no CQP support on iHD driver → fixed QP only).

**Docker Compose:** runs in `~/services/` on the ProDesk. Port 8787 bound to `127.0.0.1` only.

**Cloudflare Tunnel:** `7878bd57-streamforest-transcode.krutofv.se` → `localhost:8787`
- Tunnel UUID: `629a0479-9537-40ad-94ad-af55706dc9cf`
- Ingress configured via API (not dashboard)

**Environment variables for the server:**
| Var | Used on ProDesk | Notes |
|-----|-----------------|-------|
| `H264_ENCODER` | `h264_vaapi` | Kaby Lake QuickSync |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | |
| `VAAPI_QP` | `23` | Fixed QP (no bitrate control on this driver) |
| `ALLOWED_HOSTS` | `nsclient.xyz,45.12.1.27` | Comma-separated allowlist — **the provider moves** |
| `CLIENT_LOG_TOKEN` | (secret) | Required for `GET /clientlog`; unset = reads refused |
| `FFMPEG_PATH` | `ffmpeg` | |

**When "nothing plays", check the provider host first.** The IPTV provider
migrates: `iptvworld.xyz` → `nsclient.xyz` so far, and also answers on the bare
IP `45.12.1.27`.

**Always configure the hostname, never the IP.** Cloudflare Workers refuse to
fetch a raw address — the request never leaves, and the caller gets a Cloudflare
403 with body `error code: 1003` that reads exactly like a provider rejection.
The home server has no such restriction, so its allowlist can carry both.

Three places go stale independently and each fails silently:

1. `ALLOWED_HOSTS` on the server — a mismatch returns `403 Host not allowed`
   before ffmpeg is ever spawned. On 2026-08-17 this named a domain that no
   longer resolved in DNS, so every VOD and live request through the proxy was
   rejected outright.
2. `m3u_url` in D1 (`user_preferences`, profile `_global`) — a dead host means
   the playlist can never refresh, so the app quietly serves whatever IndexedDB
   still holds, with stream URLs pointing at the old host.
3. `PROXY_ALLOWED_HOSTS` (Pages variable, read by `functions/proxy.ts`) — a
   mismatch returns 403 before the download starts.

The symptom in every case is "playback is broken", which reads as a player bug and
is not one. Check with:
```bash
ssh <server> 'docker exec transcode-proxy sh -c "getent hosts <host>"'
curl -s "https://streamforest.krutofv.se/api/preferences?profileId=_global"
```

**Live TV specifics:**
- Live channels are MPEG-TS over HTTP (Xtream Codes). Browsers can't play raw MPEG-TS.
- Routed through `/transcode?live=1&mode=copy` — cheap remux to fragmented MP4, no re-encode.
- `-bsf:a aac_adtstoasc` is mandatory for AAC in MPEG-TS → MP4 (ADTS → ASC).
- `-fflags +genpts+discardcorrupt` for flaky IPTV timestamps.
- A 20 s first-byte timeout kills ffmpeg before Cloudflare Tunnel's own ~30 s timeout fires — prevents CORS-less 502 reaching the browser.

---

## SSH to the server

**Within home network (LAN):** SSH works directly. Find the server's IP from your router admin panel (hostname: probably `prodesk` or similar).

```bash
ssh <your-username>@<lan-ip>     # e.g. ssh elof@192.168.1.x
```

**Outside home network:** External SSH is NOT currently configured. Options (pick one):

### Option A — Tailscale (recommended, 5 min setup)
```bash
# On the ProDesk (SSH in from home first):
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# On your laptop:
# Install Tailscale → sign in with the same account → ProDesk appears in the network
ssh <your-username>@<tailscale-ip-or-hostname>
```

### Option B — Cloudflare Access SSH (zero-trust, more setup)
Uses the existing Cloudflare infrastructure. Requires:
1. Create a Cloudflare Access application for SSH on the same tunnel or a new one.
2. Install `cloudflared` on client for `ProxyCommand`.
3. See Cloudflare docs: *Connect with SSH through Cloudflare Tunnel*.

---

## Key architecture facts

- **No HLS for live:** providers serve HLS at `host:port/live/USER/PASS/{id}.m3u8` but that's HTTP → mixed-content blocked on HTTPS. Use the transcode proxy instead.
- **VideoPlayer routing:**
  - `type === 'live'` → `liveStreamUrl()` → transcode proxy (copy mode, no probe)
  - `type === 'movie' | 'series'` → `probeMedia()` first, then `transcodeUrl()`
  - `.m3u8` URLs → HLS.js
- **Probe before play (VOD only):** needed to detect AC3/DTS audio (→ `mode=transcode`) and enumerate embedded subtitle tracks.
- **Subtitle extraction:** co-extracted in-process via `pipe:3+` alongside the video transcode. Falls back to a standalone ffmpeg run if the transcode finishes first. Cached on disk under `SUB_CACHE_DIR`.
- **Profiles:** 4 profiles (Elof/Jossan/Vera/Noah). Watch progress synced to D1 via `/api/progress`. Local IndexedDB is the primary store; D1 is cross-device sync.
- **Continue Watching bug:** items may not appear after watching — suspected stale closure on `profileId` in VideoPlayer save-on-close. Not yet fixed.

---

## Cloudflare account

- Pages project: `streamforest`
- D1 database: `streamforest-profiles` (`1b607c87-bab2-485b-94c8-5722f9f8f9a6`)
- Tunnel: `streamforest-transcode` (`629a0479-9537-40ad-94ad-af55706dc9cf`)
- Domain: `krutofv.se`
