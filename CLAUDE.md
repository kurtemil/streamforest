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
    lib/i18n/             Swedish + English catalogs and the t()/useT() layer
  functions/              Cloudflare Pages Functions — file-based routing.
    proxy.ts              /proxy — host-allowlisted CORS bypass + KV cache read
    api/progress.ts       /api/progress — D1-backed cross-device watch state
    api/feedback.ts       /api/feedback — the in-app suggestion box
    _worker.ts            DOES NOT RUN — see the note at the top of that file
  transcode-proxy/        Node.js HTTP proxy that drives ffmpeg (runs on HP ProDesk)
    server.mjs            THE server — only file that matters at runtime
    Dockerfile            node:20-bookworm-slim + intel-media-va-driver-non-free
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

Confirmed on the device on 2026-08-18: the bar sits on the bottom edge.

The readout that proved it — Settings → Device, `ViewportReadout.tsx` — has since
been removed; it was a diagnostic for an open bug and became clutter in a
settings page once the bug closed. It is in the history if this ever comes back:

```bash
git show dc61e6e:src/components/settings/ViewportReadout.tsx
```

Restore it before theorising. It reports `screen - viewport`, and a non-zero
value there is not a layout problem — it is screen the page does not own, and no
amount of CSS reaches it.

One thing to watch, since it changed with the fix: without `black-translucent`,
`env(safe-area-inset-bottom)` could have come back as 0, which would collapse
`pb-safe` and drop the labels onto the home indicator. It did not — the inset is
still reported and the padding still resolves — but that is the failure mode to
look for if the bar ever looks wrong at the bottom rather than above it.

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

## Home was slow because of an 18-second animation

Fixed on 2026-08-18. The report was that Home stuttered while scrolling and that
other pages did too, which reads like a scrolling problem and is not one.

Measured with `npm run probe:scroll` against the production build, same page,
same inventory, changing one class:

| | median frame | frames over 32ms |
|---|---|---|
| `animate-kenburns` on the hero backdrop | 47–49 ms | 88 of 88 |
| gated off | 16 ms | 27 of 88 |

`kenburns` is `18s ease-in-out infinite` on a full-bleed image. An infinite scale
never lets the layer settle, so it re-rasterises for as long as the page is open
— the cost is not paid while scrolling, it is paid always, and scrolling is
merely when it gets noticed. Home was the worst page because Home has the hero;
`/movies` measured 15ms all along.

It is `can-hover:animate-kenburns` now: a desktop has the headroom, and the phone
is what this app is watched on. Worth knowing that the hero's poster fallback
puts `blur-3xl saturate-[1.7]` on that same element, so the animated case there
was re-blurring a full-screen image every frame.

Card decorations also lost their `backdrop-filter` in the same pass — 49 blurred
layers on Home, 23 on screen at once, 47 of them a 28px chip repeated per card.
Be honest about that one: the probe watches the main thread and could not measure
it either way. It was removed on the argument that a blur that small over dense
artwork is not visible and a compositor pass per card is not free, not on a
number. The kenburns result is the measured one.

---

## "Recently Added" had nothing to be recent about

Fixed on 2026-08-18. It was `movies.slice(0, 20)` — the first twenty lines of the
M3U file. An M3U carries no dates, so file order was the only ordering available
and it was being presented as recency. A Christmas film near the top of the
playlist sat in the row all year, which is how it was noticed.

The app keeps its own history now: `channelSeen` (Dexie v8), a table that
survives the import that clears `channels`, holding the first time each id was
stored. `markSeen` stamps ids it has not seen and deletes ids the provider
dropped, so a removed-and-restored title reads as new again.

`pickRecentlyAdded` in `src/lib/recentlyAdded.ts` decides what that history may
claim, and both of its rules exist to let the row say nothing:

- the oldest stamp is the baseline import — everything carrying it arrived
  together, which is a library, not an arrival
- past 45 days nothing is recent, so a library that stopped being updated cannot
  keep presenting its last delivery as new

On a fresh install every row shares the baseline and the result is empty, so the
row hides. It fills on the import after the next one. That is the correct answer
and it is unit-tested; the previous behaviour could not produce an empty row at
all, which is precisely why it was always wrong.

The sidebar pill that clears the group filter was also called "Recently Added"
while actually meaning "the default rows view". It is `browseLabel` / "Browse".

---

## Handing playback to VLC

