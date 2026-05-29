import Foundation
import Network

/// Singleton NWPathMonitor wrapper. Callers set `onChange` once and hop to the
/// main actor themselves — the monitor queue is private to this file.
final class NetworkPathMonitor {
    static let shared = NetworkPathMonitor()

    private(set) var isReachable: Bool = true
    var onChange: ((Bool) -> Void)?

    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "safet.net")

    init() {
        monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let reachable = (path.status == .satisfied)
            self.isReachable = reachable
            self.onChange?(reachable)
        }
        monitor.start(queue: queue)
    }
}
