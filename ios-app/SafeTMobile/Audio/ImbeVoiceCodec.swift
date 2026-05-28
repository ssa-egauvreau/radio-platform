import Foundation

/// IMBE encoder + decoder, wrapping `P25ImbeNative` in the `VoiceEncoder` /
/// `VoiceDecoder` protocols so it slots into `VoiceCodecRegistry` alongside
/// Codec2 and Opus. Wire format is unchanged: 2-byte magic (0xF5 0xAB) +
/// 11-byte 88-bit IMBE codeword = 13 bytes total per 20 ms frame.

final class ImbeEncoder: VoiceEncoder {
    let codec: VoiceCodec = .imbe
    var isReady: Bool { P25ImbeNative.isAvailable }

    func encodeFrame(_ pcm16kLe640: Data) -> Data? {
        guard isReady else { return nil }
        guard pcm16kLe640.count >= P25ImbeNative.Frames.pcm16kFrameBytes else { return nil }
        guard let imbeIn = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: pcm16kLe640),
              let codeword = P25ImbeNative.encodeFrame(samples8k160: imbeIn) else { return nil }
        var packet = Data(capacity: 2 + codeword.count)
        packet.append(codec.magic0)
        packet.append(codec.magic1)
        packet.append(codeword)
        return packet
    }
}

final class ImbeDecoder: VoiceDecoder {
    let codec: VoiceCodec = .imbe
    var isReady: Bool { P25ImbeNative.isAvailable }
    let nativeSampleRate: Int = 8000

    func decodeFrame(_ framedBytes: Data) -> [Int16]? {
        guard isReady else { return nil }
        guard framedBytes.count == 13 else { return nil }
        let firstByte = framedBytes[framedBytes.startIndex]
        let secondByte = framedBytes[framedBytes.startIndex + 1]
        guard firstByte == codec.magic0, secondByte == codec.magic1 else { return nil }
        let codeword = framedBytes.subdata(in: framedBytes.startIndex + 2..<framedBytes.startIndex + 13)
        return P25ImbeNative.decodeCodeword11(codeword)
    }
}
