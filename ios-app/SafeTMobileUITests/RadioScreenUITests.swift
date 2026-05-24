import XCTest

/// Smoke tests for the safeT Mobile radio shell. These run against the real
/// app bundle, so the network calls fired by RadioViewModel will fail against
/// the placeholder APIBaseURL — we only assert on the static chrome here.
final class RadioScreenUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    func test_launchesAndShowsCoreControls() {
        let app = XCUIApplication()
        app.launch()

        // Top status strip — the UNIT label is present even before the catalog loads.
        let unitLabel = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'UNIT '")).firstMatch
        XCTAssertTrue(unitLabel.waitForExistence(timeout: 5), "expected the UNIT label in the status strip")

        // The PTT bar shows HOLD TO TALK in the idle state.
        XCTAssertTrue(app.staticTexts["HOLD TO TALK"].waitForExistence(timeout: 5))

        // The emergency button is always rendered in the idle layout.
        XCTAssertTrue(app.staticTexts["EMERGENCY"].exists)

        // The voice-transmit milestone label is intentionally still on screen.
        XCTAssertTrue(app.staticTexts["VOICE TRANSMIT \u{2014} COMING SOON"].exists)
    }

    func test_emergencyTap_togglesLabel() throws {
        let app = XCUIApplication()
        app.launch()

        let emergency = app.buttons.containing(NSPredicate(format: "label CONTAINS 'EMERGENCY'")).firstMatch
        XCTAssertTrue(emergency.waitForExistence(timeout: 5))

        emergency.tap()

        // The label flips immediately to the optimistic "active" copy. The
        // network confirmation will fail against the placeholder server, but
        // the optimistic UI is what we want to assert here.
        let activeLabel = app.staticTexts["EMERGENCY ACTIVE \u{2014} TAP TO CLEAR"]
        XCTAssertTrue(activeLabel.waitForExistence(timeout: 2))
    }
}
