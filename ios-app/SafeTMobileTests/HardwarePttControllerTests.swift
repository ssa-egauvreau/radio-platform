import XCTest
@testable import SafeTMobile

final class HardwarePttControllerTests: XCTestCase {
    func test_downEdge_emitsPress() {
        var c = HardwarePttController.Classifier()
        XCTAssertEqual(c.classify(old: 0.5, new: 0.4, now: Date()), .press)
        XCTAssertTrue(c.isPressed)
    }

    func test_upEdge_afterPress_emitsRelease() {
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        _ = c.classify(old: 0.5, new: 0.4, now: t0)
        // step past the (post-release) grace window
        let t1 = t0.addingTimeInterval(1.0)
        XCTAssertEqual(c.classify(old: 0.4, new: 0.5, now: t1), .release)
        XCTAssertFalse(c.isPressed)
    }

    func test_pressFollowedBySecondPress_isAccepted() {
        // The classifier only gates on the press-edge transition out of an
        // already-pressed state. A second downward sample while already
        // pressed is just a no-op (the volume kept dropping); there is no
        // grace window on presses any more.
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        XCTAssertEqual(c.classify(old: 0.5, new: 0.4, now: t0), .press)
        // Already pressed — a second downward edge is ignored because there's
        // nothing to press.
        XCTAssertNil(c.classify(old: 0.4, new: 0.3, now: t0.addingTimeInterval(0.1)))
    }

    func test_releaseWithoutPrior_isIgnored() {
        var c = HardwarePttController.Classifier()
        XCTAssertNil(c.classify(old: 0.4, new: 0.5, now: Date()))
        XCTAssertFalse(c.isPressed)
    }

    func test_pressThenUp_immediately_fires() {
        // Press-then-release within what used to be the post-press grace
        // window must now fire — the press doesn't arm any grace and the
        // release is the first event after .distantPast.
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        XCTAssertEqual(c.classify(old: 0.5, new: 0.4, now: t0), .press)
        XCTAssertEqual(c.classify(old: 0.4, new: 0.5, now: t0.addingTimeInterval(0.1)), .release)
        XCTAssertFalse(c.isPressed)
    }

    func test_releaseFollowedBySnapBack_isSuppressed() {
        // After a real release iOS may immediately snap the system volume
        // back to its prior level. That snap-back arrives as a fresh
        // press-then-release pair within the grace window and must not fire
        // a phantom second release.
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        _ = c.classify(old: 0.5, new: 0.4, now: t0)
        XCTAssertEqual(c.classify(old: 0.4, new: 0.5, now: t0.addingTimeInterval(0.1)), .release)
        // Snap-back press arrives — gets accepted (presses are never gated)…
        XCTAssertEqual(c.classify(old: 0.5, new: 0.4, now: t0.addingTimeInterval(0.15)), .press)
        // …but the very next release inside the grace window is swallowed.
        XCTAssertNil(c.classify(old: 0.4, new: 0.5, now: t0.addingTimeInterval(0.2)))
    }
}

#if canImport(AppIntents)
import AppIntents

final class PttIntentsSmokeTests: XCTestCase {
    func test_intents_compile_and_haveTitles() {
        if #available(iOS 16.0, *) {
            _ = StartPttIntent.title
            _ = StopPttIntent.title
        }
    }
}
#endif
