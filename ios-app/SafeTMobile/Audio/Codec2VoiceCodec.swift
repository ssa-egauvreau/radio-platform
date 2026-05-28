import Foundation

/// Codec2 3200 bps encoder + decoder — placeholder.
///
/// The wire framing and registry slot are in place so the admin can already
/// flip a channel to `codec2_3200`; this implementation reports `isReady` =
/// false until a real libcodec2 build lands. Until then the registry falls
/// back to IMBE on TX and inbound Codec2 frames drop without playing
/// garbage.
///
/// Next step: vendor libcodec2 (BSD-licensed C source) as a Swift Package
/// Manager target or CocoaPods spec, expose `encode` / `decode` through a
/// thin C-bridging header, and replace the bodies below.

final class Codec2Encoder: VoiceEncoder {
    let codec: VoiceCodec = .codec2_3200
    var isReady: Bool { false }

    func encodeFrame(_ pcm16kLe640: Data) -> Data? { nil }
}

final class Codec2Decoder: VoiceDecoder {
    let codec: VoiceCodec = .codec2_3200
    var isReady: Bool { false }
    let nativeSampleRate: Int = 8000

    func decodeFrame(_ framedBytes: Data) -> [Int16]? { nil }
}
