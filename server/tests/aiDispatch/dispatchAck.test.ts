/**
 * Tests for `buildDeterministicDispatchAck` in `server/src/aiDispatch/dispatchAck.ts`.
 *
 * The deterministic ack is what the dispatcher actually says on the air for a
 * dispatch / on-scene event when the LLM returned no usable scripted reply.
 * It's the audio every officer hears, so a regression here causes wrong unit
 * numbers, missing call codes, or pure silence on the channel.
 *
 * Key invariants this file locks down:
 *   - Patrol callsigns (27-100..27-999) are read back without the 27- prefix.
 *   - Command staff (27-001..27-099) keep the prefix on air.
 *   - location_code is spoken in dash form (1806 → "18-06"), not as raw digits.
 *   - 'on_scene' transmissions with an "OUT W/" comment go to the
 *     "logged on your call" phrasing instead of the location-based ack.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicDispatchAck } from "../../src/aiDispatch/dispatchAck.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

function parseResult(over: Partial<AiDispatchParseResult> = {}): AiDispatchParseResult {
  return {
    actionable: true,
    intent: "dispatch",
    unit: "352",
    summary: "test",
    confidence: 0.9,
    dispatcher_response: null,
    trigger_emergency_tone: false,
    recommended_action: null,
    plate_request: null,
    code: null,
    location_code: null,
    location_name: null,
    info_request: null,
    comment_text: null,
    ...over,
  };
}

test("buildDeterministicDispatchAck returns null for intents that aren't dispatch/on_scene", () => {
  for (const intent of ["status_change", "clear", "request_info", "chitchat", "unknown"] as const) {
    const out = buildDeterministicDispatchAck(parseResult({ intent }));
    assert.equal(out, null, `intent=${intent} should be null`);
  }
});

test("buildDeterministicDispatchAck returns null when there is no unit on either parse or override", () => {
  const out = buildDeterministicDispatchAck(parseResult({ unit: null }));
  assert.equal(out, null);
});

test("buildDeterministicDispatchAck drops the 27- prefix on patrol unit (100..999)", () => {
  const out = buildDeterministicDispatchAck(
    parseResult({ unit: "27-352", code: "961", location_code: "1806" }),
  );
  // Patrol → "352", location_code spoken in dash form.
  assert.equal(out, "Copy 352, 961 at 18-06.");
});

test("buildDeterministicDispatchAck KEEPS the 27- prefix only for the dispatcher-side band 27-0[0-3]0", () => {
  // The dispatchAck regex is intentionally narrow — only 27-000, 27-010,
  // 27-020, and 27-030 keep the prefix on air. Other 27-0XX callsigns drop
  // it just like patrol units do.
  for (const u of ["27-000", "27-010", "27-020", "27-030"]) {
    const out = buildDeterministicDispatchAck(parseResult({ unit: u, code: "961" }));
    assert.equal(out, `Copy ${u}, 961.`, `${u} should stay full-prefix`);
  }
  for (const u of ["27-040", "27-099"]) {
    const out = buildDeterministicDispatchAck(parseResult({ unit: u, code: "961" }));
    const tail = u.replace(/^27-/, "");
    assert.equal(out, `Copy ${tail}, 961.`, `${u} should drop 27- prefix in dispatchAck`);
  }
});

test("buildDeterministicDispatchAck: dispatch with code 'ped' uses 'pedestrian stop' phrasing", () => {
  // No location.
  const noLoc = buildDeterministicDispatchAck(
    parseResult({ unit: "352", code: "ped" }),
  );
  assert.equal(noLoc, "Copy 352, pedestrian stop.");

  // With location_code spoken as dash form.
  const withCode = buildDeterministicDispatchAck(
    parseResult({ unit: "352", code: "ped", location_code: "1806" }),
  );
  assert.equal(withCode, "Copy 352, pedestrian stop at 18-06.");

  // With a location_name (used verbatim).
  const withName = buildDeterministicDispatchAck(
    parseResult({ unit: "352", code: "ped", location_name: "Disney Way" }),
  );
  assert.equal(withName, "Copy 352, pedestrian stop at Disney Way.");
});

test("buildDeterministicDispatchAck prefers location_code over location_name when both are present", () => {
  const out = buildDeterministicDispatchAck(
    parseResult({
      unit: "352",
      code: "961",
      location_code: "1806",
      location_name: "Disney Way",
    }),
  );
  assert.equal(out, "Copy 352, 961 at 18-06.");
});

test("buildDeterministicDispatchAck dispatch with code only (no location)", () => {
  const out = buildDeterministicDispatchAck(
    parseResult({ unit: "27-352", code: "415" }),
  );
  assert.equal(out, "Copy 352, 415.");
});

test("buildDeterministicDispatchAck dispatch with location only (no code)", () => {
  const out = buildDeterministicDispatchAck(
    parseResult({ unit: "27-352", location_name: "Disney Way" }),
  );
  assert.equal(out, "Copy 352, at Disney Way.");
});

test("buildDeterministicDispatchAck dispatch with no code and no location is a bare ack", () => {
  const out = buildDeterministicDispatchAck(
    parseResult({ unit: "27-352" }),
  );
  assert.equal(out, "Copy 352.");
});

test("buildDeterministicDispatchAck on_scene without 'OUT W' uses the on-scene location ack", () => {
  const withLoc = buildDeterministicDispatchAck(
    parseResult({ intent: "on_scene", unit: "352", location_name: "Disney Way" }),
  );
  assert.equal(withLoc, "Copy 352, on scene at Disney Way.");

  const noLoc = buildDeterministicDispatchAck(
    parseResult({ intent: "on_scene", unit: "352" }),
  );
  assert.equal(noLoc, "Copy 352, on scene.");
});

test("buildDeterministicDispatchAck on_scene with 'OUT W/' comment switches to 'logged on your call'", () => {
  // This phrasing is what officers expect after an out-with: the dispatcher
  // is acknowledging a comment was logged, NOT broadcasting a new on-scene.
  const out = buildDeterministicDispatchAck(
    parseResult({
      intent: "on_scene",
      unit: "352",
      location_name: "Disney Way",
      comment_text: "OUT W/ WHITE SEDAN",
    }),
  );
  assert.equal(out, "Copy 352, logged on your call.");
});

test("buildDeterministicDispatchAck respects an explicit requestingUnit override over parsed.unit", () => {
  // Engine passes unitId from the transmission; this should win even if the
  // model parsed a different unit (mishearing).
  const out = buildDeterministicDispatchAck(
    parseResult({ unit: null, code: "961" }),
    "27-352",
  );
  assert.equal(out, "Copy 352, 961.");
});
