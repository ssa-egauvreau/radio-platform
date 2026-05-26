import XCTest
@testable import SafeTMobile

/// Regression coverage for `ImbeTxConditioner.reset()`.
///
/// The conditioner carries a lot of running state between frames — biquad
/// memory (z1/z2), envelope follower, noise floor, gate gain, and AGC gain /
/// target. If `reset()` is missed at the end of a transmission, that state
/// leaks into the very first frame of the *next* transmission and produces an
/// audible "tail" — the bug fixed by the PR that added an unconditional
/// `voiceTransport.resetUplinkState()` call on the PTT-release / busy path of
/// `RadioViewModel`.
///
/// These tests lock in the invariant that `reset()` truly restores the
/// conditioner to its construction-time identity, so the safety net the PR
/// introduced actually clears the offending state.
final class ImbeTxConditionerTests: XCTestCase {
    private static let frameSampleCount = 320  // 20 ms @ 16 kHz
    private static let frameByteCount = frameSampleCount * 2

    /// 20 ms PCM16LE frame of a pure tone — loud enough to drive the noise
    /// gate open and the AGC away from unity gain.
    private static func makeToneFrame(frequencyHz: Double = 1_000.0, amplitude: Int16 = 16_000) -> Data {
        var data = Data(count: frameByteCount)
        let sampleRate = 16_000.0
        data.withUnsafeMutableBytes { raw in
            guard let base = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
            for i in 0..<frameSampleCount {
                let t = Double(i) / sampleRate
                let v = Double(amplitude) * sin(2 * .pi * frequencyHz * t)
                let s = Int16(clamping: Int(v.rounded()))
                let le = UInt16(bitPattern: s)
                base[i * 2] = UInt8(le & 0xff)
                base[i * 2 + 1] = UInt8((le >> 8) & 0xff)
            }
        }
        return data
    }

    /// After `reset()` the conditioner must produce byte-for-byte identical
    /// output to a freshly constructed instance for the same input frame.
    func test_reset_restoresIdenticalProcessingForIdenticalInput() {
        let conditioner = ImbeTxConditioner()
        let original = Self.makeToneFrame()

        var firstPass = original
        conditioner.conditionLe16(frame: &firstPass)

        var secondPass = original
        conditioner.conditionLe16(frame: &secondPass)
        XCTAssertNotEqual(
            firstPass, secondPass,
            "Sanity check: the conditioner must accumulate AGC/biquad state across frames — otherwise this test cannot detect a missing reset()."
        )

        conditioner.reset()
        var afterReset = original
        conditioner.conditionLe16(frame: &afterReset)

        XCTAssertEqual(
            afterReset, firstPass,
            "reset() must restore state so the same input yields the same output as the very first call."
        )
    }

    /// A loud frame followed by silence must produce non-zero biquad/AGC
    /// ringdown unless `reset()` clears the state first. This is the exact
    /// shape of the stale-tail bug: a fractional accumulator survives the
    /// key-up and bleeds into the next transmission.
    func test_reset_clearsBiquadAndAgcMemoryAcrossLoudThenSilent() {
        let conditioner = ImbeTxConditioner()
        let loud = Self.makeToneFrame(amplitude: 20_000)
        let silent = Data(count: Self.frameByteCount)

        // Pristine silent baseline from a fresh conditioner — with x = 0 and
        // z1 = z2 = 0 the biquads emit 0, the gate stays closed, and every
        // output sample is exactly 0.
        var pristineSilent = silent
        ImbeTxConditioner().conditionLe16(frame: &pristineSilent)
        XCTAssertTrue(pristineSilent.allSatisfy { $0 == 0 })

        var loudCopy = loud
        conditioner.conditionLe16(frame: &loudCopy)

        var dirtySilent = silent
        conditioner.conditionLe16(frame: &dirtySilent)
        XCTAssertNotEqual(
            dirtySilent, pristineSilent,
            "Without reset(), biquad/AGC memory from the loud frame must leak into the next frame as ringdown."
        )

        conditioner.reset()
        var cleanSilent = silent
        conditioner.conditionLe16(frame: &cleanSilent)
        XCTAssertEqual(
            cleanSilent, pristineSilent,
            "reset() must clear biquad and AGC state so a silent frame processes as if no prior audio existed."
        )
    }

    /// `reset()` is wired onto the busy/release path *unconditionally*, so it
    /// must be safe to invoke on a never-used conditioner and to call back to
    /// back without changing observable behavior.
    func test_reset_isIdempotentOnFreshInstance() {
        let conditioner = ImbeTxConditioner()
        conditioner.reset()
        conditioner.reset()
        var frame = Self.makeToneFrame()
        conditioner.conditionLe16(frame: &frame)
        XCTAssertEqual(frame.count, Self.frameByteCount)
    }

    /// Empty or sub-sample frames must be a no-op rather than crash — the
    /// callsite in `VoiceTransport.sendCapturedOnMain` slices PCM and could in
    /// theory hand the conditioner a residual.
    func test_conditionLe16_withShortFrame_isNoOp() {
        let conditioner = ImbeTxConditioner()

        var empty = Data()
        conditioner.conditionLe16(frame: &empty)
        XCTAssertEqual(empty, Data())

        var oneByte = Data([0x00])
        conditioner.conditionLe16(frame: &oneByte)
        XCTAssertEqual(oneByte, Data([0x00]))
    }
}
