# StreamForest Transcode Proxy

Tiny Node HTTP service that fetches an upstream MKV URL, pipes it through ffmpeg to transcode AC3 → AAC (video copied as-is), and streams fragmented MP4 to the browser. Fixes the "Chrome plays video but no audio" problem on raw MKV VOD content.

## Endpoints

- `GET /transcode?url=<encoded>&start=<seconds>` → streams `video/mp4`
- `GET /health` → `ok`

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

## Deploy to Fly.io

```bash
fly launch --copy-config --no-deploy   # first time only, accept defaults
fly deploy
```

Free tier: 3 shared VMs + 160GB/month bandwidth. `auto_stop_machines` lets the VM sleep when idle.

## Client wiring

In the app, set `VITE_TRANSCODE_PROXY_URL` (e.g. `https://streamforest-transcode.fly.dev`) and rebuild. The `VideoPlayer` will route `.mkv` URLs through `${proxy}/transcode?url=...` automatically.
