import Foundation

/// Opens a WebSocket to `/v1/voice/stream`, sends the `join` frame the server
/// expects, forwards captured PCM frames upstream, and pipes received binary
/// frames to `VoiceAudio` for playback. Half-duplex enforcement (one talker
/// per channel) is handled server-side; the client just streams while PTT is
/// held and trusts the air-state check for the UI indicator.
@MainActor
final class VoiceTransport {
    enum Permission: String { case listenOnly = "listen_only", talk, talkPriority = "talk_priority" }

    struct Joined { let channel: String; let permission: Permission; let unitId: String }

    var onJoined: ((Joined) -> Void)?
    var onError: ((String) -> Void)?
    /// Reports whether received audio is currently arriving (used for the RX
    /// indicator). True briefly after every binary frame, then false on idle.
    var onReceivingChange: ((Bool) -> Void)?

    private let baseURL: URL
    private let token: String
    private let session: URLSession
    private let audio: VoiceAudio
    private let unitId: String

    private var task: URLSessionWebSocketTask?
    private var currentChannel: String?
    private var lastReceivedAt: Date = .distantPast
    private var receivingTimer: Timer?

    init(baseURL: URL, token: String, unitId: String, audio: VoiceAudio, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.unitId = unitId
        self.audio = audio
        self.session = session
    }

    /// Opens the socket if needed and (re)joins the named channel. Safe to
    /// call repeatedly — Android re-sends `join` whenever channel changes.
    func join(channel: String) {
        currentChannel = channel
        if task == nil { openSocket() }
        sendJoinFrame()
    }

    func disconnect() {
        receivingTimer?.invalidate()
        receivingTimer = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        currentChannel = nil
    }

    /// Send one captured 320-byte PCM16 frame upstream. No-op if not connected.
    nonisolated func sendCaptured(_ frame: Data) {
        Task { @MainActor [weak self] in
            self?.task?.send(.data(frame)) { _ in /* drop send errors; the next reconnect will heal */ }
        }
    }

    // MARK: - private

    private func openSocket() {
        var components = URLComponents(url: baseURL.appendingPathComponent("v1/voice/stream"), resolvingAgainstBaseURL: false)
        components?.scheme = (components?.scheme == "http") ? "ws" : "wss"
        components?.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components?.url else { return }

        let request = URLRequest(url: url)
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        listen()
        startReceivingHeartbeat()
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
                }
            case .success(let message):
                Task { @MainActor in self.handle(message) }
                self.listen()
            }
        }
    }

    @MainActor
    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            handleTextFrame(text)
        case .data(let data):
            lastReceivedAt = Date()
            onReceivingChange?(true)
            audio.enqueueIncoming(data)
        @unknown default:
            break
        }
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
            onJoined?(Joined(channel: channel, permission: permission, unitId: unit))
        case "error":
            let code = (object["code"] as? String) ?? "unknown"
            onError?(code)
        default:
            break
        }
    }

    /// Flip the RX indicator off if no binary frame has arrived for ~300 ms.
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
