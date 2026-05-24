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
        app.launchArguments += ["-uitest-logged-in"]
        app.launch()

        // Status strip shows the stubbed unit id.
        XCTAssertTrue(app.staticTexts["UNIT UITEST"].waitForExistence(timeout: 5))

        // The PTT bar shows HOLD TO TALK in the idle state.
        XCTAssertTrue(app.staticTexts["HOLD TO TALK"].exists)

        // The emergency button is always rendered in the idle layout.
        XCTAssertTrue(app.staticTexts["EMERGENCY"].exists)

        // The sign-out chip is visible on the operator strip.
        XCTAssertTrue(app.buttons["SIGN OUT"].exists)
    }

    func test_radio_signOut_returnsToLogin() throws {
        let app = XCUIApplication()
        app.launchArguments += ["-uitest-logged-in"]
        app.launch()

        let signOut = app.buttons["SIGN OUT"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 5))
        signOut.tap()

        XCTAssertTrue(app.buttons["SIGN IN"].waitForExistence(timeout: 3))
    }
}
