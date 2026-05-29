import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.2, *)
struct RadioActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var callsign: String?
        var stateLabel: String
    }

    var channel: String
}
#endif
