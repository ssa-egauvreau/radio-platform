import AVFoundation
import Foundation

/// Hardware-PTT bridge using the AVAudioSession output-volume KVO trick. iOS
/// snaps the volume back after a tap, so we keep a short grace window after
/// each edge to suppress the synthetic counter-event.
final class HardwarePttController {
    /// Pure state machine extracted for unit testing. The KVO change handler
    /// hops to MainActor and feeds events here.
    struct Classifier {
        enum Event { case press, release }
        var graceUntil: Date = .distantPast
        var isPressed: Bool = false

        mutating func classify(old: Float, new: Float, now: Date) -> Event? {
            if now < graceUntil { return nil }
            if new < old - 0.01, !isPressed {
                isPressed = true
                graceUntil = now.addingTimeInterval(0.4)
                return .press
            }
            if new > old + 0.01, isPressed {
                isPressed = false
                graceUntil = now.addingTimeInterval(0.4)
                return .release
            }
            return nil
        }
    }

    private let onPress: @MainActor () -> Void
    private let onRelease: @MainActor () -> Void
    private var observation: NSKeyValueObservation?
    private var classifier = Classifier()

    init(onPress: @escaping @MainActor () -> Void, onRelease: @escaping @MainActor () -> Void) {
        self.onPress = onPress
        self.onRelease = onRelease
    }

    func enable() {
        guard observation == nil else { return }
        let session = AVAudioSession.sharedInstance()
        observation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
            guard let self,
                  let oldValue = change.oldValue,
                  let newValue = change.newValue else { return }
            Task { @MainActor [weak self] in
                self?.handleChange(old: oldValue, new: newValue)
            }
        }
    }

    func disable() {
        observation?.invalidate()
        observation = nil
        if classifier.isPressed {
            classifier.isPressed = false
            let cb = onRelease
            Task { @MainActor in cb() }
        }
    }

    @MainActor
    private func handleChange(old: Float, new: Float) {
        switch classifier.classify(old: old, new: new, now: Date()) {
        case .press: onPress()
        case .release: onRelease()
        case nil: break
        }
    }
}
