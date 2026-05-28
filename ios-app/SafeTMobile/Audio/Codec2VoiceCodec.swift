import Foundation

/// Codec2 3200 bps encoder + decoder — placeholder.
///
/// Reports `isReady` = false until the libcodec2 build lands. The registry
/// falls back to IMBE on TX while Codec2 is unavailable, and inbound Codec2
/// frames drop with a log instead of being played as garbage at the speaker.
///
/// Why this is still a stub: libcodec2 is a C library (~50 source files)
/// from Rowetel; vendoring its source into the repo is best done as its own
/// commit with the build wiring (Package.swift / Xcode target, bridging
/// header) so the diff stays reviewable.
///
/// Vendoring + build plan:
///
///   1. Add libcodec2 sources at `ios-app/Vendor/codec2/src/` from
///      https://github.com/drowe67/codec2 (BSD-3-Clause; vendor `src/`,
///      `unittest/codec2.h` headers, and the minimum generated codebook
///      files).
///
///   2. Extend the project source globs in `project.yml` to include the
///      C files, with `-fno-strict-aliasing` if any of them warn under
///      Xcode 16:
///        - path: Vendor/codec2/src
///          includes: ["**/*.c"]
///          compilerFlags: "-DHAVE_CONFIG_H"
///
///   3. Expose the C API in `SafeTMobile-Bridging-Header.h`:
///        #include "Vendor/codec2/src/codec2.h"
///
///   4. Replace the bodies of `Codec2Encoder` / `Codec2Decoder` below with
///      calls into the bridged C API (`codec2_create(CODEC2_MODE_3200)`,
///      `codec2_encode(...)`, `codec2_decode(...)`).
///
/// Notes for whoever lands this:
///  - 3200 bps mode emits 64 bits per 40 ms frame. Keep one Codec2 payload
///    per WebSocket message to mirror IMBE's cadence; the relay forwards by
///    magic so any payload length following 0xC2 0x01 is valid.
///  - downsample 16 kHz capture → 8 kHz via the same average-pair path
///    `P25ImbeNative.Frames.downsampleAvg16kToImbe` uses.
///  - upsample 8 kHz decode → 16 kHz via the same duplicate path, or run
///    through the agency post-decode chain if shaping is set.

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
