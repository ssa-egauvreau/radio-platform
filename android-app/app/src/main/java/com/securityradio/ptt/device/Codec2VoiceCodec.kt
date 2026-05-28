package com.securityradio.ptt.device

/**
 * Codec2 3200 bps encoder + decoder — placeholder.
 *
 * Reports [isReady] = false until the libcodec2 native build lands. The
 * registry falls back to IMBE on TX while Codec2 is unavailable, and
 * inbound Codec2 frames drop with a log instead of being played as
 * garbage at the speaker.
 *
 * Why this is still a stub: libcodec2 is a C library (~50 source files)
 * from Rowetel; vendoring its source into the repo is best done as its
 * own commit with the build wiring (CMakeLists, JNI bridge) so the diff
 * stays reviewable. Once that lands, replace the bodies below with real
 * calls into `Codec2Native`.
 *
 * Vendoring + build plan:
 *
 *   1. Add libcodec2 sources at
 *      `android-app/app/src/main/cpp/codec2/src/`
 *      from https://github.com/drowe67/codec2 (BSD-3-Clause; vendor
 *      the `src/`, `unittest/codec2.h` headers, and the minimum
 *      generated codebook files).
 *
 *   2. Add a CMake target alongside `dvmvocoder` in
 *      `android-app/app/src/main/cpp/CMakeLists.txt`:
 *        add_library(codec2 STATIC <list of c sources>)
 *        target_include_directories(codec2 PUBLIC codec2/src codec2/unittest)
 *        target_link_libraries(securityradiovocoder codec2)
 *
 *   3. Create a JNI bridge `cpp/codec2bridge.cpp` exposing:
 *        - `codec2_init(int mode)` → opaque handle
 *        - `codec2_encode(handle, int16_t* pcm8k, uint8_t* out)`
 *        - `codec2_decode(handle, uint8_t* bits, int16_t* pcm8k)`
 *        - `codec2_free(handle)`
 *      mode = CODEC2_MODE_3200 from `codec2.h`; produces 8 bytes per
 *      40 ms frame (so each WebSocket message holds 2 codewords if we
 *      keep the 20 ms cadence, or we step the relay to 40 ms framing —
 *      decide before wiring).
 *
 *   4. Add a `Codec2Native` Kotlin singleton mirroring [P25ImbeNative],
 *      and replace the bodies of [Codec2Encoder] / [Codec2Decoder]
 *      below with calls into it.
 *
 * Notes for whoever lands this:
 *  - 3200 bps mode emits 64 bits per 40 ms frame. The wire framing here
 *    is one Codec2 payload per WebSocket message; the relay forwards by
 *    magic, so any payload length following 0xC2 0x01 is valid. Keep
 *    Codec2 payloads as one frame per message to mirror IMBE's cadence.
 *  - downsample from 16 kHz capture to 8 kHz via the same average-pair
 *    path [P25ImbeNative.Frames.downsampleAvg16kToImbe] uses.
 *  - upsample from 8 kHz decode to 16 kHz via the same duplicate path,
 *    or run through [PostDecodeChain] if the agency has shaping set.
 */

class Codec2Encoder : VoiceEncoder {
    override val codec: VoiceCodec = VoiceCodec.CODEC2_3200
    override val isReady: Boolean get() = false

    override fun encodeFrame(pcm16kLe640: ByteArray): ByteArray? = null
}

class Codec2Decoder : VoiceDecoder {
    override val codec: VoiceCodec = VoiceCodec.CODEC2_3200
    override val isReady: Boolean get() = false
    override val nativeSampleRate: Int = 8000

    override fun decodeFrame(framedBytes: ByteArray): ShortArray? = null
}
