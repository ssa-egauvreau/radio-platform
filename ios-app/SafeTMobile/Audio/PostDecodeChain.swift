import Foundation

/// Live RX post-decode chain — what the handset applies to every IMBE-decoded
/// frame before handing the PCM bytes to `VoiceAudio.enqueueIncoming`. Mirrors
/// the Audio Lab's `processClip` shaping
/// (`server/web-console/src/pages/admin/audioLab/pipeline.ts`), the web voice
/// client's `postDecodeChain.ts`, and the Android `PostDecodeChain.kt`, so one
/// tuned admin preset sounds the same across all three clients.
///
/// Note: the iOS playback path is fixed at `VoiceAudio.sampleRate` = 16 000 Hz.
/// The Audio Lab's `polyphase24` upsample mode (24 kHz output) is treated
/// identically to `polyphase` (16 kHz output) here so the biquads still run
/// at the player's native rate. The audible difference is small — the
/// 24 → 48 vs 16 → 48 device resample on the listener's hardware. Matches
/// the Android handling, intentionally.
enum PostDecodeChain {

    enum UpsampleMode: String {
        case duplicate
        case linear
        case polyphase
        case polyphase24

        init(_ raw: String?) {
            switch raw?.lowercased() ?? "" {
            case "linear":      self = .linear
            case "polyphase":   self = .polyphase
            case "polyphase24": self = .polyphase24
            default:            self = .duplicate
            }
        }
    }

    /// Subset of `AudioLabConfig.postDecode` the live RX path consumes.
    /// Optional fields fall back to safe "feature off" defaults so an older
    /// server (no post-decode wired) produces a no-op processor.
    struct Config {
        let upsampleMode: UpsampleMode
        let hpfEnabled: Bool
        let hpfHz: Double
        let lpfEnabled: Bool
        let lpfHz: Double
        let lowShelfEnabled: Bool
        let lowShelfHz: Double
        let lowShelfDb: Double
        let highShelfEnabled: Bool
        let highShelfHz: Double
        let highShelfDb: Double
        let presenceEnabled: Bool
        let presenceHz: Double
        let presenceDb: Double
        let presenceQ: Double
        let saturationAmount: Double

        /// Mirrors the server's `derivePostDecodeBlock` short-circuit — when
        /// nothing is engaged and the upsample is the legacy default, caller
        /// should skip building a processor entirely.
        var isNoOp: Bool {
            return upsampleMode == .duplicate
                && !hpfEnabled
                && !lpfEnabled
                && !lowShelfEnabled
                && !highShelfEnabled
                && !presenceEnabled
                && saturationAmount <= 0
        }
    }

    /// Per-channel processor. Biquad state persists across the 20 ms IMBE
    /// frames within a single talk-spurt so filters don't "open" each hop.
    /// Call `reset()` at talk-spurt boundaries so a previous talker's filter
    /// ring can't bleed into the next talker's first frame.
    final class Processor {
        private let upsampleMode: UpsampleMode
        private let saturationAmount: Double
        private var stages: [Biquad] = []
        /// One-sample carryover so linear upsample stays seamless across
        /// frame boundaries within a talk-spurt.
        private var linearPrev: Double = 0

        init(config cfg: Config) {
            self.upsampleMode = cfg.upsampleMode
            self.saturationAmount = max(0, min(1, cfg.saturationAmount))
            let fs = 16_000.0
            // Stages run at the output rate (16 kHz), AFTER upsampling — same
            // ordering as the Audio Lab preview so coefficients match.
            if cfg.hpfEnabled {
                stages.append(.highpass(fc: cfg.hpfHz, q: 0.707, fs: fs))
            }
            if cfg.lpfEnabled {
                stages.append(.lowpass(fc: cfg.lpfHz, q: 0.707, fs: fs))
            }
            if cfg.lowShelfEnabled {
                stages.append(.lowShelf(fc: cfg.lowShelfHz, gainDb: cfg.lowShelfDb, fs: fs))
            }
            if cfg.highShelfEnabled {
                stages.append(.highShelf(fc: cfg.highShelfHz, gainDb: cfg.highShelfDb, fs: fs))
            }
            if cfg.presenceEnabled {
                stages.append(.peak(fc: cfg.presenceHz, gainDb: cfg.presenceDb,
                                    q: max(0.1, cfg.presenceQ), fs: fs))
            }
        }

        func reset() {
            for i in 0..<stages.count { stages[i].reset() }
            linearPrev = 0
        }

