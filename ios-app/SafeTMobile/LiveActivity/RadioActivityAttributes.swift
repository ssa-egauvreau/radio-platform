// SHARED FILE — compiled into BOTH the SafeTMobile app target (for
// RadioLiveActivityController) and the SafeTMobileLiveActivity extension
// (for ActivityConfiguration). ActivityKit identifies the type by
// unqualified name at runtime; the field order and Codable shape must
// stay identical across the two compiled copies.
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
