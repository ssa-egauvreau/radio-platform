package com.securityradio.ptt.device

/**
 * Codec2 3200 bps encoder + decoder — placeholder.
 *
 * The wire framing and registry slot are in place so the admin can already
 * flip a channel to `codec2_3200`; this implementation reports [isReady] =
 * false until the underlying libcodec2 build lands. Until then:
 *
 *  - [VoiceCodecRegistry.encodableCodecs] will exclude Codec2, so the server
 *    knows this client cannot TX in Codec2 (the server's per-channel codec
 *    push still arrives; the registry falls back to IMBE for TX).
 *  - [VoiceCodecRegistry.decoderForMagic] returns this decoder for inbound
 *    Codec2 frames; [decodeFrame] returns null and the transport drops the
 *    frame rather than playing garbage.
 *
 * Next step: vendor libcodec2 C source under `app/src/main/cpp/codec2/`
 * and wire it through the existing CMake setup (mirror dvmvocoder), then
 * add a `Codec2Native` JNI bridge. The 3200 bps mode emits 8 samples per
 * 20 ms frame (8 bytes = 64 bits) at 8 kHz output sample rate.
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
