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
  if (gDecoder != nullptr) {
    // Defensive — matches the Android JNI bridge. The MBEDecoder constructor
    // now defaults autoGain to true, but keep the explicit set so any future
    // upstream churn that drops the default still leaves audio loud + level.
    gDecoder->setAutoGain(true);
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

// --- per-stream decoders -------------------------------------------------
// IMBE decoding keeps frame-to-frame history, so each concurrent digital
// stream needs its own decoder; a shared one corrupts interleaved traffic.

EMSCRIPTEN_KEEPALIVE
MBEDecoder* imbe_decoder_create() {
  auto* decoder = new (std::nothrow) MBEDecoder(DECODE_88BIT_IMBE);
  if (decoder != nullptr) {
    // Same reason as imbe_init() — match the Android JNI behaviour so the
    // per-stream decoder doesn't silently fall back to a flat 1.0 gain.
    decoder->setAutoGain(true);
  }
  return decoder;
}

EMSCRIPTEN_KEEPALIVE
void imbe_decoder_free(MBEDecoder* decoder) {
  delete decoder;
}

EMSCRIPTEN_KEEPALIVE
int imbe_decoder_decode(MBEDecoder* decoder, uint8_t* codeword11, int16_t* samples160) {
  if (decoder == nullptr) {
    return 0;
  }
  decoder->decode(codeword11, samples160);
  return 1;
}

} // extern "C"