`src/lib/vlc.ts` owns the "VLC" buttons. Two facts shape everything in it:

1. **Desktop VLC registers no URL scheme.** There is nothing to deeplink to until
   the handler is installed on that machine — one command, per machine, and the
   button silently keeps downloading a `.m3u` on any machine that has not had it.
   A laptop that downloads a file when the phone opens VLC in one tap is not a bug
   report; it is a machine missing the handler.
2. **Neither link scheme carries more than one MRL.** `vlc-x-callback://…/stream?url=`
   on the phone and `vlc://` on the desktop both take a single URL.
3. **A colon cannot travel inside a `vlc://` link as itself.** The browser parses
   the link before dispatching it, reads the inner `https:` as a host with an
   empty port, and serializes the colon away — the handler receives
   `vlc://https//…` and VLC gets a string that is no longer a URL. Found on
   2026-08-27, after a day in the field where the Test button passed (it measures
   focus loss, and the handler app *did* launch) while every real click did
   nothing — and downloaded nothing, because the launching handler stole focus,
   which is exactly the "VLC opened" signal that suppresses the fallback.
   `vlcSchemeLink()` therefore sends every colon as `%3A` and **both installers
   decode it back** — that pair is a contract, and `src/lib/vlc.test.ts` pins the
   page's half against Node's URL parser (the same WHATWG parser browsers run).
   A handler installed before 2026-08-27 predates the contract and must be
   reinstalled; the installers are idempotent, so it is the same one-liner again.

So a season is handed over as a *link to a playlist*: `/api/playlist/<name>.m3u?d=<token>`,
which VLC fetches and plays in order. The token carries the entries themselves —
`src/lib/vlcPlaylist.ts` encodes them, `functions/api/playlist/[name].ts` decodes
them — so there is no stored playlist to expire and no cleanup to forget. The
common URL prefix is lifted out before encoding, which is what keeps a normal
season under the 6000-character cap in `vlc.ts`; over it, the button gives up on
deeplinking and downloads the file, which carries the same playlist.

That shared file is imported by the Function through a **relative** path, not
`@/`: functions are bundled separately and the alias does not exist there. It
must stay dependency-free for the same reason. `src/lib/vlcPlaylist.test.ts` is
where the two halves are checked against each other — nothing else fails if they
drift.

The `.m3u` in the path is load-bearing: VLC decides it was handed a playlist from
the extension, before any `Content-Type`. The endpoint answers `no-store`,
because the entries carry the provider's username and password in their URLs.

Confirmed on 2026-08-26: VLC for iOS takes a remote `.m3u` over x-callback and
plays the season in order. That was the one leg of this that could not be proven
from a desktop, since WebKit-on-macOS is not the phone and no test can install
VLC's URL scheme.

### Settings → VLC, and the order its two routes are in

`src/components/settings/VlcHandlerSection.tsx`. **The route that needs no
install comes first, and it must stay first:** tell the browser to always open
`.m3u` files, and the download step becomes invisible — one click, ending in VLC,
with nothing installed and no terminal. Every browser has that toggle, none of
them in the same place, so the section detects which one is asking and prints
only its steps.

The `vlc://` handler is the second route, folded behind a disclosure, because all
it buys is skipping the download itself. A page cannot install a URL-scheme
handler on either OS — that is the privilege the scheme registry exists to
withhold — so it costs one pasted command, and the alternatives are worse rather
than better: a downloaded `.command` arrives without its exec bit, and a
downloaded `.app` meets Gatekeeper's "unidentified developer" wall.

This section led with the command in its first version, which is how you end up
telling someone to open a terminal to fix a two-click annoyance. If it ever grows
a third route, weigh it the same way: how much does it ask of the person.

`public/vlc-handler.sh` and `public/vlc-handler.ps1` are the installers, under
`public/` **because the app serves them** — that is what makes the one-liners
one-liners. They used to live in `tools/vlc-handler/`, which is exactly where a
person setting up a second computer does not look. One copy, in the place the app
links to — do not add a second under `tools/`.

### The remembered verdict

`vlcHandler()` in `src/lib/vlc.ts` records what this computer was last seen to do,
in `localStorage`, and a click on a computer known to have no handler goes
straight to the download. That pause — a second and a bit of nothing, on every
click — was most of what made the download route feel broken rather than merely
different.

