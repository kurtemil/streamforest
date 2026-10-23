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
dropped, so a removed-and-restored title reads as new again. It runs in
`finishPlaylistSave`, the one function every import ends in. Until 2026-10-10 it
lived only in `saveChannels()`, which nothing called, so the row was empty in
production from the day it was built.

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

## The home library (Jellyfin)

Added 2026-10-11. The films on the home server's disks appear as a "Hemma" row on
Home, and on their own page `/hemma` (sidebar item, and "see all" from the row),
grouped by Jellyfin library and searchable, from Jellyfin at `https://jellyfin.krutofv.se` (`VITE_JELLYFIN_URL` overrides
it). That name resolves to the server's LAN address in public DNS (grey cloud), so
traffic never touches Cloudflare. Away from home it is reached over Tailscale,
where the server advertises its own address as a /32 route. The certificate comes
from Caddy on the server, via a DNS-01 challenge.

- **Browser only.** `src/services/jellyfin.ts` talks to the server from the page.
  No Function can reach it, and none needs to. iOS Safari blocks http from an
  https page (fetch and `<video>` alike), which is the whole reason for the HTTPS
  name.
- **Profiles sign in as the Jellyfin user of the same name, without a password.**
  The session is kept per profile per device. A 401 drops it and signs in once
  more. Jellyfin decides what each user may see, so the kids' limits live
  there, not here.
- **The Authorization header must be ASCII.** `Device="Webbläsare"` reached Caddy
  as a Latin-1 byte, HTTP/2 answered 400 without CORS headers, and the browser
  reported a CORS error. The test in `jellyfin.test.ts` holds the line.
- **`HomePlayer`, not `VideoPlayer`.** Jellyfin already serves what a browser
  can play: the file itself for H.264/AAC MP4, otherwise HLS transcoded on the
  server. None of VideoPlayer's proxy machinery applies, and none of it should be
  at risk from this. Use the `TranscodingUrl` from `PlaybackInfo` as given (12.x
  hides the HLS routes from its API description). It carries `ApiKey=` because
  native HLS cannot send headers. Only Apple's engine plays it natively
  (`lib/nativeHls.ts`); everything else goes through hls.js. Chromium 155 answers
  "maybe" to `canPlayType` and then cannot parse the playlist, so asking it is not
  enough (found on the kiosk, 2026-10-19).
- **Watch state is Jellyfin's.** Start, progress every 10 s and on pause, and
  stopped on close. That is what lets Swiftfin and this app resume each other.
  Jellyfin ignores positions under 5 % of the runtime, so a quick test leaves no
  resume point; that is its rule, not a bug.
- **Desktop Chrome and Edge ask once** before a public site may reach a home address
  (Local Network Access, Chrome 142+). The permission was named
  `local-network-access`, and since 145 `local-network`. While the question is
  open, the reachability check waits up to a minute instead of three seconds. A
  "no" shows its own line saying what to allow, because "reachable at home" would
  be false at home. The row reloads when the answer changes. Safari does not ask.
  Playwright denies the question unless it is given
  `grantPermissions(['local-network-access'])`. A localhost dev server never asks.
- **Unreachable means one line, not cards.** Away without Tailscale, the row
  becomes "Hemmabiblioteket nås hemma, eller borta med Tailscale". A profile
  switch clears the row before loading, so one profile's list never shows under
  another.

Verified 2026-10-11 against the real server in Edge:
- an XviD film starts in about 1.5 s and seeks 20 minutes in 6 s;
- closing saves the position (1208 s), the card moves first with a progress bar,
  and reopening resumes at 1208.6 s;
- a kid profile sees only its allowlist.

- **A card opens `HomeDetailModal`, not the player** (since 2026-10-17). What the
  list carries (overview, genres, `CommunityRating`, `OfficialRating`, the
  backdrop tag) shows at once; the people come from `/Items/{id}` when the sheet
  opens. Watched/unwatched is `/UserPlayedItems/{id}` (POST/DELETE), the same flag
  Swiftfin shows, and marking a film watched clears its resume point on the server.
