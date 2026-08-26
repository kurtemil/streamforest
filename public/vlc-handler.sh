#!/bin/bash
# Registers a `vlc://` URL handler on macOS so StreamForest's "Open in VLC"
# buttons launch VLC directly instead of downloading a .m3u to open by hand.
#
# Served at /vlc-handler.sh — Settings → VLC hands out the one-line command that
# pipes it into bash. Also runnable from a clone: bash public/vlc-handler.sh
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

# A tiny AppleScript app: strips the leading "vlc://" and hands the rest to VLC.
# The rest is a stream URL for one episode, or a link to a .m3u for a season.
osacompile -o "$APP" -e 'on open location u
	set theURL to text 7 thru -1 of u
	do shell script "open -a VLC " & quoted form of theURL
end open location'

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
