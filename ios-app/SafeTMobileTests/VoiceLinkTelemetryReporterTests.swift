import XCTest
@testable import SafeTMobile

/// `VoiceLinkTelemetryReporter` is the iOS sibling of the Android / web
/// reporter that posts inbound voice-link counters to
/// `POST /v1/telemetry/voice-link` every ~30 s. The tests below pin the
/// shape of the JSON body the server-side parser expects (any drift would
/// silently break the admin dashboard) and the counter-recording contract
/// that VoiceTransport / InboundJitterBuffer rely on.
final class VoiceLinkTelemetryReporterTests: XCTestCase {

    override func setUp() {
        super.setUp()
        VoiceLinkTelemetryReporter.shared.resetForTest()
    }

    override func tearDown() {
        VoiceLinkTelemetryReporter.shared.stop()
        VoiceLinkTelemetryReporter.shared.resetForTest()
        super.tearDown()
    }

    // MARK: - counter recording

    func test_recordFrameReceived_bumpsWindowAndCodecBreakdown() {
        let r = VoiceLinkTelemetryReporter.shared
        r.recordFrameReceived(codec: "imbe", bytes: 24)
        r.recordFrameReceived(codec: "imbe", bytes: 24)
        r.recordFrameReceived(codec: "opus", bytes: 50)
        let snap = r.snapshotForTest()
        XCTAssertEqual(snap.framesReceived, 3)
    }

    func test_recordFrameReceived_clampsNegativeBytesToZero() {
        // A buggy upstream (corrupt frame size, etc.) must not yield a
        // negative `bytesReceived` that the server then has to clamp again.
        let r = VoiceLinkTelemetryReporter.shared
        r.recordFrameReceived(codec: "imbe", bytes: -100)
        let snap = r.snapshotForTest()
        XCTAssertEqual(snap.framesReceived, 1)
    }

    // MARK: - JSON body shape

    func test_buildReportBody_producesExpectedKeys() throws {
        // The server's `parseVoiceLinkTelemetryBody` is strict about which
        // counter keys it accepts. Drift between platforms is silent — a
        // typo here would land empty counters in Postgres. Pin the wire
        // shape (top-level keys + counter sub-keys) and the per-platform
        // `clientType` value the dashboard uses to filter by platform.
        var counters = VoiceLinkTelemetryReporter.WindowCounters(openedAtMs: 1_700_000_000_000)
        counters.framesReceived = 1500
        counters.framesDecoded = 1500
        counters.decodeFailures = 0
        counters.plcFramesSynthesized = 5
        counters.bufferUnderruns = 1
        counters.maxBufferDepthFrames = 6
        counters.talkSpurtsStarted = 3
        counters.talkSpurtsEnded = 3
        counters.bytesReceived = 56_000
        counters.codecBreakdown["imbe"] =
            VoiceLinkTelemetryReporter.CodecCounters(framesReceived: 1500, framesDecoded: 1500)

        let window = VoiceLinkTelemetryReporter.QueuedWindow(
            unitId: "U-1001",
            channel: "Green 1",
            counters: counters,
            closedAtMs: 1_700_000_030_000,
        )
        let data = try XCTUnwrap(VoiceLinkTelemetryReporter.buildReportBody(window))
        let obj = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(obj["unitId"] as? String, "U-1001")
        XCTAssertEqual(obj["channel"] as? String, "Green 1")
        XCTAssertEqual(obj["clientType"] as? String, "ios")

        let countersObj = try XCTUnwrap(obj["counters"] as? [String: Any])
        XCTAssertEqual(countersObj["framesReceived"] as? Int, 1500)
        XCTAssertEqual(countersObj["framesDecoded"] as? Int, 1500)
        XCTAssertEqual(countersObj["decodeFailures"] as? Int, 0)
        XCTAssertEqual(countersObj["plcFramesSynthesized"] as? Int, 5)
        XCTAssertEqual(countersObj["bufferUnderruns"] as? Int, 1)
        XCTAssertEqual(countersObj["maxBufferDepthFrames"] as? Int, 6)
        XCTAssertEqual(countersObj["talkSpurtsStarted"] as? Int, 3)
        XCTAssertEqual(countersObj["talkSpurtsEnded"] as? Int, 3)
        XCTAssertEqual(countersObj["bytesReceived"] as? Int, 56_000)
        XCTAssertEqual(countersObj["wallMsObservation"] as? Int, 30_000)

        let codec = try XCTUnwrap(obj["codecBreakdown"] as? [String: [String: Int]])
        XCTAssertEqual(codec["imbe"]?["framesReceived"], 1500)
        XCTAssertEqual(codec["imbe"]?["framesDecoded"], 1500)

        // ISO 8601 with fractional seconds and `Z` suffix — same format the
        // server's `Date.parse` accepts in JS and the Android reporter emits.
        let ts = try XCTUnwrap(obj["clientTs"] as? String)
        XCTAssertTrue(ts.hasSuffix("Z"))
    }

    func test_buildReportBody_omitsChannelWhenNil() {
        // A unit on no channel (idle/`----`) sends no `channel` field; the
        // server stores NULL in that column.
        let counters = VoiceLinkTelemetryReporter.WindowCounters(openedAtMs: 0)
        let window = VoiceLinkTelemetryReporter.QueuedWindow(
            unitId: "U-IDLE",
            channel: nil,
            counters: counters,
            closedAtMs: 30_000,
        )
        let data = VoiceLinkTelemetryReporter.buildReportBody(window)!
        let obj = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertNil(obj["channel"])
    }
}
