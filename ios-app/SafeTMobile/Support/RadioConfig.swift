import Foundation

/// Server connection settings, read from Info.plist (populated by Local.xcconfig
/// — see ios-app/Local.example.xcconfig). The radio API key is no longer used —
/// every request now carries the user's JWT in `Authorization: Bearer …`.
enum RadioConfig {
    static let apiBaseURL: URL = {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String) ?? ""
        return URL(string: raw) ?? URL(string: "https://example.invalid")!
    }()
}
