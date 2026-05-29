import XCTest

/// Smoke tests for the safeT Mobile shell. The default launch shows the login
/// screen; passing `-uitest-logged-in` bootstraps a fake AuthSession so the
/// radio shell can be asserted without a real server.
final class RadioScreenUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    // MARK: - login screen (default launch)

    func test_login_showsCredentialFields_andSignInButton() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["safeT"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["USERNAME"].exists)
        XCTAssertTrue(app.staticTexts["PASSWORD"].exists)
        XCTAssertTrue(app.buttons["SIGN IN"].exists)
    }

    // MARK: - radio shell (forced sign-in)

    func test_radio_launchesAndShowsCoreControls() {
        let app = XCUIApplication()
        // Force the legacy PTT bar so HOLD TO TALK is rendered (the big PTT
        // button has its own coverage in PttControlsRegressionUITests).
        app.launchArguments += ["-uitest-logged-in", "-uitest-big-ptt-off"]
        app.launch()

        // Status strip shows the stubbed unit id.
        XCTAssertTrue(app.staticTexts["UNIT UITEST"].waitForExistence(timeout: 5))

        // The PTT bar shows HOLD TO TALK in the idle state.
        XCTAssertTrue(app.staticTexts["HOLD TO TALK"].exists)

        // The emergency button is always rendered in the idle layout. SwiftUI
        // exposes a `Button { ... } label: { Text(...) }` as a button (with the
        // Text as its accessibility label), not as a separate staticText.
        XCTAssertTrue(app.buttons["EMERGENCY"].exists)

        // Settings tab is always visible in the icon-only tab strip (its
        // accessibilityLabel is "SETTINGS"). Sign-out now lives inside it.
        XCTAssertTrue(app.buttons["SETTINGS"].exists)
    }

    func test_radio_signOut_returnsToLogin() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-uitest-logged-in"]
        app.launch()

        let settings = app.buttons["SETTINGS"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()

        let openConfirm = app.buttons["Sign Out…"]
        XCTAssertTrue(openConfirm.waitForExistence(timeout: 3))
        openConfirm.tap()

        let confirm = app.buttons["Sign Out"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        confirm.tap()

        XCTAssertTrue(app.buttons["SIGN IN"].waitForExistence(timeout: 3))
    }
}
