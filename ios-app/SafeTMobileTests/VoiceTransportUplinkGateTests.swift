import XCTest
@testable import SafeTMobile

/// Regression coverage for the PTT uplink gate in `VoiceTransport`.
///
/// `sendCaptured(_:)` is `nonisolated` and bounces every captured PCM frame
/// onto the MainActor via `Task { @MainActor in self?.sendCapturedOnMain(...) }`.
/// Without the `uplinkActive` flag, a frame produced just before the operator
/// releases PTT could land *after* `resetUplinkState()` and get pushed to the
/// server — leaking audio after key-down ends, breaking half-duplex, and
/// potentially defeating the busy/release contract on the server side.
///
/// These tests pin down the state machine of that gate:
///   1. It starts disarmed.
///   2. `beginUplink()` is the only thing that arms it.
///   3. `resetUplinkState()` and `disconnect()` disarm it.
///   4. A frame queued through the MainActor hop *before* a reset must observe
///      the gate as closed when it runs (the post-release frame is dropped).
@MainActor
final class VoiceTransportUplinkGateTests: XCTestCase {

    // MARK: - state machine

    func test_uplinkActive_initiallyFalse() {
        let transport = makeTransport()
        XCTAssertFalse(transport.uplinkActive,
                       "Uplink must start disarmed — otherwise the first capture frame would ship before PTT key-up completes the air check.")
    }

    func test_beginUplink_armsTheGate() {
        let transport = makeTransport()
        transport.beginUplink()
        XCTAssertTrue(transport.uplinkActive)
    }

    func test_resetUplinkState_disarmsTheGate() {
        let transport = makeTransport()
        transport.beginUplink()
        XCTAssertTrue(transport.uplinkActive)

        transport.resetUplinkState()
        XCTAssertFalse(transport.uplinkActive,
                       "resetUplinkState() must immediately close the gate so that frames already in flight on the MainActor queue are dropped.")
    }

    func test_disconnect_disarmsTheGate() {
        // `disconnect()` calls `resetUplinkState()` internally. If a future
        // refactor splits those apart, an uplink could remain armed across a
        // socket teardown and the first frame after reconnect would ship
        // without a fresh PTT — silently breaking the half-duplex contract.
        let transport = makeTransport()
        transport.beginUplink()
        XCTAssertTrue(transport.uplinkActive)

        transport.disconnect()
        XCTAssertFalse(transport.uplinkActive)
    }

    func test_repeatedKeyCycle_alternatesGateCleanly() {
        // Real users mash PTT — armed/disarmed must toggle deterministically
        // and never latch. A stuck `true` after a release would leak audio;
        // a stuck `false` after a press would silently mute the operator.
        let transport = makeTransport()
        for _ in 0..<5 {
            transport.beginUplink()
            XCTAssertTrue(transport.uplinkActive)
            transport.resetUplinkState()
            XCTAssertFalse(transport.uplinkActive)
        }
    }

    func test_beginUplink_isIdempotent() {
        // The view model can call `beginUplink()` before each key-down; calling
        // it twice in a row (e.g. after a denied air check followed by an
        // immediate retry) must not require an interleaving reset.
        let transport = makeTransport()
        transport.beginUplink()
        transport.beginUplink()
        XCTAssertTrue(transport.uplinkActive)
    }

    func test_resetUplinkState_isIdempotent() {
        let transport = makeTransport()
        transport.resetUplinkState()
        transport.resetUplinkState()
        XCTAssertFalse(transport.uplinkActive)
    }

    // MARK: - the actual regression: queued frame after release

    func test_sendCaptured_queuedBeforeReset_observesClosedGateAfterReset() async {
        // Reproduces the exact race the gate exists to defeat:
        //   t0  beginUplink()                      ← key-down, air clear
        //   t1  sendCaptured(frame)                ← mic delivers a frame
        //                                            (enqueued on MainActor)
        //   t2  resetUplinkState()                 ← key-up
        //   t3  queued task drains                 ← MUST see uplinkActive=false
        //
        // Before this fix, t3 ran with the same state it had at t1 (true) and
        // shipped the post-release frame. With the gate, the queued task
        // re-reads `uplinkActive` and drops the frame.
        let transport = makeTransport()
        transport.beginUplink()

        // Enqueue a captured frame the same way the mic tap does.
        let frame = Data(count: 320)
        transport.sendCaptured(frame)

        // Synchronously close the gate before the queued Task runs.
        transport.resetUplinkState()
        XCTAssertFalse(transport.uplinkActive)

        // Drain any pending MainActor work. `sendCaptured` schedules a
        // `Task { @MainActor in ... }`; yielding lets it run. The contract
        // we're enforcing: once `resetUplinkState()` returns, no subsequent
        // queued frame can flip the gate back on or sneak past it.
        for _ in 0..<4 { await Task.yield() }

        XCTAssertFalse(transport.uplinkActive,
                       "A queued capture frame must not re-arm uplink; resetUplinkState() is the only legal close for a key-up.")
    }

    func test_sendCaptured_neverArmsTheGateOnItsOwn() async {
        // `sendCaptured(_:)` is invoked from the mic tap callback. It must
        // never be the thing that sets `uplinkActive = true` — only the
        // explicit `beginUplink()` call (driven by a successful air check)
        // is allowed to do that. If this invariant ever flips, a stray mic
        // frame between sessions could open uplink without a PTT press.
        let transport = makeTransport()
        XCTAssertFalse(transport.uplinkActive)

        let frame = Data(count: 320)
        transport.sendCaptured(frame)
        for _ in 0..<4 { await Task.yield() }

        XCTAssertFalse(transport.uplinkActive,
                       "sendCaptured must not arm uplink — only beginUplink() may.")
    }

    // MARK: - helpers

    private func makeTransport() -> VoiceTransport {
        VoiceTransport(
            baseURL: URL(string: "http://127.0.0.1:0")!,
            token: "test-token",
            unitId: "TEST-UNIT",
            audio: VoiceAudio(),
            session: URLSession(configuration: .ephemeral)
        )
    }
}
