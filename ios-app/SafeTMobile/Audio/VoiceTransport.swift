import Foundation
import os

/// Opens a WebSocket to `/v1/voice/stream`, sends the `join` frame the server
/// expects, and relays voice. Uplink uses P25 IMBE (88-bit codewords) when the
/// native vocoder loads; otherwise clear PCM. Downlink auto-detects IMBE frames.
@MainActor
final class VoiceTransport {
    enum Permission: String { case listenOnly = "listen_only", talk, talkPriority = "talk_priority" }

    struct Joined { let channel: String; let permission: Permission; let unitId: String }

    var onJoined: ((Joined) -> Void)?
    var onError: ((String) -> Void)?
    var onBusy: ((String?) -> Void)?
    var onReceivingChange: ((Bool) -> Void)?

    private let baseURL: URL
    private let token: String
    private let session: URLSession
    private let audio: VoiceAudio
    private let unitId: String
    private let logger = Logger(subsystem: "com.safetptt.mobile", category: "voice")

    private var task: URLSessionWebSocketTask?
    private var currentChannel: String?
    private var lastReceivedAt: Date = .distantPast
    private var receivingTimer: Timer?
    private var reconnectAttempts: Int = 0
    private var reconnectTask: Task<Void, Never>?

    private let txConditioner = ImbeTxConditioner()
    private var pcmAcc = Data()
    private var pcmFrameScratch = Data(count: P25ImbeNative.Frames.pcm16kFrameBytes)
    private var lastConsumeNs: UInt64 = 0
    private var warnedClearTx = false
    // Each PTT key-up/key-down pair gets a unique capture session id from
    // VoiceAudio. We only accept frames for the currently armed session so
    // late frames from a prior key-up cannot repopulate `pcmAcc`.
    // `internal` (default) visibility so `@testable import SafeTMobile` can
    // assert the gate state directly — the property is read-only outside this
    // file in practice.
    var activeCaptureSessionId: UInt64?

    private let imbeMagic: [UInt8] = [0xF5, 0xAB]
    private let listenPcmMagic: [UInt8] = [0xF6, 0xAC]

    /// Agency-pushed RX shaping (presence bell, soft saturation, shelves,
    /// upsample mode). `nil` when no admin has pushed shaping or when the
    /// `/v1/audio/config` fetch hasn't landed yet — RX takes the legacy
    /// duplicate 8 → 16 kHz upsample with no biquads. Rebuilt by
    /// `refreshAudioConfig()` on every connect / reconnect so admin
    /// changes pick up without restarting the app.
    private var postDecodeProcessor: PostDecodeChain.Processor?
    /// Last inbound voice frame timestamp (seconds, monotonic clock). Used
    /// only to detect a talk-spurt boundary on RX so the post-decode chain
    /// can reset its biquad state before the next talker's first frame.
    private var lastInboundVoiceAt: TimeInterval = 0
    /// Treat > 300 ms gap between inbound voice frames as a new talk-spurt.
    /// Matches the Android `scanTalkSpurtGapNs` for the same reason.
    private let talkSpurtGapSeconds: TimeInterval = 0.3

    init(baseURL: URL, token: String, unitId: String, audio: VoiceAudio, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.unitId = unitId
        self.audio = audio
        self.session = session
        _ = P25ImbeNative.initialize()
    }

    func join(channel: String) {
        currentChannel = channel
        reconnectTask?.cancel()
        reconnectTask = nil
        reconnectAttempts = 0
        if task == nil { openSocket() }
        sendJoinFrame()
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        receivingTimer?.invalidate()
        receivingTimer = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        currentChannel = nil
        reconnectAttempts = 0
        stopUplinkCapture()
    }

    func startUplinkCapture(sessionId: UInt64) {
        activeCaptureSessionId = sessionId
        resetUplinkState()
    }

    func stopUplinkCapture() {
        activeCaptureSessionId = nil
        resetUplinkState()
    }

    func resetUplinkState() {
        pcmAcc.removeAll(keepingCapacity: true)
        txConditioner.reset()
        lastConsumeNs = 0
    }

