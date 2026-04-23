# StreamForest Transcode Proxy — Home Assistant Add-on

HTTP proxy that re-encodes MKV streams with browser-incompatible audio codecs (AC3 / EAC3 / DTS / TrueHD) to AAC on the fly, so they play in Chrome/Firefox/etc.

Designed to run on a Raspberry Pi 4 (hardware-accelerated via `h264_v4l2m2m`) but works on any HA host.

## Endpoints

- `GET /transcode?url=<encoded>&start=<seconds>` → streams `video/mp4`
- `GET /probe?url=<encoded>` → `{ duration, audioCodec, videoCodec }`
- `GET /health` → `ok`

## Options

| Option          | Default              | Description                                                                 |
|-----------------|----------------------|-----------------------------------------------------------------------------|
| `allowed_hosts` | `iptvworld.xyz`      | Comma-separated list of hostnames that `url=` is allowed to point at.       |
| `h264_encoder`  | `h264_v4l2m2m`       | `libx264` (software) or `h264_v4l2m2m` (Pi hardware). Software works everywhere but is much slower. |
| `h264_preset`   | `ultrafast`          | x264 preset. Ignored for hardware encoders.                                 |
| `log_level`     | `warning`            | ffmpeg log verbosity.                                                       |

## Port

The add-on listens on `8787`. Don't expose this to the public internet directly — route it through a Cloudflare Tunnel (via the official Cloudflared add-on) or similar.
