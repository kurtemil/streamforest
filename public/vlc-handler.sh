#!/bin/bash
# Registers a `vlc://` URL handler on macOS so StreamForest's "Open in VLC"
# buttons launch VLC directly instead of downloading a .m3u to open by hand,
# and so VLC tells StreamForest where you got to.
#
# Served at /vlc-handler.sh — Settings → VLC hands out the one-line command that
# pipes it into bash. Also runnable from a clone: bash public/vlc-handler.sh
# Running it again replaces an older install; that is how the reporting arrived.
#
# Uninstall: rm -rf "$HOME/Applications/VLC URL Handler.app"
set -euo pipefail

APP="$HOME/Applications/VLC URL Handler.app"
PLIST="$APP/Contents/Info.plist"

if [ ! -d "/Applications/VLC.app" ] && [ ! -d "$HOME/Applications/VLC.app" ]; then
  echo "⚠️  VLC itself was not found in /Applications — install it first: https://www.videolan.org/vlc/"
fi

rm -rf "$APP"
mkdir -p "$HOME/Applications"

# A tiny AppleScript app: strips the leading "vlc://", decodes the colons and
# hands the rest to the helper below, in the background so the app quits at once.
#
# The page sends every colon as %3A — a literal one does not survive the trip:
# the browser parses `vlc://https://…` before dispatching, reads `https:` as a
# host with an empty port, and serializes the colon away. See vlcSchemeLink()
# in src/lib/vlc.ts, the other half of this contract. The starts-with repairs
# cover a still-open tab running the page from before that contract existed.
osacompile -o "$APP" -e 'on open location u
	set theURL to text 7 thru -1 of u
	set text item delimiters to "%3A"
	set theParts to text items of theURL
	set text item delimiters to ":"
	set theURL to theParts as text
	set text item delimiters to ""
	if theURL starts with "https//" then set theURL to "https://" & text 8 thru -1 of theURL
	if theURL starts with "http//" then set theURL to "http://" & text 7 thru -1 of theURL
	set helper to POSIX path of (path to me) & "Contents/Resources/vlc-open.sh"
	do shell script "/bin/bash " & quoted form of helper & " " & quoted form of theURL & " > /dev/null 2>&1 &"
end open location'

# The helper. Plain links open in VLC as before. A StreamForest playlist link
# that carries a report target (r=) starts VLC with its web interface on
# 127.0.0.1, behind a password made up for this one launch, and every ten
# seconds posts where playback is to StreamForest's /api/vlc-report. For a film
# from the home server the answer says what to tell Jellyfin, which this machine
# reaches and Cloudflare does not. When VLC closes, one last report.
#
# Starting the VLC binary directly, not through `open`, is what makes the flags
# count: `open -a VLC --args` hands them to a VLC that is already running, which
# ignores them. A second VLC window is the price.
cat > "$APP/Contents/Resources/vlc-open.sh" <<'HELPER'
#!/bin/bash
url="$1"
VLC="/Applications/VLC.app/Contents/MacOS/VLC"
[ -x "$VLC" ] || VLC="$HOME/Applications/VLC.app/Contents/MacOS/VLC"

reporting=0
case "$url" in
  https://streamforest.krutofv.se/api/playlist/*|https://*.streamforest.pages.dev/api/playlist/*)
    case "$url" in *'&r='*|*'?r='*) reporting=1 ;; esac ;;
esac
if [ "$reporting" = 0 ] || [ ! -x "$VLC" ]; then exec open -a VLC "$url"; fi

origin="${url%%/api/playlist/*}"
port=$(( 49152 + RANDOM % 16000 ))
pass=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
"$VLC" --extraintf=http --http-host=127.0.0.1 --http-port="$port" --http-password="$pass" "$url" >/dev/null 2>&1 &
pid=$!

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
first=true
post() { # time length state uri final
  body=$(printf '{"src":"%s","time":%s,"length":%s,"state":"%s","uri":"%s","first":%s,"final":%s}' \
    "$(esc "$url")" "$1" "$2" "$(esc "$3")" "$(esc "$4")" "$first" "$5")
  answer=$(curl -s -m 8 -X POST -H 'Content-Type: application/json' --data-binary "$body" "$origin/api/vlc-report")
  first=false
  if [ "$(printf '%s\n' "$answer" | sed -n 1p)" = "RELAY" ]; then
    path=$(printf '%s\n' "$answer" | sed -n 2p)
    auth=$(printf '%s\n' "$answer" | sed -n 3p)
    data=$(printf '%s\n' "$answer" | sed -n 4p)
    case "$path" in
      /Sessions/Playing|/Sessions/Playing/Progress|/Sessions/Playing/Stopped)
        curl -s -m 8 -X POST -H "Authorization: $auth" -H 'Content-Type: application/json' \
          --data-binary "$data" "https://jellyfin.krutofv.se$path" >/dev/null ;;
    esac
  fi
}

last_time=""
while kill -0 "$pid" 2>/dev/null; do
  sleep 10
  status=$(curl -s -m 3 -u ":$pass" "http://127.0.0.1:$port/requests/status.json") || continue
  time=$(printf '%s' "$status" | grep -o '"time":[0-9]*' | head -1 | cut -d: -f2)
  length=$(printf '%s' "$status" | grep -o '"length":[0-9]*' | head -1 | cut -d: -f2)
  state=$(printf '%s' "$status" | grep -o '"state":"[a-z]*"' | head -1 | cut -d'"' -f4)
  [ -n "$time" ] && [ -n "$length" ] || continue
  playlist=$(curl -s -m 3 -u ":$pass" "http://127.0.0.1:$port/requests/playlist.json")
  uri=$(printf '%s' "$playlist" | tr -d '\n' | grep -o '{[^{}]*"current":"current"[^{}]*}' \
    | grep -o '"uri":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's#\\/#/#g')
  last_time=$time; last_length=$length; last_uri=$uri
  post "$time" "$length" "$state" "$uri" false
done
[ -n "$last_time" ] && post "$last_time" "$last_length" "stopped" "$last_uri" true
HELPER
chmod +x "$APP/Contents/Resources/vlc-open.sh"

# Declare the vlc:// scheme in the app bundle so Launch Services routes it here.
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string 'VLC URL'" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string 'vlc'" "$PLIST"

# Register the bundle with Launch Services immediately.
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
"$LSREG" -f "$APP"

echo "✅ Installed: $APP"
echo "   Go back to StreamForest → Settings → VLC and press Test."
