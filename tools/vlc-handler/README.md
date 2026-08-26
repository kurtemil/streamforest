# `vlc://` URL handler (desktop one-click)

StreamForest's **Open in VLC** button sends content to VLC. On phones this is a
one-tap deeplink. On desktop, VLC registers no URL scheme out of the box, so the
button downloads a `.m3u` you open manually — **unless** you install the handler
here, after which the button opens VLC directly.

The app stays backward-compatible: if no handler is installed, it silently falls
back to the `.m3u` download.

## macOS

```bash
bash tools/vlc-handler/install-macos.sh
```

Creates a small `VLC URL Handler.app` in `~/Applications` that owns the `vlc://`
scheme and forwards the stream URL to VLC. First launch may ask permission to
control VLC — allow it.

Uninstall: `rm -rf "$HOME/Applications/VLC URL Handler.app"`

## Windows

Double-click `tools\vlc-handler\windows\install.cmd` (no admin needed — it writes
to `HKCU`). It copies a tiny launcher to `%LOCALAPPDATA%\StreamForest` and points
the `vlc://` protocol at it. Assumes VLC is in the default
`C:\Program Files\VideoLAN\VLC` location.

Uninstall: `reg delete "HKCU\Software\Classes\vlc" /f`

## How it works

The button navigates to `vlc://<url>`. The handler strips the `vlc://` prefix and
runs `vlc <url>`, so VLC plays the original provider stream directly — MPEG-TS,
MKV, AC3/DTS, embedded subs — bypassing the transcode proxy entirely.

For a whole season the `<url>` is not a stream but StreamForest's own
`/api/playlist/<show>.m3u?d=…`, which answers with the season as a playlist. VLC
fetches it and plays the episodes in order. Same handler, nothing extra to
install.
