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
        // step past the grace window
        let t1 = t0.addingTimeInterval(1.0)
        XCTAssertEqual(c.classify(old: 0.4, new: 0.5, now: t1), .release)
        XCTAssertFalse(c.isPressed)
    }

    func test_pressFollowedBySecondPress_emitsOnlyOne() {
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        XCTAssertEqual(c.classify(old: 0.5, new: 0.4, now: t0), .press)
        // A second down inside the grace window must be suppressed.
        XCTAssertNil(c.classify(old: 0.4, new: 0.3, now: t0.addingTimeInterval(0.1)))
    }

    func test_releaseWithoutPrior_isIgnored() {
        var c = HardwarePttController.Classifier()
        XCTAssertNil(c.classify(old: 0.4, new: 0.5, now: Date()))
        XCTAssertFalse(c.isPressed)
    }

    func test_pressThenUp_withinGrace_isIgnored() {
        var c = HardwarePttController.Classifier()
        let t0 = Date()
        _ = c.classify(old: 0.5, new: 0.4, now: t0)
        XCTAssertNil(c.classify(old: 0.4, new: 0.5, now: t0.addingTimeInterval(0.1)))
        XCTAssertTrue(c.isPressed)
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
