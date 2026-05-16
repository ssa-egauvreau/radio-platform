// SPDX-License-Identifier: GPL-2.0-only
// WebAssembly bridge around the bundled dvmvocoder (GPL-2.0; see
// android-app/app/src/main/cpp/dvmvocoder). Browser counterpart of p25_jni.cpp.

#include <cstdint>
#include <new>

#include <emscripten/emscripten.h>

#include "MBEDecoder.h"
#include "MBEEncoder.h"

using namespace vocoder;

namespace {
MBEEncoder* gEncoder = nullptr;
MBEDecoder* gDecoder = nullptr;
} // namespace

extern "C" {

/** Allocates the IMBE encoder/decoder. Returns 1 on success. */
EMSCRIPTEN_KEEPALIVE
int imbe_init() {
  delete gEncoder;
  delete gDecoder;
  gEncoder = new (std::nothrow) MBEEncoder(ENCODE_88BIT_IMBE);
  gDecoder = new (std::nothrow) MBEDecoder(DECODE_88BIT_IMBE);
  if (gEncoder != nullptr) {
    gEncoder->setGainAdjust(1.0f);
  }
  return (gEncoder != nullptr && gDecoder != nullptr) ? 1 : 0;
}

/** 160 PCM samples (8 kHz, int16) -> 11-byte IMBE codeword. */
EMSCRIPTEN_KEEPALIVE
int imbe_encode(int16_t* samples160, uint8_t* codeword11) {
  if (gEncoder == nullptr) {
    return 0;
  }
  gEncoder->encode(samples160, codeword11);
  return 1;
}

/** 11-byte IMBE codeword -> 160 PCM samples (8 kHz, int16). */
EMSCRIPTEN_KEEPALIVE
int imbe_decode(uint8_t* codeword11, int16_t* samples160) {
  if (gDecoder == nullptr) {
    return 0;
  }
  gDecoder->decode(codeword11, samples160);
  return 1;
}

} // extern "C"