- **One load per profile at a time** (`homeLibraryStore`). Jellyfin revokes a
  device's token when the same device signs in again, so two concurrent loads on
  a first visit each signed in, one list came back 401, and the store could keep
  the revoked token: playback and position reports then failed until the next
  reload. A call during a load asks for one more pass instead. `forgetSession`
  takes the refused token and leaves a newer one alone. The store also keeps
  the session object while its token is unchanged, and `HomePlayer` follows the
  token: every list reload used to make a new object, which the player took for
  a new session, so a tab switch started the film again from where it opened.
- **Films in several files** (cd1, cd2; ten of them, Avatar in three). Jellyfin
  lists the film once but plays only its first file; the rest are "additional
  parts" with their own ids and watch state. Until 2026-10-17 StreamForest played
  part one only, so Avatar stopped after 59 of 161 minutes. `listItems` reads
  `/Videos/{id}/AdditionalParts` for every item with `PartCount > 1` and
  `combineParts` makes the item speak for the whole film (length, position,
  watched only when every part is). `HomePlayer` plays the parts in a row and
  reports each to its own id; the top bar says "del 2 av 3". Marking watched,
  starting over and the VLC button all cover every part.
- **Subtitles.** Nearly the whole library is SweSub rips with the Swedish text
  burnt into the picture, which needs nothing. Four films carry real subtitle
  streams. Text streams come as WebVTT `<track>`s (switchable in place, listed by
  the iPhone's own player too, sized by `::cue`); picture streams (DVD) are burnt
  in by the server on request. The device profile used to have no subtitle
  profiles, and then the server silently burnt in the file's *default* stream:
  Hit and Run always had Swedish subtitles that could not be changed or turned
  off. **A subtitle choice is ignored unless `MediaSourceId` is sent with it**;
  for a film in one version that is the item id. The first choice follows
  `pickHomeSubtitle` (remembered per film, then the profile's language, then an
  untagged default stream, then a forced one) and carries over to the next part.

The plan for one card per film across both sources, with kids' rules shared,
lives outside this public repo.

## Bion: the kiosk in the basement, with the phone as its remote

Added 2026-10-19. The home server (ProDesk) drives the projector in the basement
and shows StreamForest full screen in Chromium (cage, a one-window Wayland
compositor). Its container lives in the `hemma` repo, `bio/kiosk/`, and opens
`/?kiosk=bion`. Nobody touches it: there is no keyboard or mouse in the sofa.

- **Two kiosks since 2026-10-22.** `bion` in the basement and `vardagsrum`, the living
  room TV: the TV's app in `hemma/tv/startskarm` opens `/?kiosk=vardagsrum` full screen
  (an Android WebView, `Kiosk.java`). `kioskDevice()` is the name it polls and writes
  with; anything unknown is `bion`. The phone has a button per kiosk (projector for Bion,
  sofa for the living room) and `bionStore.target` is the one Plays go to
  (`sf-bion-mode` holds `bion`, `vardagsrum`, or the old `1` = Bion). The living room's
  button always shows: that kiosk polls only while it is on screen, so it is not
  "alive" between films. A Play to it calls the same `HA_BION_WEBHOOK` with
  `{ device: 'vardagsrum', source, seq }`; HA's automation sends that to
  `script.vardagsrum_spela`, which wakes the TV and opens the kiosk with `?after=seq−1`
  (`kioskStartCursor()`), so its first poll reads that Play instead of skipping it.
  The page calls `window.KioskHost.state(state)` on every change, and the TV's app goes
  back to its home screen 30 s after a film. Volume and `hold` stay Bion's.
- **`src/lib/kiosk.ts`** decides it once, from `?kiosk=` kept in localStorage
  (`?kiosk=off` clears it). `main.tsx` then renders `KioskApp` instead of `App`
  (inside the router: VideoPlayer navigates), and registers no service worker:
  `autoUpdate` would reload the page in the middle of a film. `KioskApp` reloads
  itself while idle when `/` names another entry script (every 10 minutes).
- **Bion mode on the phone** (`stores/bionStore.ts`, `mode`, per device in
  `sf-bion-mode`): the TV button above the profile avatar turns it on, and then
  *every* Play goes to Bion instead of playing here. The two doors are
  `usePlayerStore.play` (IPTV) and `useHomeLibraryStore.play` (home library); no
  card knows about Bion. An old iPad can stay in this mode as the cinema remote.
  The mode can never be on in the kiosk itself. The button shows while the kiosk
  has been heard from (`ALIVE_MS`, its idle heartbeat is a minute) or the mode is on.
- **`/api/bion`** (`functions/api/bion.ts`) is two D1 tables: a command queue and one
  status row. The kiosk polls `GET ?device=bion&after=<seq>` every 2 s; its first
  poll has no `after` and only learns the cursor, so a restart never replays an old
  command, and commands older than a minute are not handed out at all. The phone
  `POST`s commands (`play`, `pause`, `resume`, `seek` by a step or `to` a point,
  `audio` and `subtitle` by track id, `stop`) and reads the status the kiosk `PUT`s
  every 5 s while a film is on (60 s while idle, at once after a seek). About 43 000
  requests a day with the kiosk on all day, a few rows each.
- **A Play on Bion switches the cinema on.** With the Pages secret `HA_BION_WEBHOOK`
  (Home Assistant's webhook, the whole URL) set, `POST play` to `bion` calls it in
  `waitUntil`; a webhook that fails or is unset changes nothing for the film. HA's
  automation *Bio – Spela på Bion* (`hemma/bio/`) runs the Bion button's script and,
  if the projector was off, posts `hold` first and `resume` once the picture is up.
  `hold` keeps every film that starts still on its first frame (a capture listener
  for `playing`), reported as state `waiting` ("Projektorn startar", with a button
  to start anyway); the kiosk lets go by itself after four minutes.
- **The receiver's volume** goes the same way, never through the kiosk: `POST volume`
  with `to` (0–1, HA's scale, one step per dB, capped at 0.8 = −20 dB) is passed to
  the webhook as `{ volume }` and answered 502 if HA did not take it. Always a level,
  never a step, so quick taps cannot each read a stale level. HA writes the receiver's
  state, volume and mute to the status row `receivern` when they change, and `GET
  ?device=bion` returns it as `receiver`. The remote shows − / level / + while the
  receiver is on, and holds a level just sent for 5 s until HA's report agrees.
- **`play` carries a source.** `home`: a Jellyfin item id; the kiosk becomes that
  profile, signs in as that Jellyfin user and plays it with `HomePlayer`, so resume
  point, subtitles and the kids' allowlist are the phone's. `iptv`: a playlist id
  (`m_…`, `s_…`, `l_…` — parsed from the stream URL, so the same on every device);
  the kiosk syncs the profile's progress from D1, looks the id up in its own
  playlist (fetched on first use, and once more if the id is missing — the phone's
  may be newer) and plays it with `VideoPlayer`, which resumes from that progress.
  A missing source is `home`: what the first phones sent.
- **Both players register in `lib/playerBridge.ts`**: the `<video>`, film-time
  `position()` and `duration()`, `seek(to)` and `close()`. Film time is across the
  parts of a split film (HomePlayer) and past the offset a transcoded stream starts
  at (VideoPlayer's `seekTo`, which restarts ffmpeg when the target is not
  buffered). `close()` is the player's own close, so the position is saved. Live
  TV has no duration and no seek. `tracks()`, `selectAudio` and `selectSubtitle` are
  the players' own menus: VideoPlayer offers both, HomePlayer subtitles only (Jellyfin
  sends one audio stream, and the phone has no audio choice for home films either).
  The status carries them, at most 30 per list. On the kiosk neither player shows its controls,
  VideoPlayer's close does not `navigate(-1)` (there is nothing behind the kiosk),
  and an ended film with no next episode is put away after 15 s.
- **The kiosk's Chromium must not freeze hidden pages.** When the screen goes away
  (receiver swapped, 2026-10-20) the page counts as hidden, Chromium throttles and then
  freezes it, and the kiosk stopped polling for 2.7 hours. The flags that stop that are
  in `hemma/bio/kiosk/start.sh`; nothing in this app can work around a frozen page.
- **Never leave a response body unread** (`lib/fireAndForget.ts`). In Chromium an
  unread body keeps a `memfd:shared-memory-region` open until garbage collection, which
  does not count files. The kiosk's status PUT every 5 s leaked one each; after 80
  minutes of film the renderer reached its limit of 1 024 open files and died (found
  2026-10-21 by counting `/proc/<pid>/fd` per episode). Every request whose answer is
  not used goes through `fireAndForget`, which cancels the body; one whose answer is
  checked but not read cancels it itself (`pollBion`, `sendBion`).
- **The IPTV account allows one connection to the provider** (`max_connections` 1 in
  `player_api.php`; ask through `/proxy`, never from the home IP). With two open, or
  one closed a moment ago and still counted, the provider closes one: ffmpeg logs
  `Stream ends prematurely at …`, the fMP4 response ends, and the `<video>` stops a
  few seconds in. On 2026-10-23 Gabby's Dollhouse did that on Bion every try. Three
  layers since: ffmpeg and ffprobe reconnect at the same byte (`PROVIDER_RECONNECT`
  in `server.mjs`, proven against an origin that cuts: 4.8 of 120 s without, all
  of it with); `VideoPlayer` asks for the rest when `ended` comes far from the end
  (`premature-end` in the client log, three in a row at most); and the audio track
  is chosen in `load()` from the probe, before the first request, so opening a film
  is one `/transcode`, not two. The old effect also ran on the previous episode's
  track list and was spent before the new one arrived, so every episode after the
  first played track 1 (Danish). `e2e/audio-language.spec.ts` holds it.
- **Seeking a paused IPTV film starts it again** on the kiosk, because VideoPlayer's
  `seekTo` restarts the transcode and plays. Known, not fixed.
- **The remote** (`components/bion/BionRemote.tsx`) floats above the tab bar while
  the mode is on or something plays on Bion: title and time on one row, the buttons
  on the next (four 44 px buttons beside the title cut the time off on a phone), and
  between them a scrubber that seeks when the finger lets go. Safari draws a native
  range dark on dark, so the track is drawn and the input lies invisible on top. The
  captions button opens the film's audio and subtitle tracks above the title.
  It polls every 2.5 s while something is on, 5 s in Bion mode, 15 s otherwise,
  only while visible. `status.updated` is server time; the store keeps the clock
  skew from the poll's `now`.
- **Tests:** `src/lib/bion-api.test.ts` runs the API against an in-memory D1, pins
  the visibility, alive and seek rules, the webhook, and checks that Bion mode sends
  instead of playing. `e2e/bion-remote.spec.ts` drives the remote in iPhone WebKit:
  scrubber, track menu, and the warming-up state. The kiosk itself is checked on the real machine over the DevTools
  protocol (`KIOSK_FLAGS=--remote-debugging-port=9222`, see `hemma/hemmabio.md`).

## Feedback-box suggestions, October 2026

All five from 2026-09-11 were built and ticked off on 2026-10-11:

- **Continue Watching opens a show's overview** instead of playing; the
  overview's button reads "Fortsätt S2 · E3" when an episode is in progress.
- **Mark watched / unwatched** for a film (detail sheet), an episode, a season or
  a whole show (`src/services/watched.ts`). `/api/progress` takes lists (PUT an
  array, DELETE with `{ channelIds }`), batched 200 per request with D1 `batch`.
- **Covers.** Two faults. `withEnglishFallback` read `translations.find`, but TMDB
  sends `{ translations: { translations: [...] } }`. Every title without a
  Swedish overview threw, and `useTmdbEnrich` never released the slot of a lookup
  that threw. After three such titles nothing more got artwork, which is why most
  English shows had none while Swedish ones (and those in the proxy's shared
  cache) did. Also, grids enriched only the first 200 of a group; they now
  enrich what is rendered plus 40.
- **Popular right now** on Home: TMDB's weekly trending films and shows that are
  in the catalogue (`PopularRails`). A rail with fewer than four titles is not
  shown.
- **Genres** on Movies and Series: chips from TMDB. A genre shows TMDB's most
  popular titles in it that are here, and says so; the catalogue has no genres,
  so it is not "all comedies". Matching is by title and year:
  `src/lib/catalogMatch.ts`, with lists cached 12 h per language. The chips are
  44 px tall; they shipped at 36 and failed the touch audit on phone and iPad.

### 2026-10-15: no card plays on the first tap

Two reports: a Hemma film started straight away, and so did a film picked in
search or in Continue Watching. Fixed 2026-10-17. **The rule now: a card or a
search result opens the title; only a button that says Play plays.** The Hero's
Play, an episode row and the overview's "Fortsätt S2 · E3" are such buttons.

- **One sheet per source, mounted once in `App.tsx`.** `MovieDetailModal` reads
  `useDetailStore` (`openMovie(channel, meta?)`), `HomeDetailModal` reads
  `homeLibraryStore.detail`. Both are laid out by `ui/DetailSheet.tsx`. The film
  sheet owns watch later, watched and resume itself, so a page that opens it needs
  no handlers, and it looks the title up in TMDB when the opener had no metadata
  (search, Library).
- **Started means "Fortsätt titta", "Börja om" and the time left**
  (`resumePoint` in `lib/progress.ts`, the same ten-second threshold as the
  Continue Watching rows). Starting over clears the progress row before playing,
  because `VideoPlayer` resumes from that row; in Hemma it plays the item at 0.
- **A show goes to its overview** from every Continue Watching row and from
  "Recently added shows", which used to play the new episode.
- `e2e/detail-sheet.spec.ts` covers all of it, with Jellyfin answered by a
  stand-in. It refuses every request that is not the dev server, so it cannot
  reach the provider from the home IP.

### 2026-10-15: the four suggestions, built 2026-10-17

- **Seen or not, on every card.** `stores/watchStateStore.ts` holds the active
  profile's progress rows from one live query in `App.tsx`; `MovieCard`,
  `ShowCard` and `HomeCard` read their own row through it, so no page has to pass
  progress down (several never did). A finished title has a check in the bottom
  right (`ui/WatchedMarks.tsx`); the old check was drawn only on cards *without* a
  rating chip, which with TMDB artwork meant almost never. A show card counts its
  finished episodes against how many the catalogue has: a bar while some are
  left, the check when none are.
- **More like this.** The film sheet, the show overview and the home sheet end
  with a row of related titles (`home/RelatedRails.tsx`). For the catalogue it is
  `fetchRelated`: TMDB's recommendations, then its "similar" list, matched to what
  the profile can play, in memory only (one list per title opened would fill
  localStorage). Jellyfin's own `/Items/{id}/Similar` for the home library. Fewer
  than four matches and there is no row.
- **"Because you watched X" is about X now** (`hooks/useBecauseYouWatched.ts`).
  It was a shuffle of X's playlist group, so "VOD: English" was the reason given.
  Now it is `fetchRelated` for X, minus what is seen or dismissed, and the row is
  absent rather than padded when fewer than four remain.
- **Subtitle size**, per profile and synced (`lib/subtitleSize.ts`): four sizes
  that grow with the screen, chosen in Settings or in either player's subtitle
  menu. The overlay was a fixed 16 px. iOS draws subtitles itself in fullscreen,
  so there its own setting applies, and Settings says so.
- **VLC keeps your place**, on every device, not only the kiosk: see "Where VLC
  got to" below.

Found on the way and fixed: **a preferred language never matched.** Settings
store "sv", tracks are tagged "swe", and the check was
`track.lang.startsWith(pref)`. Swedish subtitles (Elof and Jossan's setting) and
Swedish audio (Vera and Noah's) were never picked automatically, nor Spanish
("spa") or German ("ger"). `lib/lang.ts` knows the two- and three-letter codes
and the names a track title may carry instead. Autoplay-next-episode was also
never synced between devices; it travels with the other preferences now.

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
misbehaves in the web player". Home-library films have a VLC button in their sheet
too: the file itself from Jellyfin, every track in it, a split film as a playlist
of its parts.

### Where VLC got to

Since 2026-10-17 every handover goes through `/api/playlist/…?d=…&r=…`, even a
single film, because the playlist is what carries two things a bare stream URL
cannot:

- **Where to start.** Each entry may carry the profile's position, written as
  `#EXTVLCOPT:start-time=` before it. `start-time` is one of the options libvlc 3
  marks safe, so VLC honours it from a fetched playlist (desktop for certain;
  VLC for iOS also resumes a URL it has played before by itself).
- **Where to report** (`r=`): a StreamForest profile, or a Jellyfin user and token.

**Desktop: the handler reports.** `public/vlc-handler.{sh,ps1}` install a helper
beside the launcher. Given a playlist link with `r=` it starts VLC itself with
its web interface on 127.0.0.1 (random port, a password made up per launch;
`--no-one-instance` on Windows, the binary rather than `open` on a Mac, or the
flags are lost to an already running VLC), reads `status.json` and the current
entry from `playlist.json` every ten seconds, and posts them with the link to
`/api/vlc-report`, plus once more when VLC closes. `src/lib/vlcReport.ts` decides
the rest: which entry is playing, finished past 90 %, and the row it writes to
`watch_progress` (newer wins, as in `/api/progress`). For a home film no Function
can reach Jellyfin, so the answer is `RELAY` and three lines the handler sends on
to `https://jellyfin.krutofv.se/Sessions/Playing…` itself. Answers are plain
lines because the Mac helper is a shell script with no JSON parser. Handlers
installed before 2026-10-17 do not report; running the one-liner again replaces
them.

**iPhone: the app asks.** VLC for iOS never hands a position back: its
x-callback opens the return link with nothing appended (vlc-ios#1089, open since
2015) and keeps its own resume point private. So `lib/vlcHandoff.ts` remembers a
handed-over film or episode, and when the app is in front again (at least 45 s
later, at most 12 h) `VlcReturnPrompt` first checks whether anything reported
meanwhile; if not, it asks how far you got, with the time away as the starting
guess on a slider. Nothing is written without a tap. A whole season is not asked
about. The x-success link is `/vlc-done` with no query, because VLC 3.7 cuts it at
the second `=`; a home-screen app gets none, since iOS would open it in Safari.

App coming back to the front now also re-reads positions from D1 (at most every
30 s). Before, they were read only on a profile switch, so a film paused on one
device looked unstarted on another until a reload.

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
- Pages secret `HA_BION_WEBHOOK` (set 2026-10-20): Home Assistant's webhook for the
  cinema, see *Bion*. The id is also in `hemma/.env` (`BION_WEBHOOK_ID`) and HA's
  `secrets.yaml`. A secret reaches a deployment only when it is built. Set it with
  wrangler's own login, not from `hemma/`, whose `.env` holds an expired `CF_API_TOKEN`
  that wrangler picks up.

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
| `ALLOWED_HOSTS` | `iptv.krutofv.se,nsclient.xyz,45.12.1.27` | Extra hosts. `iptv.krutofv.se` is always allowed by the code |
| `CF_DNS_TOKEN` | (secret, `~/services/transcode-proxy.env`) | Lets the fail-over repoint `iptv.krutofv.se`. Unset = it still switches its own connections, but not DNS |
| `PROVIDER_CONFIG_URL` | `https://streamforest.krutofv.se/api/provider` | Where the fail-over reads the IP list |
| `CLIENT_LOG_TOKEN` | (secret) | Required for `GET /clientlog`; unset = reads refused |
| `FFMPEG_PATH` | `ffmpeg` | |

**When "nothing plays", check the provider first: `node tools/provider.mjs`.**
It prints the DNS answer, whether the port is open, and the account's status.

**The provider is reached through `iptv.krutofv.se`, our name for its IP.** Its own
domains die: `iptvworld.xyz`, then `nsclient.xyz`, which lost its A record on
2026-09-23 and took the whole catalogue down unnoticed for over two weeks. The IP
is the stable part, but Cloudflare Workers refuse to fetch a raw address: the
request never leaves, and the caller gets a 403 with body `error code: 1003` that
reads exactly like a provider rejection. So the IP gets a name in our zone, a
DNS-only A record, and everything uses that name:

- `m3u_url` in D1 (`user_preferences`, profile `_global`) points at
  `iptv.krutofv.se:<port>`. The EPG URL is derived from it (`src/services/epg.ts`).
- `functions/proxy.ts` and `transcode-proxy/server.mjs` always allow
  `iptv.krutofv.se`. `PROXY_ALLOWED_HOSTS` and `ALLOWED_HOSTS` only add extras.
- The stream URLs *inside* the playlist carry whatever domain the provider's panel
  was configured with, which can be dead. `src/lib/provider.ts` recognises them by
  the account credentials in their path and points them at the playlist's host. It
  does this on the way out, in `playerStore.play()` and the VLC hand-off, so a
  catalogue stored before a move plays without a refresh. Only the host name
  changes: the panel serves the playlist on one port and names another for
  streams, and the stream's port is the one to keep.

**The provider has several IPs, and the home server fails over between them.**
Settings → Playlist source has four IP fields, in order of preference. They are
stored in D1 (`_global/provider_ips`) and served at `GET /api/provider`.
`transcode-proxy/provider.mjs` reads that list every ten minutes and asks the IP in use
for any HTTP answer. When none comes, it tries the others in order, and the first
that answers becomes active:

- this server uses it at once: `provider.resolve()` swaps our name for the IP at
  every place it connects to the provider (ffmpeg/ffprobe inputs, the EPG fetch);
- it repoints the DNS record, so the playlist download and VLC follow within the
  60 s TTL.

A failed probe triggers a check at once. That is what makes the fail-over fast, so the
ten-minute round is only a backstop: one small request, never all four addresses. It does
not move back when an earlier IP recovers, because moving costs a blip. Its state
is at `GET /provider-status` on the transcode server, and Settings shows it per IP:
*in use / answers / no answer*. Caches and keys keep using the name, never the IP,
so the EPG cache does not split per server.

**When the provider moves, it is done in the app.** The admin pastes the new
playlist URL and/or edits the IP list in Settings → Playlist source. Any change to
either asks for the admin PIN and posts to `functions/api/provider.ts`, which:

- checks the PIN of profile `elof` server-side. Five wrong in an hour lock it for
  the hour (`provider_attempts` in D1);
- resolves a domain to its IPv4 once, and **refuses anything that is not a public
  address**. Whatever the record points at becomes an allowed host for the
  transcode server, so it must never be aimed into the home network;
- stores up to four IPs in order. An IP from the pasted URL goes first if it is not
  listed. Each must be a public IPv4;
- points the A record at the first, **unless it already points at a listed IP**,
  because the fail-over may have put it there. Then it stores `m3u_url` on our name;
- asks `player_api.php` whether the account answers, and reports it. A failing
  check does not undo the move.

It needs the Pages secret `CF_DNS_TOKEN`: Cloudflare's "Edit zone DNS" template,
limited to krutofv.se. The zone id is in the code, because that template cannot
list zones. Secrets reach a deployment only when it is built, so set it before the
deploy that should use it. Without it, Settings says the move is switched off.

`node tools/provider.mjs` is the status check and the fallback when the app
itself is down: `<ip>` moves the record, `--m3u` moves `m3u_url`. It reads the same
key as `CF_DNS_TOKEN` from the environment, `.env.local` or `../hemma/.env`.

**Never let the home IP look like a scraper. The provider blocks it on all four
servers for about four hours, and everything that streams comes from that IP.**
Two blocks so far, both caused from here:

- **Posters on the provider's own servers.** About 7 000 playlist logos are
  `http://Ptv.is:2095/images/…`, and `ptv.is` is one of the four streaming
  servers. On the https page the browser upgrades each one to https, against an
  http port. The picture can never load, but every attempt reaches the provider
  as a malformed request. A poster grid makes hundreds in seconds. Since
  2026-10-11 `safeImageUrl` (`src/lib/images.ts`) drops every non-https logo, at
  import and when a stored catalogue is loaded.
- **Automated tests against production from this machine.** Run on the home
  network, they browse at the home IP. Block the provider's hosts in the test
  (`context.route(/ptv.is|88.135…/, r => r.abort())`), and do not make fresh
  browser profiles download the playlist again and again.

**Also: never download the full playlist from the home server by hand.** On 2026-10-10,
two `get.php` downloads (60 MB each) a few minutes apart, made to compare group
names, were followed by the provider blocking the home IP on all four servers. The
account stayed active, as `/proxy` from Cloudflare showed. Everything that
streams comes from the home IP, so that is the one address that must never look
like a scraper. Read groups from a device's IndexedDB, or through `/proxy`.

The symptom of a dead provider is "playback is broken" everywhere at once, which
reads as a player bug and is not one. The transcode server logs it daily:
`[epg] refresh error` instead of `[epg] cached` at 07:00 UTC.

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
- Tunnel: `hemservern` (`629a0479-9537-40ad-94ad-af55706dc9cf`) — hette
  `streamforest-transcode` till 2026-09-15. Namnet byttes för att tunneln bär sex värdnamn och
  bara ett är StreamForests: Skafferiet, Snilles API och TTS ligger på samma. Allt pekar på
  UUID:t, så bytet rörde varken DNS eller ingress. Värdnamnet
  `7878bd57-streamforest-transcode.krutofv.se` heter fortfarande så.
- Domain: `krutofv.se`