    /// Send one captured PCM16 frame (320 bytes @ 16 kHz). Encodes to IMBE when available.
    nonisolated func sendCaptured(_ frame: Data, captureSessionId: UInt64) {
        Task { @MainActor [weak self] in
            self?.sendCapturedOnMain(frame, captureSessionId: captureSessionId)
        }
    }

    private func sendCapturedOnMain(_ frame: Data, captureSessionId: UInt64) {
        guard let task, !frame.isEmpty else { return }
        guard activeCaptureSessionId == captureSessionId else { return }

        let p25 = P25ImbeNative.isAvailable
        if !p25 {
            if !warnedClearTx {
                warnedClearTx = true
                logger.warning("P25 IMBE encoder unavailable — uplink clear PCM")
            }
            pcmAcc.removeAll(keepingCapacity: true)
            task.send(.data(frame)) { _ in }
            return
        }

        var side = Data(capacity: 2 + frame.count)
        side.append(listenPcmMagic[0])
        side.append(listenPcmMagic[1])
        side.append(frame)
        task.send(.data(side)) { _ in }

        let now = DispatchTime.now().uptimeNanoseconds
        if lastConsumeNs > 0, now - lastConsumeNs > 300_000_000 {
            txConditioner.reset()
        }
        lastConsumeNs = now

        pcmAcc.append(frame)
        let frameBytes = P25ImbeNative.Frames.pcm16kFrameBytes
        while pcmAcc.count >= frameBytes {
            pcmFrameScratch = pcmAcc.prefix(frameBytes)
            pcmAcc.removeFirst(frameBytes)

            txConditioner.conditionLe16(frame: &pcmFrameScratch)
            guard let imbeIn = P25ImbeNative.Frames.downsampleAvg16kToImbe(frame16k: pcmFrameScratch),
                  let codeword = P25ImbeNative.encodeFrame(samples8k160: imbeIn) else { continue }
            var packet = Data(capacity: 13)
            packet.append(imbeMagic[0])
            packet.append(imbeMagic[1])
            packet.append(codeword)
            task.send(.data(packet)) { _ in }
        }
    }

    // MARK: - private

    private func openSocket() {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/voice/stream"), resolvingAgainstBaseURL: false)
        let currentScheme = components?.scheme
        components?.scheme = (currentScheme == "http") ? "ws" : "wss"
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components?.url else { return }

        let request = URLRequest(url: url)
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        listen()
        startReceivingHeartbeat()
        // Fetch agency audio config in parallel. RX falls back to the legacy
        // duplicate-upsample path until this lands; once the processor is
        // built, the next inbound IMBE frame picks it up automatically.
        Task { [weak self] in await self?.refreshAudioConfig() }
    }