The answer a click acts on and the answer we record are taken at **different
times on purpose**: `FALLBACK_MS` (1.2 s) is all a click can wait before
downloading, but a cold VLC can take several seconds to come up, and recording
"missing" that early would file a working computer as broken. `VERDICT_MS` (6 s)
is what the record waits for. A "missing" verdict also lapses after a week, since
nothing would otherwise ever try again after the handler was installed; Settings'
Test button overwrites it immediately.

`vlc-handler.ps1` must stay **pure ASCII** — Windows PowerShell 5.1's `irm`
decodes a charset-less response as ISO-8859-1, so a UTF-8 byte arrives mangled.
It is also the one file here that has never been run on the OS it targets; its
registry writes and its embedded `.vbs` are carried over verbatim from the
`install.cmd` that was.

**Which buttons hand over what:** the show header's VLC button sends the whole
selected season; the per-episode button on each row sends that one episode. Both
are wanted — the header one is "put this season on", the row one is "this episode
misbehaves in the web player".

---

## Språkstöd: svenska och engelska

Added 2026-08-26. The interface exists in both languages; the switch is per
device and defaults to what the device asks for.

`src/lib/i18n/` is the whole layer — hand-rolled, no dependency, because it is
one lookup, one plural rule and a `{name}` replace:

- `en.ts` is the catalog **and** the type. `sv.ts` ends in `satisfies Messages`,
  so a forgotten key is a build error rather than an English word in the middle
  of a Swedish screen.
- Flat dotted keys, prefixed by the screen they belong to. `t('movies.emptyTitle')`
  is greppable; a nested accessor is not.
- Counted strings are `_one`/`_other` pairs, called without the suffix:
  `t('movies.count', { count })`. Both languages split on `n === 1`; a language
  with more forms replaces `pluralSuffix` with `Intl.PluralRules`, which is why
  the suffixes are named after its categories.
- **Never build a sentence from two translated fragments.** Word order is not
  shared between languages — one key, with placeholders.

### `useT()` in components, `t()` everywhere else

`useT()` subscribes to the locale, so switching the language re-renders. `t()`
reads the store without subscribing.

The distinction is load-bearing in exactly one place: `VideoPlayer.tsx`. Its
effects drive playback, and putting `t` in their dependency arrays would
re-initialise a stream on a language switch. So the errors set from effects use
the module-level `t` (as `tr` for the rendered strings), and a message already
on screen keeps the language it was written in. That is the correct trade.

### The switch is in two places, and both are needed

`LanguageSwitch.tsx` sits in Settings **and** on the profile picker. Settings is
parent-and-admin only, so a kid signed in on their own phone could not otherwise
reach a setting that belongs to the device rather than to a role. Each language
names itself — "Svenska", never "Swedish" — because the person who needs the
switch is the one who cannot read the current language.

### The locale is a cache key

`tmdbCacheKey(id, locale)` in `services/tmdb.ts`. A TMDB row holds a synopsis and
a genre list *in one language*, so a cache keyed by title alone hands the Swedish
interface yesterday's English text and never corrects itself — the entries are
good for 90 days.

**English keeps the bare id, not an `@en` suffix.** That is the key every row
already written uses and the key the shared cache on the transcode server is
keyed by; suffixing it would throw away a library's worth of enrichment for
nothing. Only `sv` (and any future language) gets a suffix.

`useTmdbEnrich` clears its map and its in-flight set on a switch, and drops
results that were started under the previous locale — without that, requests in
flight across the switch put the old language back into a map that had just been
cleared for the new one.

**TMDB does not fall back for text.** Ask for Swedish and an untranslated title
comes back with `overview: ''` — not the English synopsis, nothing at all. So a
non-English request appends `translations` and `withEnglishFallback` fills the
gaps. One request instead of two, at the cost of a fatter response; TMDB will not
let you ask for only the translation you want.

### What does not follow the switch

- **The PWA manifest.** It is generated at build time and holds one set of
  values, so its name, description and shortcuts stay English. A manifest cannot
  be switched at runtime; do not try to make it.
- **`index.html`'s `lang`.** The static attribute is a starting value —
  `applyDocumentLang` sets the real one before first paint and on every switch.
  `<html lang>` is what iOS reads for hyphenation and VoiceOver, so it has to
  move.

### Formatting goes through the layer, not through templates

