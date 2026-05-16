#!/usr/bin/env bash
# Compiles the bundled GPL dvmvocoder + p25_wasm.cpp into a self-contained
# WebAssembly ES module (src/vendor/imbeModule.js).
#
# Requires Emscripten (emcc) on PATH. The simplest way without installing it:
#   docker run --rm -v "$PWD":/src -w /src emscripten/emsdk \
#     bash server/web-console/cpp/build-vocoder.sh
#
# The generated imbeModule.js is committed, so deploys need no toolchain.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
voc="$here/../../../android-app/app/src/main/cpp/dvmvocoder/vocoder"
out="$here/../src/vendor/imbeModule.js"

mkdir -p "$(dirname "$out")"

emcc \
  -O3 -DNDEBUG \
  -I "$voc" -I "$voc/imbe" \
  "$voc"/imbe/*.cpp \
  "$voc"/*.cpp \
  "$voc"/*.c \
  "$here/p25_wasm.cpp" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s SINGLE_FILE=1 \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_imbe_init","_imbe_encode","_imbe_decode","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAP16","HEAPU8"]' \
  -o "$out"

echo "Built $out"
