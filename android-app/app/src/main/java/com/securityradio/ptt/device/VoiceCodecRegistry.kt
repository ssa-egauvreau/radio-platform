package com.securityradio.ptt.device

/**
 * Per-process registry of voice codec encoders + decoders.
 *
 * The handset always advertises every codec whose underlying lib loaded
 * successfully (via [encodableCodecs]) on the WebSocket join, so the server
 * knows what TX codec it can ask this client to use. On RX the registry
 * dispatches on the inbound frame's leading magic bytes so a channel can
 * mix codecs mid-session (e.g. during a [codec_change] roll-out) without
 * any wire-side coordination.
 *
 * The TX codec is single-valued at any moment (set by the relay's `joined`
 * reply or by a `codec_change` push) — half-duplex means only one talker
 * keys at a time. RX is multi-codec by nature.
 */
class VoiceCodecRegistry {

    private val encoders = mutableMapOf<VoiceCodec, VoiceEncoder>()
    private val decoders = mutableMapOf<VoiceCodec, VoiceDecoder>()

    fun registerEncoder(encoder: VoiceEncoder): VoiceCodecRegistry {
        encoders[encoder.codec] = encoder
        return this
    }

    fun registerDecoder(decoder: VoiceDecoder): VoiceCodecRegistry {
        decoders[decoder.codec] = decoder
        return this
    }

    fun encoderFor(codec: VoiceCodec): VoiceEncoder? = encoders[codec]

    fun decoderForMagic(b0: Byte, b1: Byte): VoiceDecoder? {
        val codec = VoiceCodec.fromMagic(b0, b1) ?: return null
        return decoders[codec]
    }

    /**
     * Codecs this client can currently encode. Sent as `caps` on the join
     * control frame so the server can fall back to an IMBE default if it
     * picked a codec the client cannot honor.
     *
     * A codec whose lib loaded after this is called still works for RX
     * (decoders re-check [VoiceDecoder.isReady] on every frame), but the
     * server won't be told about it until the next join.
     */
    fun encodableCodecs(): List<VoiceCodec> =
        encoders.values.filter { it.isReady }.map { it.codec }

    /**
     * Codecs this client can currently decode. Listen-only sockets (scan)
     * advertise this set so the server's per-socket logging reflects what
     * those listeners can hear, even though they never encode.
     */
    fun decodableCodecs(): List<VoiceCodec> =
        decoders.values.filter { it.isReady }.map { it.codec }

    /**
     * Pick a TX encoder for the codec the channel asked for, falling back
     * to IMBE if the requested codec's lib hasn't loaded. The fallback
     * never returns a not-ready encoder; it returns null if even IMBE
     * isn't available (the existing clear-PCM uplink path then applies).
     */
    fun txEncoderFor(requested: VoiceCodec): VoiceEncoder? {
        val first = encoders[requested]
        if (first != null && first.isReady) return first
        val fallback = encoders[VoiceCodec.IMBE]
        return if (fallback != null && fallback.isReady) fallback else null
    }
}
