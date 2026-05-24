import AVFoundation

/// Configures the shared AVAudioSession for half-duplex radio voice: speakerphone
/// by default, voice-chat mode (echo cancellation), allow Bluetooth headsets.
enum AudioSessionManager {
    static func configureForVoice() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .voiceChat,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        )
        try session.setActive(true, options: [])
    }

    static func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// iOS 16-compatible record-permission request.
    static func requestRecordPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}
