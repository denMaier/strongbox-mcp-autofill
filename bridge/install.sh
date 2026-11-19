#!/bin/sh
# Builds the bridge as a small .app and registers it with Helium, Chrome and Search.
# Undo with: ./install.sh --remove
set -eu

here=$(cd "$(dirname "$0")" && pwd)
name=io.github.denmaier.strongbox_bridge
support="$HOME/Library/Application Support"
# Helium reads its own folder. Chrome and Search both read Chrome's.
browsers="net.imput.helium Google/Chrome"

# Strongbox only accepts MCP hosts installed under /Applications.
app="/Applications/Strongbox Browser Bridge.app"

if [ "${1:-}" = "--remove" ]; then
  for browser in $browsers; do
    rm -f "$support/$browser/NativeMessagingHosts/$name.json"
  done
  rm -rf "$app"
  echo "Removed the registrations and $app"
  exit 0
fi

swift build -c release --package-path "$here"

binary="$app/Contents/MacOS/strongbox-browser-bridge"

stage=$(mktemp -d "${TMPDIR:-/tmp}/strongbox-browser-bridge.XXXXXX")
trap 'rm -rf "$stage"' EXIT
staged_app="$stage/Strongbox Browser Bridge.app"
mkdir -p "$staged_app/Contents/MacOS"
cp "$here/.build/release/strongbox-browser-bridge" "$staged_app/Contents/MacOS/"
cat > "$staged_app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.github.denmaier.strongbox-browser-bridge</string>
  <key>CFBundleName</key><string>Strongbox Browser Bridge</string>
  <key>CFBundleDisplayName</key><string>Strongbox Browser Bridge</string>
  <key>CFBundleExecutable</key><string>strongbox-browser-bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

codesign --options runtime --sign "${SIGN_IDENTITY:-Apple Development}" "$staged_app"
rm -rf "$app"
ditto "$staged_app" "$app"

# A browser reads the first file with this name, so each lists every extension ID.
# The bridge itself checks which browser may use which ID.
for browser in $browsers; do
  manifest="$support/$browser/NativeMessagingHosts/$name.json"
  mkdir -p "$(dirname "$manifest")"
  cat > "$manifest" <<EOF
{
  "name": "$name",
  "description": "Strongbox Browser Bridge",
  "path": "$binary",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://lkgpmndbggpfaeenpehmblmbgmkbcbnk/",
    "chrome-extension://nmoagjmbdnebfnhachgpglincjficfkg/"
  ]
}
EOF
done
echo "Registered $binary"
codesign -dv "$app" 2>&1 | grep -E "^(Identifier|TeamIdentifier|Signature)="
