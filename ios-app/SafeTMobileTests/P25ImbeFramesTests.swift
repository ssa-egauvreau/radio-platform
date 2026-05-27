import XCTest
@testable import SafeTMobile

/// Coverage for the IMBE TX pipeline data transforms added with the
/// cross-platform P25 vocoder. These helpers run on every captured frame
/// during PTT, and a regression in their length / averaging contract would
/// either corrupt uplink audio or, worse, leak the trailing half-frame from
/// the previous transmission once the buffer is reset on busy/abort.
final class P25ImbeFramesTests: XCTestCase {
    // MARK: - downsampleAvg16kToImbe

    func test_downsample_returnsNil_whenFrameSmallerThanOneImbeFrame() {
        XCTAssertNil(P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: Data()))
        XCTAssertNil(P25ImbeNative.Frames.downsampleAvg16kToImbe(
            frame16k: Data(count: P25ImbeNative.Frames.pcm16kFrameBytes - 1)))
    }

    func test_downsample_returns160Samples_for640ByteFrame() {
        let frame = pcm16k(samples: Array(repeating: Int16(0), count: 320))
        let out = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: frame)
        XCTAssertEqual(out?.count, 160)
    }

    func test_downsample_averagesAdjacentSamplePairs() {
        let input: [Int16] = (0..<320).map { Int16($0 - 160) }
        let frame = pcm16k(samples: input)
        let out = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: frame)
        XCTAssertNotNil(out)
        for i in 0..<160 {
            let expected = Int16(clamping: (Int32(input[2 * i]) + Int32(input[2 * i + 1])) / 2)
            XCTAssertEqual(out?[i], expected, "downsample mismatch at index \(i)")
        }
    }

    func test_downsample_doesNotOverflow_atInt16Extremes() {
        let input: [Int16] = Array(repeating: 32_767, count: 320)
        let out = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: pcm16k(samples: input))
        XCTAssertEqual(out, Array(repeating: Int16(32_767), count: 160))

        let lows: [Int16] = Array(repeating: -32_768, count: 320)
        let outLow = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: pcm16k(samples: lows))
        XCTAssertEqual(outLow, Array(repeating: Int16(-32_768), count: 160))
    }

    func test_downsample_decodesLittleEndianBytes() {
        let raw: [UInt8] = [
            0x01, 0x00, // sample 0 = 1
            0xFF, 0x00, // sample 1 = 255
            0x00, 0x01, // sample 2 = 256
            0x00, 0x01, // sample 3 = 256
        ]
        var frame = Data(raw)
        frame.append(Data(count: P25ImbeNative.Frames.pcm16kFrameBytes - raw.count))
        let out = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: frame)
        XCTAssertEqual(out?[0], 128)
        XCTAssertEqual(out?[1], 256)
    }

    // MARK: - upsampleDup8kToLe16Mono

    func test_upsample_produces640Bytes_for160SampleInput() {
        let out = P25ImbeNative.Frames.upsampleDup8kToLe16Mono(pcm8k160: Array(repeating: 0, count: 160))
        XCTAssertEqual(out.count, 640)
    }

    func test_upsample_duplicatesEachSample_inLittleEndian() {
        let pcm: [Int16] = [0, 1, -1, 256, -256, 32_767, -32_768]
        var padded = pcm
        padded.append(contentsOf: Array(repeating: Int16(0), count: 160 - pcm.count))

        let bytes = Array(P25ImbeNative.Frames.upsampleDup8kToLe16Mono(pcm8k160: padded))

        for (index, sample) in pcm.enumerated() {
            let base = index * 4
            let first = Int16(bitPattern: UInt16(bytes[base]) | (UInt16(bytes[base + 1]) << 8))
            let second = Int16(bitPattern: UInt16(bytes[base + 2]) | (UInt16(bytes[base + 3]) << 8))
            XCTAssertEqual(first, sample, "first copy at index \(index)")
            XCTAssertEqual(second, sample, "duplicate copy at index \(index)")
        }
    }

    // MARK: - helpers

    private func pcm16k(samples: [Int16]) -> Data {
        var data = Data(count: samples.count * 2)
        data.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            for (i, sample) in samples.enumerated() {
                let le = UInt16(bitPattern: sample)
                base[i * 2] = UInt8(le & 0xff)
                base[i * 2 + 1] = UInt8((le >> 8) & 0xff)
            }
        }
        return data
    }
}
