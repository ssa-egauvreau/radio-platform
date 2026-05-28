package com.securityradio.ptt.device

/**
 * IMBE encoder + decoder, wrapping [P25ImbeNative] in the [VoiceEncoder] /
 * [VoiceDecoder] interfaces so it slots into [VoiceCodecRegistry] alongside
 * Codec2 and Opus. Wire format is unchanged: 2-byte magic (0xF5 0xAB) +
 * 11-byte 88-bit IMBE codeword = 13 bytes total per 20 ms frame.
 *
 * The encoder downsamples the uniform 16 kHz input to 8 kHz internally
 * (matching the historical `downsampleAvg16kToImbe` path). The decoder
 * emits 8 kHz samples; the transport layer upsamples + post-processes via
 * the agency's [PostDecodeChain] before playback.
 */

class ImbeEncoder : VoiceEncoder {
    override val codec: VoiceCodec = VoiceCodec.IMBE
    override val isReady: Boolean get() = P25ImbeNative.isAvailable

    override fun encodeFrame(pcm16kLe640: ByteArray): ByteArray? {
        if (!P25ImbeNative.isAvailable) return null
        if (pcm16kLe640.size < P25ImbeNative.Frames.PCM_16K_FRAME_BYTES) return null
        val imbeIn = P25ImbeNative.Frames.downsampleAvg16kToImbe(pcm16kLe640)
        val codeword = P25ImbeNative.encodeFrame(imbeIn) ?: return null
        val packet = ByteArray(2 + codeword.size)
        packet[0] = codec.magic0
        packet[1] = codec.magic1
        System.arraycopy(codeword, 0, packet, 2, codeword.size)
        return packet
    }
}

class ImbeDecoder : VoiceDecoder {
    override val codec: VoiceCodec = VoiceCodec.IMBE
    override val isReady: Boolean get() = P25ImbeNative.isAvailable
    override val nativeSampleRate: Int = 8000

    override fun decodeFrame(framedBytes: ByteArray): ShortArray? {
        if (!P25ImbeNative.isAvailable) return null
        if (framedBytes.size != 13) return null
        if (framedBytes[0] != codec.magic0 || framedBytes[1] != codec.magic1) return null
        val codeword = framedBytes.copyOfRange(2, 13)
        return P25ImbeNative.decodeCodeword11(codeword)
    }
}
