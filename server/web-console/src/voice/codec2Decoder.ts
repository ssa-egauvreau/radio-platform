/**
 * Web Codec2 decoder — placeholder.
 *
 * voiceClient currently drops inbound `codec2_3200` frames with a one-shot
 * warning (see handleAudio); this file holds the integration plan so the
 * decoder can land cleanly when libcodec2's WASM is vendored.
 *
 * Why this is still a stub: Codec2 is a C library (~50 source files) from
 * Rowetel that needs to be compiled to WebAssembly with Emscripten. The
 * vendoring + build is best done as its own commit so the diff stays
 * reviewable.
 *
 * Vendoring + build plan:
 *
 *   1. Add codec2.wasm + codec2.js (the Emscripten output) under
 *      `server/web-console/public/vocoder/codec2/`. Either:
 *        a) build from source with the steps in
 *           https://github.com/drowe67/codec2#building-on-other-platforms
 *           (use Emscripten 3.x, target wasm-emscripten), or
 *        b) pull a pre-built artifact from a community build like the
 *           one in https://github.com/m17-foundation/codec2-wasm.
 *
 *   2. Mirror the imbeVocoder.ts loader pattern in
 *      `server/web-console/src/voice/codec2Vocoder.ts`:
 *        - dynamic import of the Emscripten glue
 *        - lazy WASM instantiation
 *        - typed wrappers around codec2_create(CODEC2_MODE_3200),
 *          codec2_encode (320 PCM samples → 8 bytes), and
 *          codec2_decode (8 bytes → 320 PCM samples).
 *
 *   3. Replace the body of `decodeCodec2Frame` below with a call into the
 *      loaded WASM, and update voiceClient.ts to route `codec2_3200` to
 *      this decoder via `schedulePcm` (same shape as the Opus decoder).
 *
 *   4. Encode-side: voiceClient's TX worklet message handler is currently
 *      synchronous and shaped for IMBE. Codec2 encode is synchronous too,
 *      so adding the encoder is a near-mechanical mirror of `encodeImbeFrames`
 *      — different frame size (320 samples = 40 ms at 8 kHz; that bumps
 *      the per-WebSocket-message cadence). Decide whether the relay holds
 *      the same 20 ms cadence (so two Codec2 frames per message) or moves
 *      to 40 ms for Codec2 specifically.
 *
 * Notes for whoever lands this:
 *  - 3200 bps mode emits 64 bits per 40 ms frame. Wire framing today is
 *    one payload per WebSocket message; keep that to mirror IMBE.
 *  - native output is 8 kHz, so re-use the existing `upsample8kTo16k`
 *    helper from voiceClient (or the agency post-decode chain when
 *    configured).
 */

export type Codec2DecodeResult = Int16Array | null;

/** Returns false until libcodec2 WASM is vendored and the loader below
 *  is implemented. voiceClient uses this to decide whether to dispatch
 *  Codec2 frames or drop them with a warning. */
export function codec2DecoderReady(): boolean {
  return false;
}

/** Stub — wired into voiceClient.handleAudio when libcodec2 lands.
 *  See module doc for the vendoring + build plan. */
export function decodeCodec2Frame(_opusPayload: Uint8Array): Codec2DecodeResult {
  return null;
}
