import XCTest
@testable import SafeTMobile

final class LocalUnitIdentifierTests: XCTestCase {
    private let storageKey = "safet.localUnitId"

    override func setUp() {
        super.setUp()
        UserDefaults.standard.removeObject(forKey: storageKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: storageKey)
        super.tearDown()
    }

    func test_returnsUppercasedExistingValue() {
        UserDefaults.standard.set("abc123", forKey: storageKey)

        XCTAssertEqual(LocalUnitIdentifier.shortUnitId(), "ABC123")
    }

    func test_trimsWhitespaceAroundExistingValue() {
        UserDefaults.standard.set("  abc123  ", forKey: storageKey)

        XCTAssertEqual(LocalUnitIdentifier.shortUnitId(), "ABC123")
    }

    func test_generatesAndPersists_whenMissing() {
        let first = LocalUnitIdentifier.shortUnitId()
        let second = LocalUnitIdentifier.shortUnitId()

        XCTAssertEqual(first.count, 6, "expected a 6-character short id, got \(first)")
        XCTAssertEqual(first, first.uppercased())
        XCTAssertEqual(first, second, "subsequent calls must return the persisted id")
    }

    func test_treatsBlankStoredValue_asMissing() {
        UserDefaults.standard.set("   ", forKey: storageKey)

        let id = LocalUnitIdentifier.shortUnitId()

        XCTAssertEqual(id.count, 6)
        XCTAssertNotEqual(id.trimmingCharacters(in: .whitespaces), "")
    }
}
