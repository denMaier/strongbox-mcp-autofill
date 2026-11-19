#!/bin/sh
# Renders assets/icon.svg to the PNG icons in icons/. macOS only (Quick Look and sips).
# Run after changing the SVG, and commit the PNGs; the build only copies them.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
qlmanage -t -s 128 -o "$tmp" ../assets/icon.svg >/dev/null
for size in 16 32 48 128; do
  sips -z "$size" "$size" "$tmp/icon.svg.png" --out "icons/$size.png" >/dev/null
done