        /// 160 8-kHz `Int16` samples in → 320 16-kHz LE PCM bytes out.
        /// Wire-compatible with `P25ImbeNative.Frames.upsampleDup8kToLe16Mono`
        /// so the downstream `VoiceAudio.enqueueIncoming` is happy.
        func process(pcm8k160: [Int16]) -> Data {
            var pcm16k = upsampleTo16k(pcm8k160)
            for i in 0..<stages.count {
                stages[i].processInPlace(&pcm16k)
            }
            if saturationAmount > 0 {
                Self.applySoftSaturation(&pcm16k, amount: saturationAmount)
            }
            // Encode to little-endian PCM-16 bytes for the AudioTrack.
            var out = Data(count: pcm16k.count * 2)
            out.withUnsafeMutableBytes { raw in
                let dst = raw.bindMemory(to: Int16.self)
                for i in 0..<pcm16k.count {
                    dst[i] = pcm16k[i].littleEndian
                }
            }
            return out
        }

        private func upsampleTo16k(_ pcm8k: [Int16]) -> [Int16] {
            switch upsampleMode {
            case .duplicate:
                return Self.upsampleDup(pcm8k)
            case .linear:
                let (out, newPrev) = Self.upsampleLinear(pcm8k, prev: linearPrev)
                linearPrev = newPrev
                return out
            case .polyphase, .polyphase24:
                // POLYPHASE24 in the lab is a 24 kHz output; the iOS player
                // is hard-locked to 16 kHz so we use the 16 kHz polyphase
                // path. See the file-level note.
                return Self.upsamplePolyphase(pcm8k)
            }
        }

        // --- upsamplers (static — they hold no per-instance state) -------

        private static func upsampleDup(_ pcm8k: [Int16]) -> [Int16] {
            var out = [Int16](repeating: 0, count: pcm8k.count * 2)
            for i in 0..<pcm8k.count {
                out[i * 2] = pcm8k[i]
                out[i * 2 + 1] = pcm8k[i]
            }
            return out
        }

        private static func upsampleLinear(_ pcm8k: [Int16], prev: Double) -> ([Int16], Double) {
            var out = [Int16](repeating: 0, count: pcm8k.count * 2)
            var p = prev
            for i in 0..<pcm8k.count {
                let curr = Double(pcm8k[i])
                out[i * 2] = Int16(PostDecodeChain.clamp16((p + curr) / 2.0))
                out[i * 2 + 1] = pcm8k[i]
                p = curr
            }
            return (out, p)
        }

        /// 33-tap Hann-windowed sinc, fc = Fs/4. Same kernel shape as the
        /// web and Android polyphase upsamplers so the response matches.
        private static let polyphase16Kernel: [Float] = buildPolyphase16Kernel()

        private static func buildPolyphase16Kernel() -> [Float] {
            let n = 33
            let half = (n - 1) / 2
            let fc = 0.25
            var k = [Float](repeating: 0, count: n)
            var norm: Float = 0
            for i in 0..<n {
                let x = Double(i - half)
                let h: Double
                if x == 0 {
                    h = 2 * fc
                } else {
                    h = sin(2 * .pi * fc * x) / (.pi * x)
                }
                let w = 0.5 * (1 - cos(2 * .pi * Double(i) / Double(n - 1)))
                k[i] = Float(h * w)
                norm += k[i]
            }
            if norm != 0 {
                for i in 0..<n { k[i] = k[i] / norm }
            }
            return k
        }

        private static func upsamplePolyphase(_ pcm8k: [Int16]) -> [Int16] {
            let kernel = polyphase16Kernel
            let half = (kernel.count - 1) / 2
            var out = [Int16](repeating: 0, count: pcm8k.count * 2)
            for n in 0..<out.count {
                let phase = n & 1
                let centreIn = n >> 1
                if phase == 0 {
                    out[n] = (centreIn >= 0 && centreIn < pcm8k.count) ? pcm8k[centreIn] : 0
                } else {
                    var acc: Double = 0
                    for k in -half...half {
                        let inIdx = centreIn + k
                        let sample = (inIdx >= 0 && inIdx < pcm8k.count)
                            ? Double(pcm8k[inIdx]) : 0
                        acc += sample * Double(kernel[k + half])
                    }
                    out[n] = Int16(PostDecodeChain.clamp16(acc))
                }
            }
            return out
        }

        private static func applySoftSaturation(_ pcm: inout [Int16], amount: Double) {
            let clamped = max(0, min(1, amount))
            if clamped == 0 { return }
            let drive = 1 + clamped * 2
            let norm = 1 / tanh(drive)
            for i in 0..<pcm.count {
                let x = Double(pcm[i]) / 32768.0
                let y = tanh(x * drive) * norm * 32768.0
                pcm[i] = Int16(PostDecodeChain.clamp16(y))
            }
        }
    }

