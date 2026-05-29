import XCTest
@testable import SafeTMobile

final class VoiceTimingTests: XCTestCase {
    func test_backoff_16Cap() {
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 1, cap: 16), 1, accuracy: 0.0001)
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 4, cap: 16), 8, accuracy: 0.0001)
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 5, cap: 16), 16, accuracy: 0.0001)
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 9, cap: 16), 16, accuracy: 0.0001)
    }

    func test_backoff_30Cap() {
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 1, cap: 30), 1, accuracy: 0.0001)
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 6, cap: 30), 30, accuracy: 0.0001)
    }

    func test_backoff_zeroAttempt_guarded() {
        // max(0, attempt - 1) keeps pow(2, -1) etc. from sneaking in.
        XCTAssertEqual(VoiceTiming.backoffDelaySeconds(attempt: 0, cap: 16), 1, accuracy: 0.0001)
    }
}
