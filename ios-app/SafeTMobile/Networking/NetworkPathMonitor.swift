import Foundation
import Network

/// Singleton NWPathMonitor wrapper. The NWPathMonitor publishes updates on
/// its own private queue; we hop everything to MainActor before mutating
/// `isReachable` or firing `onChange` so callers (RadioViewModel) can read
/// the property + the callback safely without an actor isolation gap.
final class NetworkPathMonitor {
    static let shared = NetworkPathMonitor()

    @MainActor private(set) var isReachable: Bool = true
    @MainActor var onChange: ((Bool) -> Void)?

    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "safet.net")

    init() {
        monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let reachable = (path.status == .satisfied)
            DispatchQueue.main.async { [weak self] in
                self?.update(isReachable: reachable)
            }
        }
        monitor.start(queue: queue)
    }

    @MainActor
    private func update(isReachable: Bool) {
        let changed = self.isReachable != isReachable
        self.isReachable = isReachable
        if changed { onChange?(isReachable) }
    }
}