    // ----- helpers -------------------------------------------------------

    /// Round + clamp a `Double` into the `Int16` range.
    fileprivate static func clamp16(_ x: Double) -> Int {
        if x > 32767 { return 32767 }
        if x < -32768 { return -32768 }
        return Int(x.rounded())
    }

    /// RBJ-cookbook biquad — direct-form-II transposed. Same math as the
    /// TS / Kotlin Biquad implementations so coefficients give the same
    /// audible response across all three platforms.
    struct Biquad {
        private let b0: Double
        private let b1: Double
        private let b2: Double
        private let a1: Double
        private let a2: Double
        private var z1: Double = 0
        private var z2: Double = 0

        private init(b0: Double, b1: Double, b2: Double, a1: Double, a2: Double) {
            self.b0 = b0; self.b1 = b1; self.b2 = b2; self.a1 = a1; self.a2 = a2
        }

        mutating func reset() {
            z1 = 0
            z2 = 0
        }

        mutating func processInPlace(_ pcm: inout [Int16]) {
            for i in 0..<pcm.count {
                let x = Double(pcm[i])
                let y = b0 * x + z1
                z1 = b1 * x - a1 * y + z2
                z2 = b2 * x - a2 * y
                pcm[i] = Int16(PostDecodeChain.clamp16(y))
            }
        }

        static func highpass(fc: Double, q: Double, fs: Double) -> Biquad {
            let w0 = 2 * .pi * fc / fs
            let cw = cos(w0); let sw = sin(w0)
            let alpha = sw / (2 * q)
            let a0 = 1 + alpha
            return Biquad(
                b0: (1 + cw) / 2 / a0,
                b1: -(1 + cw) / a0,
                b2: (1 + cw) / 2 / a0,
                a1: -2 * cw / a0,
                a2: (1 - alpha) / a0
            )
        }

        static func lowpass(fc: Double, q: Double, fs: Double) -> Biquad {
            let w0 = 2 * .pi * fc / fs
            let cw = cos(w0); let sw = sin(w0)
            let alpha = sw / (2 * q)
            let a0 = 1 + alpha
            return Biquad(
                b0: (1 - cw) / 2 / a0,
                b1: (1 - cw) / a0,
                b2: (1 - cw) / 2 / a0,
                a1: -2 * cw / a0,
                a2: (1 - alpha) / a0
            )
        }

        static func lowShelf(fc: Double, gainDb: Double, fs: Double) -> Biquad {
            let A = pow(10, gainDb / 40)
            let w0 = 2 * .pi * fc / fs
            let cw = cos(w0); let sw = sin(w0)
            let beta = sqrt(A)
            let a0 = A + 1 + (A - 1) * cw + beta * sw
            return Biquad(
                b0: (A * (A + 1 - (A - 1) * cw + beta * sw)) / a0,
                b1: (2 * A * (A - 1 - (A + 1) * cw)) / a0,
                b2: (A * (A + 1 - (A - 1) * cw - beta * sw)) / a0,
                a1: (-2 * (A - 1 + (A + 1) * cw)) / a0,
                a2: (A + 1 + (A - 1) * cw - beta * sw) / a0
            )
        }

        static func highShelf(fc: Double, gainDb: Double, fs: Double) -> Biquad {
            let A = pow(10, gainDb / 40)
            let w0 = 2 * .pi * fc / fs
            let cw = cos(w0); let sw = sin(w0)
            let beta = sqrt(A)
            let a0 = A + 1 - (A - 1) * cw + beta * sw
            return Biquad(
                b0: (A * (A + 1 + (A - 1) * cw + beta * sw)) / a0,
                b1: (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
                b2: (A * (A + 1 + (A - 1) * cw - beta * sw)) / a0,
                a1: (2 * (A - 1 - (A + 1) * cw)) / a0,
                a2: (A + 1 - (A - 1) * cw - beta * sw) / a0
            )
        }

        static func peak(fc: Double, gainDb: Double, q: Double, fs: Double) -> Biquad {
            let A = pow(10, gainDb / 40)
            let w0 = 2 * .pi * fc / fs
            let cw = cos(w0); let sw = sin(w0)
            let alpha = sw / (2 * q)
            let a0 = 1 + alpha / A
            return Biquad(
                b0: (1 + alpha * A) / a0,
                b1: -2 * cw / a0,
                b2: (1 - alpha * A) / a0,
                a1: -2 * cw / a0,
                a2: (1 - alpha / A) / a0
            )
        }
    }
}
