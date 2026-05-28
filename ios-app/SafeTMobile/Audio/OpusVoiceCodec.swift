import Foundation

/// Opus encoder + decoder — placeholder.
///
/// The wire framing and registry slot are in place so the admin can already
/// flip a channel to `opus`; this implementation reports `isReady` = false
/// until a real Opus codec ships. Until then the registry falls back to IMBE
/// for TX and the transport drops inbound Opus frames.
///
/// Next step: pick the integration approach and bind it here:
///
///  - AudioToolbox `AudioConverterRef` with `kAudioFormatOpus` (iOS 16+) —
///    zero new dependencies, but iOS-only and requires a deployment-target
///    bump.
///  - libopus via Swift Package Manager (e.g. swift-opus) — works on
///    older iOS, larger surface to vendor and ABI-pin.
///
/// Settings for the platform's voice profile when this is wired up:
///  - sample rate: 16 000 Hz (matches existing 16 kHz uplink/downlink)
///  - channels: 1 (mono)
///  - frame size: 20 ms (320 samples) — matches the relay's 20 ms cadence
///  - bitrate: 16-24 kbps
///  - application: VOIP
///  - FEC + DTX: enabled for resilience to single-frame loss

final class OpusEncoder: VoiceEncoder {
    let codec: VoiceCodec = .opus
    var isReady: Bool { false }

    func encodeFrame(_ pcm16kLe640: Data) -> Data? { nil }
}

final class OpusDecoder: VoiceDecoder {
    let codec: VoiceCodec = .opus
    var isReady: Bool { false }
    let nativeSampleRate: Int = 16000

    func decodeFrame(_ framedBytes: Data) -> [Int16]? { nil }
}