`formatNumber`, `formatDateTime`, `formatClock`, `formatRuntime` and
`titleCollator` in `i18n/index.ts`. Two of these were bugs before they were
features: `toLocaleString()` with no tag formats to whatever the *device* is set
to, and `localeCompare` without one puts Ä between A and B on a Swedish phone and
at the end of the alphabet on an English one — the same library sorting two ways
depending on whose phone it was opened on.

`src/lib/i18n/i18n.test.ts` guards what the type system cannot see: a Swedish
string that lost its `{count}` compiles perfectly and renders a sentence with the
number missing.

---

## Feedback: a suggestion box inside the app

Added 2026-08-26, ported from `lagom`, and for the same reason it exists there:
the moment you notice something wrong is the moment you are holding the phone,
and anything that needs a laptop afterwards never gets written down.

- `functions/api/feedback.ts` — GET (own, or `scope=all` for the inbox), POST,
  PATCH (resolve), DELETE. It creates its own table on first use, like every
  other Function here; there is no migrations directory in this repo.
- `src/pages/FeedbackPage.tsx` at `/feedback`, and `services/feedback.ts`.

**Two boxes, not one field with a dropdown.** "Report a fault" and "suggest
something" ask for different sentences, and someone who has just hit a bug should
not have to classify it before they can start typing. The kind is decided by
which box you write in.

**Everyone can write; only the admin reads the inbox.** That is why it is its own
route rather than a section of Settings, which two of the four profiles cannot
open. The desktop link is in the sidebar, the phone's is on the profile picker —
the only screen a kid profile can always reach.

**Resolved is a tick, never a delete.** Ticked-off reports fold away behind a
count instead of disappearing, because "what did we already fix?" is a real
question — just not the one the page is normally open for. Emil ticks these off
himself; nothing else should write `resolved`.

**The device line is shown, not just sent.** `describeDevice()` reuses
`getClientContext()` from the playback diagnostics, so nothing new is collected,
and the summary is printed under the form before you press send. Which phone and
whether the app was launched from the home screen are the two questions almost
every playback report in this app turns on — and quietly collecting telemetry
from your own household is not the kind of app this is.

No screenshots, unlike Lagom's version: that needs an R2 bucket, and this project
has none.

`/feedback` is in `AUDIT_PAGES` in `e2e/touch-audit.spec.ts`, because it is a
page that gets used on a phone. `Button size="sm"` lands around 28 px, so every
control on it carries an explicit `min-h-11`.

---

## Diagnostics and tests

Nobody debugs this app on the phone it is watched on, so four tools stand in for
that. Use the one that owns the question.

| Question | Tool |
|----------|------|
| What did ffmpeg actually produce? | `npm run probe:hls` |
| Does the interface work under touch? | `npm run test:e2e` |
| What happened on a real device? | `npm run logs` |
| Why does scrolling stutter? | `npm run probe:scroll` |

**`npm run probe:scroll`** — `e2e/perf-probe.spec.ts`, tagged `@probe` so the
normal suite skips it. Reports what is on a page — rendered nodes, how many carry
a `backdrop-filter` and how many of those are on screen, shadows, images — and
then times every frame while `scrollTop` is stepped from inside a rAF chain.

Read it as a comparison, never as a frame rate. Stepping scroll this way forces a
layout each tick, so absolute numbers are worse than real scrolling, and it
watches the main thread rather than the compositor — it cannot see what a stack
of backdrop-filters costs. What it is good for is A/B against the same page:
build, measure, change one thing, measure again.

Measure the production build, or it measures React. `npm run build`, then
`npx vite preview --port 5173`, then run it — Playwright reuses a server already
on 5173 and otherwise starts the dev one, where StrictMode double-renders
everything under the instrument. Kill the preview afterwards: the e2e suite will
happily run against a stale build otherwise.

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

The audits in `e2e/touch-audit.spec.ts` were once marked `test.fail()` to record
defects that existed at the time. The defects are fixed and the annotation is gone —
both audits now assert straight, and guard the fix from here on.

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

**Hardware:** HP ProDesk 400 G4 Desktop Mini, Intel Core i5-8500T — **Coffee Lake**
(family 6, model 158), Intel UHD Graphics 630. This guide said Kaby Lake / HD 630
until 2026-08-25; `lscpu` on the machine says otherwise.

