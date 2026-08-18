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

## FIXED (verify on the device): the tab bar sat too high in the installed PWA

**Status:** diagnosed by measurement and fixed on 2026-08-18. The fix changes how
iOS launches the app, so **the home-screen app has to be removed and re-added**
before the phone can show it working. Until that has been done and the readout
re-read, treat this as fixed-but-unconfirmed.

### What it actually was

Neither of the two things this was guessed to be. The readout off the phone:

```
viewport            402×812
screen              402x874
tab bar             top 718 · h 94 · bottom 812
bar reaches bottom  yes
bar padding-bottom  34px
bar position        fixed / bottom 0px
```

The bar's bottom edge equals the viewport height, its inset is the 34px a home
indicator should be, and its position is exactly what the CSS asks for. The bar
was never mispositioned and the inset was never over-reported. **The viewport was
62px shorter than the screen** — and 62px is the status-bar inset on this phone.

`black-translucent` is what did it. It lifts the web view up to y=0 so the page
paints under the status bar, but iOS does not grow the view to match: the 62px it
gains at the top it loses at the bottom, outside the viewport, where nothing the
page draws can reach. So `bottom: 0` resolved to 62px above the glass, and the
band underneath was not the app's background — it was screen the app did not own.
Every layout fix was doomed for the same reason: there was nothing to move the bar
*into*.

The screenshot agreed once it was read that way: the status bar sat on top of the
page's own content at the top, which only happens when the view starts at y=0.

**The fix** is one word in `index.html` — `black` instead of `black-translucent`.
The same 812px view is then placed *below* the status bar, so its bottom lands on
the bottom of the screen. iOS paints the status-bar strip itself; it is black and
`surface-100` is `#080d0b`, so there is nothing to see. `theme-color` was moved
from `#0d0d0d` to `#080d0b` in the same change for the same reason.

### Why the earlier rounds missed it

The readout was reporting `insets 0/0/0/0` while the bar it was measuring carried
34px of them, because `getClientContext()` caches its whole record for the session
and iOS resolves the insets later than boot. Insets are read live now
(`readSafeAreaInsets`, exported for exactly this), and the readout has the row
that would have ended this on day one: **`screen - viewport`**. Non-zero there is
never a layout problem.

The structural difference from `lagom` — document scrolling versus this app's
shell — was a red herring. It is real, but it cannot change the height of the web
view, and `bar reaches bottom: yes` had already cleared the layout. Nothing in
`Layout.tsx` or `index.css` needs to change.

### Confirming it

Reinstall the home-screen app, then **Settings → Device**:

- **`screen - viewport: 0px`** — fixed. The bar's `bottom: 0` is now the bottom of
  the screen.
- **anything else** — the launch config is still not what this change intended,
  and the number is how much screen the page is missing. Do not start moving the
  bar; it is not the bar.
- Watch `bar padding-bottom` too. Without `black-translucent` iOS may report
  `safe-area-inset-bottom` as 0, and if it does, `pb-safe` collapses and the
  labels will sit on the home indicator — a different bug with a different fix
  (a floor under the inset), and one this readout will show plainly.

### Guard that already exists

`e2e/baseline.spec.ts` asserts the bar's bottom equals the viewport height. It
passed throughout this bug, which is the point of its own comment: Playwright does
not emulate safe-area insets and cannot see a viewport that does not fill the
screen. It catches a bar mispositioned by layout — a real class of bug, just not
this one. The device readout owns this one.

---

## The list that stopped at 60

Fixed on 2026-08-18, and worth knowing the shape of because it failed silently.

`useInfiniteScroll` held its sentinel in a `useRef`. The sentinel only renders in
the grid branch of Movies and Series — the one that appears once there is a search
or a group — so on a page that mounts in row mode it does not exist yet. The
observer's effect read `null`, returned, and had no dependency left that could
ever tell it the node had arrived: `count` cannot advance without the observer
that was never attached. Nothing threw. The list just ended at 60 titles.

The node lives in state now, so its appearance is what runs the effect, and the
hook takes the list total so a fully-rendered list stops re-arming an observer
that can no longer add anything.

Note which path reproduces it: landing on `/movies?group=…` mounts the grid on the
first render and pages correctly. The failing path is the one a person takes —
open Movies, then search. `e2e/baseline.spec.ts` takes the second path on purpose.

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
local test. It is also the only place that can see a viewport smaller than the
screen — the row `screen - viewport`, which is what the tab-bar bug above turned
out to be.

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
