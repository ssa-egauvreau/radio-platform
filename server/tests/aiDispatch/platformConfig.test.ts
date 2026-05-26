/**
 * Tests for `server/src/aiDispatch/platformConfig.ts` — the pure helpers
 * `normalizeDispatchUnitId` and `isAiDispatchUnit`.
 *
 * Why this matters
 * ----------------
 * `isAiDispatchUnit` is the loop-breaker the engine uses to make sure the AI
 * dispatcher never re-processes its own outbound transmissions. Without it,
 * every TTS reply the AI speaks back on the channel would be re-routed
 * through the dispatch engine and parsed as if it were a fresh officer
 * transmission — at best wasting LLM tokens, at worst creating fake CAD
 * incidents in a feedback loop. See engine.ts: a hit on
 * `isAiDispatchUnit(tx.unit_id)` short-circuits with outcome
 * `skipped_dispatch_unit`.
 *
 * The normaliser is the same logic the cached env loader runs on
 * `AI_DISPATCH_UNIT_ID` at boot, so the comparison is symmetric (incoming
 * unit_id and configured unit_id get folded the same way). If the
 * normaliser stops trimming or stops uppercasing, the loop guard silently
 * mismatches an incoming "  ai-dispatch  " against the cached "AI-DISPATCH"
 * and the engine starts replying to its own voice.
 *
 * Setup note
 * ----------
 * The platform config is read from env *once* and cached. We do not set
 * AI_DISPATCH_UNIT_ID before importing, so the default value of
 * "AI-DISPATCH" is what `isAiDispatchUnit` compares against.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchUnit,
  normalizeDispatchUnitId,
} from "../../src/aiDispatch/platformConfig.js";

// ---------- normalizeDispatchUnitId --------------------------------------

test("normalizeDispatchUnitId: trims surrounding whitespace and uppercases", () => {
  assert.equal(normalizeDispatchUnitId("ai-dispatch"), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("  ai-dispatch  "), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("\tai-dispatch\n"), "AI-DISPATCH");
});

test("normalizeDispatchUnitId: idempotent on an already-normalised id", () => {
  // Applying the function twice must give the same value as applying it
  // once — this is the property the engine relies on when comparing the
  // cached AI dispatch id against an incoming tx.unit_id.
  const once = normalizeDispatchUnitId("ai-dispatch");
  assert.equal(normalizeDispatchUnitId(once), once);
});

test("normalizeDispatchUnitId: empty string stays empty (caller is responsible for falsy guard)", () => {
  assert.equal(normalizeDispatchUnitId(""), "");
  assert.equal(normalizeDispatchUnitId("   "), "");
});

// ---------- isAiDispatchUnit --------------------------------------------

test("isAiDispatchUnit: matches the configured dispatch unit id exactly", () => {
  // Default unit id is "AI-DISPATCH" (see platformConfig.ts) when no
  // AI_DISPATCH_UNIT_ID env is set. We compare against the canonical value.
  assert.equal(isAiDispatchUnit("AI-DISPATCH"), true);
});

test("isAiDispatchUnit: matches case-insensitively and ignores surrounding whitespace", () => {
  // The engine compares an arbitrary tx.unit_id (raw from a client) against
  // the cached normalised id. Symmetric normalisation must make every
  // variant the radio could send still resolve to "yes, this is the AI".
  for (const variant of [
    "ai-dispatch",
    "Ai-Dispatch",
    "AI-DISPATCH",
    "  AI-DISPATCH  ",
    "\tai-dispatch\n",
  ]) {
    assert.equal(isAiDispatchUnit(variant), true, `variant "${variant}" must match the AI unit`);
  }
});

test("isAiDispatchUnit: false for null / undefined / empty / whitespace-only", () => {
  // The guard exists to prevent a falsy unit_id from accidentally matching
  // an empty cached id. The `!unitId?.trim()` early return MUST stay.
  assert.equal(isAiDispatchUnit(null), false);
  assert.equal(isAiDispatchUnit(undefined), false);
  assert.equal(isAiDispatchUnit(""), false);
  assert.equal(isAiDispatchUnit("   "), false);
});

test("isAiDispatchUnit: false for a real officer unit id", () => {
  // The whole point of the guard is that an officer's tx is NOT misclassified
  // as an AI-spoken transmission (which would silently drop it as
  // skipped_dispatch_unit).
  for (const real of ["27-040", "352", "ADAM-5", "S-5", "DISPATCH"]) {
    assert.equal(isAiDispatchUnit(real), false, `unit "${real}" must NOT be flagged as AI dispatch`);
  }
});

test("isAiDispatchUnit: substring of the AI id does NOT match (no accidental prefix matching)", () => {
  // Defensive: a unit id of "AI" or "DISPATCH" alone must not match
  // "AI-DISPATCH" — otherwise an agency that happens to name a unit "AI"
  // would have every one of its transmissions silently dropped.
  assert.equal(isAiDispatchUnit("AI"), false);
  assert.equal(isAiDispatchUnit("DISPATCH"), false);
  assert.equal(isAiDispatchUnit("AI-DISPATCH-2"), false);
});
