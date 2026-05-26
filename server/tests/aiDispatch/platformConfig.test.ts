/**
 * Regression tests for the pure helpers in
 * `server/src/aiDispatch/platformConfig.ts`.
 *
 * `isAiDispatchUnit` is the safeguard that the AI dispatcher engine uses
 * to avoid replying to its own transmissions — `engine.ts` calls it at
 * the top of `handleTransmission()` and bails if the unit ID matches the
 * platform-configured dispatcher unit. Without this guard, the AI's own
 * TTS reply would loop back through the recorder and trigger another AI
 * reply, ad infinitum. A regression that started returning `false` for
 * the dispatcher's own ID would melt the LLM bill in minutes.
 *
 * `normalizeDispatchUnitId` is the trim+uppercase canonicaliser both
 * sides of that comparison run through. It also lives on the admin
 * configuration path (the stored env value is canonicalised before
 * persistence) so two pieces of code that compare unit IDs must agree
 * on the canonical form.
 *
 * These tests pin:
 *
 *   - The canonicaliser is idempotent (canonicalising a canonical value
 *     is a no-op).
 *   - It is whitespace- and case-tolerant in both directions: any
 *     cosmetic variation of "AI-DISPATCH" must compare equal to the
 *     default configured ID.
 *   - `isAiDispatchUnit` returns false for the empty / null / undefined
 *     unit IDs the engine receives for malformed transmissions — the
 *     guard MUST NOT short-circuit on garbage and skip a real unit's
 *     transmission.
 *   - The comparison is case-insensitive end-to-end so a handset that
 *     reported its own unit as "ai-dispatch" still gets caught (this
 *     is the actual failure path: the AI dispatcher engine writes its
 *     unit ID with the canonical casing, but a misconfigured bridge
 *     could echo it back lower-case).
 *
 * NOTE: `getAiDispatchPlatformConfig()` lazily reads env vars on first
 * call and caches the result for the lifetime of the process. We do
 * not touch any of the AI_DISPATCH_* env vars in this file so the
 * cached config carries the documented defaults (dispatchUnitId =
 * "AI-DISPATCH"). node:test runs each test file in its own subprocess,
 * so the cache is fresh per file and isolated from other suites.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchUnit,
  normalizeDispatchUnitId,
} from "../../src/aiDispatch/platformConfig.js";

test("normalizeDispatchUnitId: trims and upper-cases (canonical form for comparisons)", () => {
  assert.equal(normalizeDispatchUnitId("ai-dispatch"), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId(" AI-Dispatch "), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("\tAI-DISPATCH\n"), "AI-DISPATCH");
});

test("normalizeDispatchUnitId: is idempotent on an already-canonical value", () => {
  const canonical = "AI-DISPATCH";
  assert.equal(normalizeDispatchUnitId(canonical), canonical);
  assert.equal(
    normalizeDispatchUnitId(normalizeDispatchUnitId(canonical)),
    canonical,
    "canonicalising twice must equal canonicalising once",
  );
});

test("normalizeDispatchUnitId: preserves the body of the ID (no character substitution)", () => {
  // The function is intentionally a thin trim+upper — it must not strip
  // hyphens, digits, or punctuation that a future agency might use in
  // their dispatcher unit name (e.g. "AI-DISPATCH-2", "DISP/AI").
  assert.equal(normalizeDispatchUnitId("ai-dispatch-2"), "AI-DISPATCH-2");
  assert.equal(normalizeDispatchUnitId("disp/ai"), "DISP/AI");
  assert.equal(normalizeDispatchUnitId("ai_dispatch"), "AI_DISPATCH");
});

test("isAiDispatchUnit: returns true for every cosmetic variant of the default dispatcher ID", () => {
  // The platform default for `dispatchUnitId` is "AI-DISPATCH". Every
  // cosmetic variation a handset or bridge might echo back must still
  // be caught by the loop-prevention guard.
  for (const variant of [
    "AI-DISPATCH",
    "ai-dispatch",
    "Ai-Dispatch",
    " AI-DISPATCH ",
    "ai-DISPATCH",
    "\tAI-DISPATCH",
  ]) {
    assert.equal(
      isAiDispatchUnit(variant),
      true,
      `variant ${JSON.stringify(variant)} must be recognised as the AI dispatcher`,
    );
  }
});

test("isAiDispatchUnit: returns false for empty / whitespace / null / undefined (no false positives)", () => {
  // The loop-prevention guard must NOT short-circuit on a malformed unit
  // ID — that would silently skip a real unit's transmission.
  assert.equal(isAiDispatchUnit(""), false);
  assert.equal(isAiDispatchUnit("   "), false);
  assert.equal(isAiDispatchUnit("\t\n"), false);
  assert.equal(isAiDispatchUnit(null), false);
  assert.equal(isAiDispatchUnit(undefined), false);
});

test("isAiDispatchUnit: returns false for any real-unit-shaped ID", () => {
  // Realistic unit-ID shapes from across the fleet — none must collide
  // with the AI dispatcher ID. The substring-ish check ("AI-DISPATCH-7"
  // contains "AI-DISPATCH") would be a real regression risk if a future
  // refactor switched the comparison from === to startsWith / includes.
  for (const real of [
    "U-1",
    "U-200",
    "PATROL-1",
    "DISPATCH-1",
    "AI",
    "AI-DISPATCH-7", // critical: substring-ish match must NOT trip true
    "AI-DISPATCHER",
    "DISP",
    "DISPATCH-AI",
  ]) {
    assert.equal(
      isAiDispatchUnit(real),
      false,
      `real unit ID ${JSON.stringify(real)} must not be flagged as the AI dispatcher`,
    );
  }
});

test("isAiDispatchUnit: comparison is exact-after-canonicalisation (not substring or prefix)", () => {
  // Pin the exact-match contract loudly — the engine bails on a true
  // here and would otherwise skip a transmission. A regression that
  // looked for `.includes("AI-DISPATCH")` would silently drop every
  // unit whose name contains the substring.
  assert.equal(isAiDispatchUnit("AI-DISPATCH-7"), false);
  assert.equal(isAiDispatchUnit("AI-DISPATCH "), true, "trailing space is trimmed → canonical match");
  assert.equal(isAiDispatchUnit("AI-DISPATCH-X"), false);
  assert.equal(isAiDispatchUnit("XAI-DISPATCH"), false);
});
