#!/usr/bin/env bash
# safeT PTT iOS — bootstrap a fresh checkout.
#
# Creates Local.xcconfig from the template (if missing) and regenerates the
# Xcode project. Safe to run repeatedly.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f Local.xcconfig ]; then
  cp Local.example.xcconfig Local.xcconfig
  echo "Created ios-app/Local.xcconfig from the template."
  echo "Edit it with your Railway URL + RADIO_API_KEY before shipping a build."
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen not found. Install it with:  brew install xcodegen" >&2
  exit 1
fi

# The iOS project pulls libcodec2 sources straight from
# ../android-app/app/src/main/cpp/codec2, which is a git submodule. If a
# developer cloned without --recursive, fetch it now so xcodegen can
# resolve the source file paths.
if [ -f ../.gitmodules ] && [ ! -f ../android-app/app/src/main/cpp/codec2/src/codec2.h ]; then
  echo "Initialising libcodec2 submodule…"
  (cd .. && git submodule update --init --recursive)
fi

xcodegen generate
echo "Project regenerated. Open SafeTMobile.xcodeproj in Xcode."