**QuickSync via `h264_vaapi`, and what the driver decides.** The encoder was on a
fixed `-qp 23` with no bitrate ceiling because the container carried Debian's DFSG
`intel-media-va-driver`, whose build drops the pre-compiled GPU kernels — and those
kernels are the VME encoder. With the free build, `vainfo` in the container offers
exactly one H.264 encode entrypoint:

```
VAProfileH264High : VAEntrypointEncSliceLP
```

and asking it for a bitrate fails outright:

```
Driver does not support any RC mode compatible with selected options
(supported modes: CQP)
```

`intel-media-va-driver-non-free`, same version, adds `VAEntrypointEncSlice` and
with it AVBR, CBR and QVBR — and HEVC encode, which the free build has no
entrypoint for at all. The Dockerfile installs the non-free package now, and
`server.mjs` runs QVBR (`-global_quality $VAAPI_QP` with `-b:v`/`-maxrate` as a
ceiling). It probes the driver once at boot with a three-frame encode and falls
back to the old `-qp` arguments if the answer is no, so an image rebuilt from an
older Dockerfile degrades in quality instead of refusing to play anything.

To check what the running container can do:

```bash
ssh 192.168.1.111 'docker exec transcode-proxy vainfo --display drm --device /dev/dri/renderD128 | grep Enc'
ssh 192.168.1.111 'docker logs transcode-proxy 2>&1 | grep "\[vaapi\]"'
```

**Docker Compose:** runs in `~/services/` on the ProDesk. Port 8787 bound to `127.0.0.1` only.

**Cloudflare Tunnel:** `7878bd57-streamforest-transcode.krutofv.se` → `localhost:8787`
- Tunnel UUID: `629a0479-9537-40ad-94ad-af55706dc9cf`
- Ingress configured via API (not dashboard)

**Environment variables for the server:**
| Var | Used on ProDesk | Notes |
|-----|-----------------|-------|
| `H264_ENCODER` | `h264_vaapi` | Coffee Lake QuickSync |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | |
| `VAAPI_QP` | `23` | Quality target — `-global_quality` under QVBR, `-qp` if the driver refuses |
| `VAAPI_RC` | (unset = `auto`) | `qvbr` or `cqp` to skip the boot probe |
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
- A 20 s first-byte timeout kills ffmpeg before Cloudflare's ~15 s first-byte timeout for proxied origins fires (see the comment in `server.mjs`) — prevents CORS-less 502 reaching the browser.

---

## SSH to the server

**Within home network (LAN):** the machine is `192.168.1.111`, hostname `khs`.

```bash
ssh krutofv@192.168.1.111
```

**Outside home network:** `tailscaled` already runs on the ProDesk (tailnet address
`100.102.121.4`), so Tailscale is the way in. The options below are kept for reference:

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

- **No *provider* HLS:** providers serve HLS at `host:port/live/USER/PASS/{id}.m3u8` but that's HTTP → mixed-content blocked on HTTPS. Use the transcode proxy instead — which generates HLS of its own (`/hls-start` + `/hls-file/*`), and that is what the iOS live path uses.
- **VideoPlayer routing:**
  - `type === 'live'` → `liveStreamUrl()` → transcode proxy (copy mode, no probe)
  - `type === 'movie' | 'series'` → `probeMedia()` first, then `transcodeUrl()`
  - `.m3u8` URLs → HLS.js, including the proxy's own generated playlists
- **Probe before play (VOD only):** needed to detect AC3/DTS audio (→ `mode=transcode`) and enumerate embedded subtitle tracks.
- **Subtitle extraction:** co-extracted in-process via `pipe:3+` alongside the video transcode. Falls back to a standalone ffmpeg run if the transcode finishes first. Cached on disk under `SUB_CACHE_DIR`.
- **Profiles:** 4 profiles (Elof/Jossan/Vera/Noah). Watch progress synced to D1 via `/api/progress`. Local IndexedDB is the primary store; D1 is cross-device sync.
- **Continue Watching:** `handleClose` reads `useProfileStore.getState().activeProfileId` fresh on close, so the stale-closure bug once suspected here cannot occur as described. If items still fail to appear, the cause is elsewhere and unmeasured.

---

## Cloudflare account

- Pages project: `streamforest`
- D1 database: `streamforest-profiles` (`1b607c87-bab2-485b-94c8-5722f9f8f9a6`)
- Tunnel: `streamforest-transcode` (`629a0479-9537-40ad-94ad-af55706dc9cf`)
- Domain: `krutofv.se`