    /// Fetches the agency-pushed audio config and rebuilds
    /// `postDecodeProcessor` from its `postDecode` block. Best-effort: a
    /// failed request leaves whatever was previously cached intact (or nil
    /// on first connect), so a transient server hiccup just keeps RX on the
    /// legacy fast path instead of crashing the listener.
    private func refreshAudioConfig() async {
        let apiBase = baseURL
        let client = RadioApiClient(baseURL: apiBase, token: token)
        do {
            let response = try await client.audioConfig()
            let next: PostDecodeChain.Processor?
            if let pd = response.config?.postDecode {
                let cfg = pd.toConfig()
                next = cfg.isNoOp ? nil : PostDecodeChain.Processor(config: cfg)
            } else {
                next = nil
            }
            await MainActor.run {
                self.postDecodeProcessor = next
                // Reset the talk-spurt timestamp so the next inbound frame
                // is treated as a new spurt boundary — the new processor's
                // biquad state starts from rest, but we also want to log
                // that boundary cleanly in case logging is added later.
                self.lastInboundVoiceAt = 0
            }
        } catch {
            logger.warning("audio config refresh failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Run an IMBE-decoded 8 kHz frame through the agency post-decode chain
    /// when configured; otherwise fall back to the legacy duplicate-upsample
    /// path. Resets the processor's biquad state at every talk-spurt boundary
    /// so a previous talker's filter ring can't bleed into the next talker's
    /// first frame.
    private func applyPostDecodeOrDup(_ pcm8k: [Int16]) -> Data {
        guard let processor = postDecodeProcessor else {
            return P25ImbeNative.Frames.upsampleDup8kToLe16Mono(pcm8k160: pcm8k)
        }
        let now = ProcessInfo.processInfo.systemUptime
        if lastInboundVoiceAt == 0 || (now - lastInboundVoiceAt) > talkSpurtGapSeconds {
            processor.reset()
        }
        lastInboundVoiceAt = now
        return processor.process(pcm8k160: pcm8k)
    }

    private func sendJoinFrame() {
        guard let channel = currentChannel, let task else { return }
        let join: [String: String] = [
            "type": "join",
            "channel": channel,
            "unit_id": unitId,
            "client": "ios",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: join),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { [weak self] error in
            if let error {
                Task { @MainActor in self?.onError?("join failed: \(error.localizedDescription)") }
            }
        }
    }

    private func listen() {
        guard let task else { return }
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                Task { @MainActor in
                    self.onError?(error.localizedDescription)
                    self.task = nil
                    self.scheduleReconnect()
                }
            case .success(let message):
                Task { @MainActor in self.handle(message) }
                self.listen()
            }
        }
    }

    private func scheduleReconnect() {
        guard let channel = currentChannel else { return }
        if reconnectTask != nil { return }
        reconnectAttempts += 1
        let delaySeconds = min(pow(2.0, Double(reconnectAttempts - 1)), 16.0)
        onError?("link lost — reconnecting in \(Int(delaySeconds))s")
        let nanoseconds = UInt64(delaySeconds * 1_000_000_000)
        reconnectTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard let self, !Task.isCancelled else { return }
            self.reconnectTask = nil
            guard self.currentChannel == channel else { return }
            guard self.task == nil else { return }
            self.openSocket()
            self.sendJoinFrame()
        }
    }

    @MainActor
    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            handleTextFrame(text)
        case .data(let data):
            dispatchInboundVoice(data)
        @unknown default:
            break
        }
    }

    private func dispatchInboundVoice(_ payload: Data) {
        if payload.count >= 2,
           payload[payload.startIndex] == listenPcmMagic[0],
           payload[payload.startIndex + 1] == listenPcmMagic[1] {
            return
        }
        if payload.count == 13,
           payload[payload.startIndex] == imbeMagic[0],
           payload[payload.startIndex + 1] == imbeMagic[1] {
            guard P25ImbeNative.isAvailable || P25ImbeNative.initialize() else {
                logger.warning("IMBE frame discarded — vocoder not loaded")
                return
            }
            let codeword = payload.subdata(in: 2..<13)
            guard let pcm8k = P25ImbeNative.decodeCodeword11(codeword) else { return }
            let pcm16 = applyPostDecodeOrDup(pcm8k)
            lastReceivedAt = Date()
            onReceivingChange?(true)
            audio.enqueueIncoming(pcm16)
            return
        }
        lastReceivedAt = Date()
        onReceivingChange?(true)
        audio.enqueueIncoming(payload)
    }

    private func handleTextFrame(_ text: String) {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String else { return }
        switch type {
        case "joined":
            let channel = (object["channel"] as? String) ?? ""
            let permRaw = (object["permission"] as? String) ?? "listen_only"
            let unit = (object["unit_id"] as? String) ?? unitId
            let permission = Permission(rawValue: permRaw) ?? .listenOnly
            reconnectAttempts = 0
            onJoined?(Joined(channel: channel, permission: permission, unitId: unit))
        case "busy":
            let holder = (object["unit_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            onBusy?(holder?.isEmpty == true ? nil : holder)
        case "error":
            let code = (object["code"] as? String) ?? "unknown"
            onError?(code)
        default:
            break
        }
    }

    private func startReceivingHeartbeat() {
        receivingTimer?.invalidate()
        let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if Date().timeIntervalSince(self.lastReceivedAt) > 0.3 {
                    self.onReceivingChange?(false)
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        receivingTimer = timer
    }
}
