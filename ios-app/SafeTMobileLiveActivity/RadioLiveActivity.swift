import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct RadioLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RadioActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Image(systemName: "antenna.radiowaves.left.and.right")
                    .font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.channel)
                        .font(.headline)
                    if let callsign = context.state.callsign, !callsign.isEmpty {
                        Text(callsign).font(.caption)
                    }
                }
                Spacer()
                statePill(context.state.stateLabel)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.channel, systemImage: "antenna.radiowaves.left.and.right")
                        .font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    statePill(context.state.stateLabel)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let callsign = context.state.callsign, !callsign.isEmpty {
                        Text(callsign).font(.subheadline)
                    }
                }
            } compactLeading: {
                Image(systemName: "antenna.radiowaves.left.and.right")
            } compactTrailing: {
                Text(context.state.stateLabel)
                    .font(.caption2.bold())
            } minimal: {
                Text(stateInitial(context.state.stateLabel))
                    .font(.caption2.bold())
            }
        }
    }

    @ViewBuilder
    private func statePill(_ label: String) -> some View {
        Text(label)
            .font(.caption.bold())
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(pillColor(label).opacity(0.2))
            .foregroundColor(pillColor(label))
            .clipShape(Capsule())
    }

    private func pillColor(_ label: String) -> Color {
        switch label {
        case "TX": return .green
        case "RX": return .blue
        default: return .gray
        }
    }

    private func stateInitial(_ label: String) -> String {
        label.first.map { String($0) } ?? "·"
    }
}
