import XCTest
@testable import SafeTMobile

/// Regression tests for `VoiceAudio`'s public capture surface.
///
/// `startCapture()` was historically `Void`-returning, so a route /
/// permission failure (no input channels, no converter) silently left the
/// engine inert while the ViewModel happily flipped `isTransmitting = true`
/// and showed "ON AIR" without ever installing a tap. The operator's
/// transmission was dropped without any UI indication. PR #143 changed
/// `startCapture()` to return `Bool` so the ViewModel can keep the
/// "ON AIR" lie out of the UI when the tap install fails.
///
/// These tests pin the new contract:
///
///  - `startCapture()` returns `Bool` (compile-time guard against a
///    revert of the signature).
///  - Calling `startCapture()` BEFORE `start()` does not crash — it
///    returns `false` cleanly. This is the exact "engine not running"
///    branch the production fix added a guard for; a regression that
///    removed the `channelCount > 0 / sampleRate > 0` early-return would
///    trigger an `AVAudioEngine` exception inside `installTap` and take
///    the app down.
///  - `stopCapture()` is idempotent and safe to call without `start()`
///    or `startCapture()` — the ViewModel's PTT-release path calls it
///    unconditionally, and a future regression that dropped the
///    `guard capturing else { return }` would otherwise hit
///    `removeTap(onBus:)` on a node that never had a tap installed.
///
/// All tests construct `VoiceAudio` directly and avoid calling `start()`
/// so the suite stays headless: an iOS Simulator's audio session and
/// mic-permission state are not deterministic across CI runs, and the
/// production fix is specifically about behaviour BEFORE the engine is
/// fully wired anyway.
final class VoiceAudioTests: XCTestCase {
    func test_startCapture_returnsBool_andDoesNotCrash_whenEngineNotStarted() {
        // The signature change (Void → Bool) is the load-bearing piece of
        // the PR; assigning the result asserts both the new return type
        // (compile-time) and that the call doesn't trap (runtime).
        let voiceAudio = VoiceAudio()
        let result: Bool = voiceAudio.startCapture()

        // We deliberately do not assert true vs false: on a CI simulator
        // with no mic route the format guard is expected to fire and
        // return `false`, but a runner with a happy default mic could
        // legitimately return `true`. The critical regression — a crash
        // inside `installTap` because of a 0-channel format — has
        // already been ruled out by reaching this line at all.
        _ = result

        // Either branch must leave the instance in a state where the
        // subsequent stopCapture() is harmless. Hitting this assertion
        // catches a regression where startCapture mutated capturing=true
        // BEFORE the tap install succeeded (the comment above
        // `capturing = true` in production specifically warns against
        // this).
        voiceAudio.stopCapture()
    }

    func test_stopCapture_isIdempotent_withoutAnyPriorStart() {
        // The PTT-release path in RadioViewModel calls stopCapture()
        // unconditionally on every key-up. If a future change dropped
        // the `guard capturing else { return }` guard, this sequence
        // would crash inside AVAudioEngine.removeTap(onBus:) because
        // there is no installed tap.
        let voiceAudio = VoiceAudio()
        voiceAudio.stopCapture()
        voiceAudio.stopCapture()
        voiceAudio.stopCapture()
        // No crash = pass.
    }

    func test_startCapture_thenStopCapture_canBeRetried_afterFailedStart() {
        // The PR keeps `capturing` false on the failure paths so a
        // later attempt can re-try (the production comment: "Mark
        // capturing AFTER a successful tap install so a failure path
        // doesn't leave stopCapture() trying to remove a tap that was
        // never added"). Verify the surface is still usable after the
        // first call — i.e. a second startCapture() returns Bool and
        // a follow-up stopCapture() does not crash. Without the guard
        // this would either trap or leak state forward.
        let voiceAudio = VoiceAudio()
        _ = voiceAudio.startCapture()
        voiceAudio.stopCapture()
        _ = voiceAudio.startCapture()
        voiceAudio.stopCapture()
    }

    func test_capturedFrame_callback_isNeverInvoked_withoutStart() {
        // A regression that fired the capture callback eagerly (e.g. on
        // tap install) would leak silent / undefined buffers up to
        // VoiceTransport before the user ever pressed PTT. The contract
        // is that frames only flow when the engine is running AND a tap
        // is producing buffers; this test verifies no spurious early
        // invocation by checking the callback stays untouched when only
        // the construction + startCapture-without-start path runs.
        let voiceAudio = VoiceAudio()
        let frameSeen = expectation(description: "frame callback fires")
        frameSeen.isInverted = true
        voiceAudio.onCapturedFrame = { _ in frameSeen.fulfill() }
        _ = voiceAudio.startCapture()
        wait(for: [frameSeen], timeout: 0.1)
        voiceAudio.stopCapture()
    }
}
