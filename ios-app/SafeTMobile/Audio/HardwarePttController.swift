import AVFoundation
import Foundation

/// Hardware-PTT bridge using the AVAudioSession output-volume KVO trick. iOS
/// snaps the volume back to the system default after a tap, so we keep a
/// short grace window AFTER A RELEASE to swallow that synthetic counter-event.
/// Presses always pass through immediately — operators who quickly tap-and-
/// hold should not have their key-down silently dropped.
final class HardwarePttController {
    /// Pure state machine extracted for unit testing. The KVO change handler
    /// hops to MainActor and feeds events here.
    struct Classifier {
        enum Event { case press, release }
        var graceUntil: Date = .distantPast
        var isPressed: Bool = false

        mutating func classify(old: Float, new: Float, now: Date) -> Event? {
            if new < old - 0.01, !isPressed {
                // Press edges are never gated — iOS only ever fires the
                // synthetic snap-back on the UP side, so suppressing presses
                // here can only ever drop a legitimate key-down.
                isPressed = true
                return .press
            }
            if new > old + 0.01, isPressed {
                // Releases honour the post-release grace window. After a real
                // release iOS may immediately snap the system volume back up
                // to its prior level; without the window we'd treat that
                // snap-back as a phantom second release.
                if now < graceUntil { return nil }
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
    /// Monotonically bumped on every enable()/disable() so KVO callbacks that
    /// were already dispatched before disable() are dropped on the floor when
    /// they finally arrive on MainActor. Without this guard a Task hop can
    /// run handleChange after disable() and silently re-arm `isPressed`.
    private var generation: Int = 0

    init(onPress: @escaping @MainActor () -> Void, onRelease: @escaping @MainActor () -> Void) {
        self.onPress = onPress
        self.onRelease = onRelease
    }

    func enable() {
        guard observation == nil else { return }
        generation += 1
        let activeGeneration = generation
        let session = AVAudioSession.sharedInstance()
        observation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
            guard let self,
                  let oldValue = change.oldValue,
                  let newValue = change.newValue else { return }
            Task { @MainActor [weak self] in
                self?.handleChange(old: oldValue, new: newValue, passedGeneration: activeGeneration)
            }
        }
    }

    func disable() {
        generation += 1
        observation?.invalidate()
        observation = nil
        // Reset the classifier wholesale so a subsequent enable() starts from
        // a clean slate (no leftover grace timer, no stale isPressed flag).
        let wasPressed = classifier.isPressed
        classifier = Classifier()
        if wasPressed {
            let cb = onRelease
            Task { @MainActor in cb() }
        }
    }

    @MainActor
    private func handleChange(old: Float, new: Float, passedGeneration: Int) {
        // Drop late callbacks from a now-disabled observation.
        guard passedGeneration == generation else { return }
        switch classifier.classify(old: old, new: new, now: Date()) {
        case .press: onPress()
        case .release: onRelease()
        case nil: break
        }
    }
}
