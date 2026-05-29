import Foundation

extension Notification.Name {
    static let safetPttRemote = Notification.Name("com.safetptt.mobile.pttRemote")
}

#if canImport(AppIntents)
import AppIntents

@available(iOS 16.0, *)
struct StartPttIntent: AppIntent {
    static var title: LocalizedStringResource = "Start PTT"
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .safetPttRemote, object: nil, userInfo: ["action": "press"])
        return .result()
    }
}

@available(iOS 16.0, *)
struct StopPttIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop PTT"
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .safetPttRemote, object: nil, userInfo: ["action": "release"])
        return .result()
    }
}
#endif
