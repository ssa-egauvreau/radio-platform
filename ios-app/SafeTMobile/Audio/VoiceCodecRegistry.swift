import Foundation

/// Per-process registry of voice codec encoders + decoders.
///
/// The handset always advertises every codec whose underlying lib loaded
/// successfully (via `encodableCodecs()`) on the WebSocket join, so the
/// server knows what TX codec it can ask this client to use. On RX the
/// registry dispatches on the inbound frame's leading magic bytes so a
/// channel can mix codecs mid-session (e.g. during a codec_change roll-out)
/// without any wire-side coordination.
///
/// The TX codec is single-valued at any moment (set by the relay's `joined`
/// reply or by a `codec_change` push) — half-duplex means only one talker
/// keys at a time. RX is multi-codec by nature.
final class VoiceCodecRegistry {

    private var encoders: [VoiceCodec: VoiceEncoder] = [:]
    private var decoders: [VoiceCodec: VoiceDecoder] = [:]

    @discardableResult
    func registerEncoder(_ encoder: VoiceEncoder) -> VoiceCodecRegistry {
        encoders[encoder.codec] = encoder
        return self
    }

    @discardableResult
    func registerDecoder(_ decoder: VoiceDecoder) -> VoiceCodecRegistry {
        decoders[decoder.codec] = decoder
        return self
    }

    func encoder(for codec: VoiceCodec) -> VoiceEncoder? {
        return encoders[codec]
    }

    func decoder(forMagic b0: UInt8, _ b1: UInt8) -> VoiceDecoder? {
        guard let codec = VoiceCodec.fromMagic(b0, b1) else { return nil }
        return decoders[codec]
    }

    /// Codecs this client can currently encode. Sent as `caps` on the join
    /// control frame so the server can fall back to an IMBE default if it
    /// picked a codec the client cannot honor.
    func encodableCodecs() -> [VoiceCodec] {
        return encoders.values.filter { $0.isReady }.map { $0.codec }
    }

    /// Codecs this client can currently decode. Listen-only sockets (scan)
    /// advertise this set so the server's per-socket logging reflects what
    /// those listeners can hear, even though they never encode.
    func decodableCodecs() -> [VoiceCodec] {
        return decoders.values.filter { $0.isReady }.map { $0.codec }
    }

    /// Pick a TX encoder for the codec the channel asked for, falling back
    /// to IMBE if the requested codec's lib hasn't loaded. Returns nil if
    /// even IMBE isn't available (the existing clear-PCM uplink path then
    /// applies).
    func txEncoder(for requested: VoiceCodec) -> VoiceEncoder? {
        if let first = encoders[requested], first.isReady { return first }
        if let fallback = encoders[.imbe], fallback.isReady { return fallback }
        return nil
    }
}
