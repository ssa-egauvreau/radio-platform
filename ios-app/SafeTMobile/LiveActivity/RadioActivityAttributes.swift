import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.2, *)
struct RadioActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var channel: String
        var callsign: String?
        var stateLabel: String
    }
}
#endif
