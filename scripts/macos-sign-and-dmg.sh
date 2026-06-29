#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/Agent Light.app"
ENT="$ROOT/src-tauri/Entitlements.plist"
VERSION="$(node -p "require('$ROOT/package.json').version")"
DMG_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
DMG_PATH="$DMG_DIR/Agent Light_${VERSION}_aarch64.dmg"

if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP" >&2
  exit 1
fi

xattr -cr "$APP"

codesign --force --deep --sign - --entitlements "$ENT" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

if codesign -dvv "$APP" 2>&1 | grep -qE 'flags=.*runtime'; then
  echo "ERROR: hardened runtime is enabled; Gatekeeper requires notarization." >&2
  exit 1
fi

mkdir -p "$DMG_DIR"
rm -f "$DMG_DIR"/*.dmg

hdiutil create -volname "Agent Light" -srcfolder "$APP" -ov -format UDZO "$DMG_PATH"

echo "Created $DMG_PATH"
