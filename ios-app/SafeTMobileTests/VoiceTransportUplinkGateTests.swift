import XCTest
@testable import SafeTMobile

/// Regression coverage for the `uplinkActive` gate added in PR #146
/// ("ios: block queued capture frames after PTT reset").
///
/// Captured mic frames hit `VoiceTransport.sendCaptured(_:)` from the audio
/// thread and are bounced onto the MainActor via a `Task`. Those tasks can
/// outlive a PTT release by tens of milliseconds, so without an explicit
/// gate a fast key-down → key-up → key-down sequence sent the *previous*
/// transmission's tail frames onto the *next* PTT cycle (or worse, after
/// the channel had been handed to another unit).
///
/// The fix is a two-line state machine on `VoiceTransport`:
///   - `beginUplink()` arms the gate on the MainActor before mic capture
///     starts.
///   - `resetUplinkState()` (called on PTT release, busy preempt, error,
///     and disconnect) clears the gate *first*, before draining the PCM
///     accumulator or resetting the conditioner — so any in-flight Task
///     that wakes up after release is dropped at the guard in
///     `sendCapturedOnMain`.
///
/// If a future refactor:
///   - forgets to clear `uplinkActive` inside `resetUplinkState`, ghost
///     frames from a released PTT cycle will be transmitted on the next
///     air holder's slot.
///   - moves the `uplinkActive = false` line *below* `pcmAcc.removeAll()`,
///     the race window reappears (a queued Task can race the clear and
///     send a partially-stale accumulator).
///   - removes `beginUplink()` from the RadioViewModel PTT path, the
///     channel acquires correctly but no frames are ever sent.
///
/// Each is a silent, high-blast-radius regression — there's no error
/// surfaced anywhere; the symptom is just "audio is wrong on air."
/// The state-machine assertions below pin the contract.
@MainActor
final class VoiceTransportUplinkGateTests: XCTestCase {

    private func makeTransport() -> VoiceTransport {
        VoiceTransport(
            baseURL: URL(string: "wss://radio.example.com")!,
            token: "test-token",
            unitId: "TEST-1",
            audio: VoiceAudio()
        )
    }

    /// A fresh transport must not be uplinking — otherwise the first
    /// post-construction `sendCaptured` call (which can happen if a stale
    /// audio engine is still firing taps from a previous session) would be
    /// transmitted on the new channel.
    func test_uplinkActive_isFalseAfterInit() {
        let transport = makeTransport()
        XCTAssertFalse(transport._uplinkActiveForTest,
                       "newly-constructed VoiceTransport must not have the uplink gate armed")
    }

    /// `beginUplink()` is the only way to arm the gate. The RadioViewModel
    /// PTT path calls this immediately before `voiceAudio.startCapture()`.
    func test_beginUplink_armsTheGate() {
        let transport = makeTransport()
        transport.beginUplink()
        XCTAssertTrue(transport._uplinkActiveForTest)
    }

    /// `resetUplinkState()` is the disarm path. It's called on PTT release,
    /// busy preempt, air-check failure, and disconnect. The gate must flip
    /// to false BEFORE the PCM accumulator is drained — see the doc comment
    /// inside `resetUplinkState` itself.
    func test_resetUplinkState_clearsTheGate() {
        let transport = makeTransport()
        transport.beginUplink()
        XCTAssertTrue(transport._uplinkActiveForTest)

        transport.resetUplinkState()
        XCTAssertFalse(transport._uplinkActiveForTest,
                       "resetUplinkState() must disarm the gate so queued post-release frames are dropped")
    }

    /// `disconnect()` calls `resetUplinkState()` as part of its teardown.
    /// Verify the gate clears via the full disconnect path too — a future
    /// refactor that inlines disconnect logic must not skip the disarm.
    func test_disconnect_clearsTheGate() {
        let transport = makeTransport()
        transport.beginUplink()

        transport.disconnect()
        XCTAssertFalse(transport._uplinkActiveForTest,
                       "disconnect() must disarm the uplink gate")
    }

    /// The state machine must be idempotent under repeated key-up/release
    /// (rapid PTT chatter). Each beginUplink/resetUplinkState pair must
    /// leave the gate in the expected terminal state — no stale-true.
    func test_repeatedBeginAndResetCycles_leaveGateDisarmed() {
        let transport = makeTransport()
        for _ in 0..<5 {
            transport.beginUplink()
            XCTAssertTrue(transport._uplinkActiveForTest)
            transport.resetUplinkState()
            XCTAssertFalse(transport._uplinkActiveForTest)
        }
    }

    /// Calling `resetUplinkState()` twice in a row (which happens when
    /// `disconnect` is called during an active PTT — the manual reset on
    /// release races the disconnect path) must remain disarmed and not
    /// throw / re-arm anything.
    func test_resetUplinkState_isIdempotent() {
        let transport = makeTransport()
        transport.beginUplink()
        transport.resetUplinkState()
        transport.resetUplinkState()
        XCTAssertFalse(transport._uplinkActiveForTest)
    }

    /// Calling `beginUplink()` while already armed must remain armed (no
    /// hidden off-then-on flap). This protects against a future change
    /// that adds a tristate but forgets to handle the already-armed case.
    func test_beginUplink_whileAlreadyArmed_staysArmed() {
        let transport = makeTransport()
        transport.beginUplink()
        transport.beginUplink()
        XCTAssertTrue(transport._uplinkActiveForTest)
    }
}
