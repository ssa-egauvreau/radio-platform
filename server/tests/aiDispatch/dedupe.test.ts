/**
 * Tests for `server/src/aiDispatch/dedupe.ts`.
 *
 * The duplicate-AI-dispatch guard is what stops a single radio transmission
 * from being processed by the AI engine N times when simulcast / bridges
 * mirror the same audio onto multiple channels — without it the engine
 * creates N CAD incidents for the same call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldSkipDuplicateAiDispatch } from "../../src/aiDispatch/dedupe.js";

// Each test uses a unique agency id + transcript prefix so that earlier tests
// can't leak their cached entries into later ones. The dedupe map is process-
// global by design (it's keyed off `${agencyId}:${normalizedTranscript}`).
let UNIQ = 0;
function uniqAgency(): number {
  // Pad with the run timestamp to make collisions with prior process state
  // (e.g. test runner re-runs) effectively impossible.
  return 900_000 + Math.floor(Date.now() % 100_000) + UNIQ++;
}

test("first transmission for an agency is never a duplicate", () => {
  const agencyId = uniqAgency();
  assert.equal(
    shouldSkipDuplicateAiDispatch(agencyId, "27-040 in service"),
    false,
  );
});

test("immediate repeat of the same transcript is flagged as a duplicate", () => {
  const agencyId = uniqAgency();
  const tx = "27-040 961 at 100 Disney Way 8VWV621";
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, tx), false);
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, tx), true);
});

test("case + whitespace differences still count as the same transcript", () => {
  const agencyId = uniqAgency();
  const a = "27-040 961 AT 100 Disney Way";
  const b = "27-040   961    at  100 Disney Way";
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, a), false);
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, b), true);
});

test("different agencies do NOT collide on the same transcript", () => {
  const tx = "in service";
  const a = uniqAgency();
  const b = uniqAgency();
  assert.equal(shouldSkipDuplicateAiDispatch(a, tx), false);
  assert.equal(shouldSkipDuplicateAiDispatch(b, tx), false);
});

test("empty / whitespace-only transcripts are never deduped (let the caller decide)", () => {
  const agencyId = uniqAgency();
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, ""), false);
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, ""), false);
  assert.equal(shouldSkipDuplicateAiDispatch(agencyId, "   "), false);
});

test("different transcripts on the same agency are not flagged", () => {
  const agencyId = uniqAgency();
  assert.equal(
    shouldSkipDuplicateAiDispatch(agencyId, "27-040 on scene"),
    false,
  );
  assert.equal(
    shouldSkipDuplicateAiDispatch(agencyId, "27-040 clear"),
    false,
  );
});

test("repeat past the 12-second window is NOT flagged (TTL boundary)", () => {
  // The dedupe window is documented as 12 s. A repeat one tick past that
  // must be treated as a brand-new dispatch — otherwise a slow-running
  // channel that re-uses the same canned phrase ("clear", "in service")
  // would be permanently silenced from the AI engine.
  //
  // Drives `Date.now` directly because the module reads it freshly on
  // every call and computes `now - prev` arithmetically.
  const agencyId = uniqAgency();
  const realNow = Date.now;
  try {
    Date.now = () => 1_000_000;
    assert.equal(
      shouldSkipDuplicateAiDispatch(agencyId, "27-040 in service"),
      false,
      "first call seeds the cache",
    );
    // 11.999 s later — still inside the window, still a duplicate.
    Date.now = () => 1_000_000 + 11_999;
    assert.equal(
      shouldSkipDuplicateAiDispatch(agencyId, "27-040 in service"),
      true,
      "still inside the 12s window, must be flagged",
    );
    // The dedupe path *also* updates `prev` to "now", so the next
    // measurement is from this point, not from the original seed. Step
    // 13 s past the most recent call to clear the window.
    Date.now = () => 1_000_000 + 11_999 + 13_000;
    assert.equal(
      shouldSkipDuplicateAiDispatch(agencyId, "27-040 in service"),
      false,
      "13 s past the previous duplicate hit, window has elapsed — must be a fresh dispatch",
    );
  } finally {
    Date.now = realNow;
  }
});

test("each duplicate hit refreshes the window — chatty channels stay deduped (documented rolling behavior)", () => {
  // The implementation writes `now` into the map BEFORE returning, so
  // every repeat (including ones that were themselves deduped) extends
  // the window. This is intentional: a stuck radio that keys 10 times
  // in a row at 8-s intervals should fire the AI engine exactly once.
  // Pin the behavior so a future "only update on first miss" refactor
  // is a deliberate decision, not an accidental one.
  const agencyId = uniqAgency();
  const realNow = Date.now;
  try {
    let t = 5_000_000;
    Date.now = () => t;
    assert.equal(
      shouldSkipDuplicateAiDispatch(agencyId, "10-4"),
      false,
      "first 10-4 is processed",
    );
    // Repeat every 8 s for 40 s. Every repeat is < 12 s past the
    // previous one, so every repeat is a duplicate AND extends the
    // window. The original 12s clock from t=5_000_000 is long gone but
    // the rolling refresh keeps it deduped.
    for (let i = 0; i < 5; i++) {
      t += 8_000;
      assert.equal(
        shouldSkipDuplicateAiDispatch(agencyId, "10-4"),
        true,
        `repeat #${i + 1} at +${(i + 1) * 8}s must stay deduped (rolling window)`,
      );
    }
    // Finally, leave it alone for 13 s — now it's a fresh dispatch.
    t += 13_000;
    assert.equal(
      shouldSkipDuplicateAiDispatch(agencyId, "10-4"),
      false,
      "after a real quiet gap longer than the window, must be a fresh dispatch",
    );
  } finally {
    Date.now = realNow;
  }
});
