package com.securityradio.ptt.device

/**
 * Opus encoder + decoder — placeholder.
 *
 * The wire framing and registry slot are in place so the admin can already
 * flip a channel to `opus`; this implementation reports [isReady] = false
 * until a real Opus codec ships. Until then the registry falls back to
 * IMBE for TX and the transport drops inbound Opus frames.
 *
 * Next step: pick the integration approach and bind it here:
 *
 *  - Concentus (pure Java Opus port, single jar dep, no NDK) — quickest
 *    path to a working RX + TX without touching the native build. Decode
 *    cost ~1 ms per 20 ms frame on a typical handset; safe for PTT.
 *  - libopus via NDK — lowest CPU, matches the dvmvocoder/Codec2 build
 *    pattern, but a heavier setup.
 *
 * Settings for the platform's voice profile when this is wired up:
 *  - sample rate: 16 000 Hz (matches existing 16 kHz uplink/downlink)
 *  - channels: 1 (mono)
 *  - frame size: 20 ms (320 samples) — matches the relay's 20 ms cadence
 *  - bitrate: 16-24 kbps (range supports clear speech with FEC headroom)
 *  - application: VOIP (Opus has dedicated tuning for speech)
 *  - FEC + DTX: enabled for resilience to single-frame loss
 */

class OpusEncoder : VoiceEncoder {
    override val codec: VoiceCodec = VoiceCodec.OPUS
    override val isReady: Boolean get() = false

    override fun encodeFrame(pcm16kLe640: ByteArray): ByteArray? = null
}

class OpusDecoder : VoiceDecoder {
    override val codec: VoiceCodec = VoiceCodec.OPUS
    override val isReady: Boolean get() = false
    override val nativeSampleRate: Int = 16000

    override fun decodeFrame(framedBytes: ByteArray): ShortArray? = null
}
