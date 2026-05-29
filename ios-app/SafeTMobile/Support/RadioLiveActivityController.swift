import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.2, *)
@MainActor
final class RadioLiveActivityController {
    static let shared = RadioLiveActivityController()

    private var currentActivity: Activity<RadioActivityAttributes>?

    func start(channel: String) {
        guard currentActivity == nil else { return }
        let attributes = RadioActivityAttributes(channel: channel)
        let state = RadioActivityAttributes.ContentState(callsign: nil, stateLabel: "IDLE")
        let content = ActivityContent(state: state, staleDate: nil)
        currentActivity = try? Activity.request(attributes: attributes, content: content, pushType: nil)
    }

    func update(callsign: String?, stateLabel: String) {
        guard let activity = currentActivity else { return }
        let state = RadioActivityAttributes.ContentState(callsign: callsign, stateLabel: stateLabel)
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    func end() {
        guard let activity = currentActivity else { return }
        currentActivity = nil
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }
}
#endif
