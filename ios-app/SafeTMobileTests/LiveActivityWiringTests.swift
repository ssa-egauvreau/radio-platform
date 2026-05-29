import XCTest

final class LiveActivityWiringTests: XCTestCase {
    func test_infoPlist_supportsLiveActivities() {
        let supports = Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool ?? false
        XCTAssertTrue(supports, "Info.plist must declare NSSupportsLiveActivities=YES")
    }

    func test_widgetExtension_isEmbedded() throws {
        let pluginsURL = try XCTUnwrap(Bundle.main.builtInPlugInsURL, "App bundle has no PlugIns")
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(at: pluginsURL, includingPropertiesForKeys: nil)) ?? []
        let appex = entries.filter { $0.pathExtension == "appex" }
        XCTAssertFalse(appex.isEmpty, "Expected at least one .appex bundle in PlugIns/")
        let ids = appex.compactMap { url -> String? in
            Bundle(url: url)?.bundleIdentifier
        }
        XCTAssertTrue(
            ids.contains("com.safetptt.mobile.liveactivity"),
            "Live Activity widget extension not embedded; found ids=\(ids)"
        )
    }
}
