# StreamForest Transcode Proxy

Node HTTP service that fetches an upstream stream URL, pipes it through ffmpeg and streams fragmented MP4 (or generated HLS) to the browser. It started out solving the "Chrome plays video but no audio" problem on AC3 MKV VOD, and has since grown into the path **all** VOD and live playback takes: `VideoPlayer` routes every `movie`/`series` item through `/transcode` regardless of file extension, and live through `liveStreamUrl()`.

## Endpoints

- `GET /transcode?url=<encoded>&start=<seconds>` → streams `video/mp4`
- `GET /health` → `ok`
- `GET /probe` → container/audio/subtitle info, used before VOD playback
- `GET /keyframe` → still frame for scrubbing previews
- `GET /subtitle` → extracted embedded subtitle track
- `GET /epg` → cached XMLTV guide data
- `GET /tmdb` → cached TMDB lookups
- `GET /hls-start` and `GET /hls-file/*` → generated HLS, used by the iOS live path
- `POST /clientlog` → client-side log sink, read by `npm run logs`

`url` must be on an allowed host (`ALLOWED_HOSTS`, comma-separated, default `iptvworld.xyz`).

## Run locally

Requires `ffmpeg` on PATH.

```bash
node server.mjs
# or
npm start
```

## Run via Docker locally

```bash
docker build -t streamforest-transcode .
docker run --rm -p 8787:8787 streamforest-transcode
```

## Deploy

Production is the ProDesk at home, via `docker compose`, reached through a Cloudflare
Tunnel at `https://7878bd57-streamforest-transcode.krutofv.se`. See `CLAUDE.md`.

`fly.toml` is kept for reference but **Fly is not active**:

```bash
fly launch --copy-config --no-deploy   # first time only, accept defaults
fly deploy
```

## Client wiring

In the app, set `VITE_TRANSCODE_PROXY_URL` (production: `https://7878bd57-streamforest-transcode.krutofv.se`) and rebuild. `VideoPlayer` routes all VOD through `${proxy}/transcode?url=...` and live through the proxy's live path automatically.
