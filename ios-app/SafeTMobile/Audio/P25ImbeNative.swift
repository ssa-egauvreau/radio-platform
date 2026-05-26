import Foundation

/// Swift wrapper around the bundled dvmvocoder (GPL-2.0; see android-app cpp/dvmvocoder).
enum P25ImbeNative {
    private static let lock = NSLock()
    private static var ready = false

    static var isAvailable: Bool {
        lock.lock()
        defer { lock.unlock() }
        return ready
    }

    @discardableResult
    static func initialize() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if ready { return true }
        ready = p25_imbe_init()
        return ready
    }

    static func encodeFrame(samples8k160: [Int16]) -> Data? {
        guard samples8k160.count == 160 else { return nil }
        lock.lock()
        defer { lock.unlock() }
        if !ready { return nil }
        var codeword = [UInt8](repeating: 0, count: 11)
        let ok = samples8k160.withUnsafeBufferPointer { samplesPtr in
            codeword.withUnsafeMutableBufferPointer { outPtr in
                guard let s = samplesPtr.baseAddress, let o = outPtr.baseAddress else { return false }
                return p25_imbe_encode(s, o)
            }
        }
        return ok ? Data(codeword) : nil
    }

    static func decodeCodeword11(_ codeword: Data) -> [Int16]? {
        guard codeword.count == 11 else { return nil }
        lock.lock()
        defer { lock.unlock() }
        if !ready { return nil }
        var samples = [Int16](repeating: 0, count: 160)
        let ok = codeword.withUnsafeBytes { raw in
            samples.withUnsafeMutableBufferPointer { outPtr in
                guard let c = raw.baseAddress?.assumingMemoryBound(to: UInt8.self),
                      let o = outPtr.baseAddress else { return false }
                return p25_imbe_decode(c, o)
            }
        }
        return ok ? samples : nil
    }

    enum Frames {
        static let pcm16kFrameBytes = 640

        static func downsampleAvg16kToImbe(frame16k: Data) -> [Int16]? {
            guard frame16k.count >= pcm16kFrameBytes else { return nil }
            var out = [Int16](repeating: 0, count: 160)
            frame16k.withUnsafeBytes { raw in
                guard let bytes = raw.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
                for i in 0..<160 {
                    let off = i * 4
                    let s0 = readLe16(bytes, off)
                    let s1 = readLe16(bytes, off + 2)
                    out[i] = Int16(clamping: (Int32(s0) + Int32(s1)) / 2)
                }
            }
            return out
        }

        private static func readLe16(_ bytes: UnsafePointer<UInt8>, _ offset: Int) -> Int16 {
            let lo = UInt16(bytes[offset])
            let hi = UInt16(bytes[offset + 1])
            return Int16(bitPattern: lo | (hi << 8))
        }

        static func upsampleDup8kToLe16Mono(pcm8k160: [Int16]) -> Data {
            var out = Data(count: 320 * 2)
            out.withUnsafeMutableBytes { raw in
                guard let base = raw.baseAddress else { return }
                let bytes = base.assumingMemoryBound(to: UInt8.self)
                var idx = 0
                for sample in pcm8k160 {
                    let le = UInt16(bitPattern: sample)
                    let b0 = UInt8(le & 0xff)
                    let b1 = UInt8((le >> 8) & 0xff)
                    for _ in 0..<2 {
                        bytes[idx] = b0
                        bytes[idx + 1] = b1
                        idx += 2
                    }
                }
            }
            return out
        }
    }
}
