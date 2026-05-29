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

// Xcode 16.4's AppIntentsSSUTraining build phase fails to parse
// extract.actionsdata when an app declares AppIntents but no
// AppShortcutsProvider. Exposing the two intents here both fixes the
// build and surfaces them in the Shortcuts app without manual binding.
@available(iOS 16.4, *)
struct SafeTAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartPttIntent(),
            phrases: ["Start \(.applicationName) PTT", "Key \(.applicationName)"],
            shortTitle: "Start PTT",
            systemImageName: "dot.radiowaves.left.and.right"
        )
        AppShortcut(
            intent: StopPttIntent(),
            phrases: ["Stop \(.applicationName) PTT", "Unkey \(.applicationName)"],
            shortTitle: "Stop PTT",
            systemImageName: "dot.radiowaves.right"
        )
    }
}
#endif
