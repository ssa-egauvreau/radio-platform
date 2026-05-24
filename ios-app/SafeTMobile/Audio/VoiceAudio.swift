import AVFoundation
import Foundation

/// Single AVAudioEngine that captures the mic into 320-byte PCM16 frames
/// (20 ms at 16 kHz mono — the protocol the server's voice relay broadcasts)
/// and plays incoming PCM16 frames back through the speaker.
///
/// The engine is started once when the radio comes online and runs for the
/// lifetime of the session. Mic capture is gated by `startCapture()` /
/// `stopCapture()`, called when PTT is pressed/released.
final class VoiceAudio {
    /// 320 bytes = 160 samples × 2 bytes/sample = 20 ms at 16 kHz mono.
    static let frameBytes = 320
    static let sampleRate: Double = 16_000

    /// Called with each fully assembled 320-byte capture frame. Configure before
    /// calling `startCapture()`.
    var onCapturedFrame: ((Data) -> Void)?

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()

    /// Format used everywhere downstream of the mic tap and upstream of the
    /// player: float32 mono 16 kHz, non-interleaved (the player's native shape).
    // Reference the concrete class name rather than `Self` — Swift forbids
    // `Self` in stored property initializers (even on a `final` class), so
    // `Self.sampleRate` fails to compile under Xcode 16.
    private let processingFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: VoiceAudio.sampleRate,
        channels: 1,
        interleaved: false
    )!

    private var captureConverter: AVAudioConverter?
    private var captureBuffer = Data()
    private var capturing = false

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: processingFormat)
    }

    /// Activates the audio session and starts the engine. Must be called after
    /// `AudioSessionManager.requestRecordPermission()` returns true.
    func start() throws {
        try AudioSessionManager.configureForVoice()
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
        if !player.isPlaying {
            player.play()
        }
    }

    func stop() {
        stopCapture()
        if player.isPlaying { player.stop() }
        if engine.isRunning { engine.stop() }
        AudioSessionManager.deactivate()
    }

    // MARK: - capture (mic → callback)

    func startCapture() {
        guard !capturing else { return }
        capturing = true
        captureBuffer.removeAll(keepingCapacity: true)

        let inputNode = engine.inputNode
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        let pcm16Mono16k = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Self.sampleRate,
            channels: 1,
            interleaved: true
        )!
        captureConverter = AVAudioConverter(from: nativeFormat, to: pcm16Mono16k)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: nativeFormat) { [weak self] buffer, _ in
            self?.handle(captureBuffer: buffer, target: pcm16Mono16k)
        }
    }

    func stopCapture() {
        guard capturing else { return }
        capturing = false
        engine.inputNode.removeTap(onBus: 0)
        captureBuffer.removeAll(keepingCapacity: false)
        captureConverter = nil
    }

    private func handle(captureBuffer source: AVAudioPCMBuffer, target: AVAudioFormat) {
        guard let converter = captureConverter else { return }
        // Convert at the input/output sample-rate ratio plus a small headroom.
        let ratio = target.sampleRate / source.format.sampleRate
        let frameCapacity = AVAudioFrameCount(Double(source.frameLength) * ratio) + 1024
        guard let converted = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: frameCapacity) else { return }

        var supplied = false
        var error: NSError?
        let status = converter.convert(to: converted, error: &error) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return source
        }
        guard status != .error, let int16 = converted.int16ChannelData, converted.frameLength > 0 else { return }

        let frameCount = Int(converted.frameLength)
        let byteCount = frameCount * MemoryLayout<Int16>.size
        int16[0].withMemoryRebound(to: UInt8.self, capacity: byteCount) { bytes in
            captureBuffer.append(bytes, count: byteCount)
        }
        flushFramesIfReady()
    }

    private func flushFramesIfReady() {
        while captureBuffer.count >= Self.frameBytes {
            let frame = captureBuffer.prefix(Self.frameBytes)
            captureBuffer.removeFirst(Self.frameBytes)
            onCapturedFrame?(Data(frame))
        }
    }

    // MARK: - playback (incoming PCM → speaker)

    /// Schedules a PCM16 (mono, 16 kHz, little-endian) buffer for playback.
    func enqueueIncoming(_ pcm16: Data) {
        guard !pcm16.isEmpty, pcm16.count % 2 == 0 else { return }
        let frames = AVAudioFrameCount(pcm16.count / 2)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: processingFormat, frameCapacity: frames) else { return }
        buffer.frameLength = frames

        // Convert Int16 → Float32 in [-1, 1].
        guard let floatChannel = buffer.floatChannelData?[0] else { return }
        pcm16.withUnsafeBytes { raw in
            let int16Ptr = raw.bindMemory(to: Int16.self)
            for i in 0..<Int(frames) {
                floatChannel[i] = Float(int16Ptr[i]) / 32_768.0
            }
        }

        player.scheduleBuffer(buffer, completionHandler: nil)
    }
}
