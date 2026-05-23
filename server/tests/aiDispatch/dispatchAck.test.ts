/**
 * Tests for `server/src/aiDispatch/dispatchAck.ts`.
 *
 * `buildDeterministicDispatchAck` is what the AI engine speaks on the air to
 * acknowledge a dispatch / on-scene transmission. It deliberately OVERRIDES
 * the LLM's free-form dispatcher_response so the on-air wording matches the
 * structured `code` / `location_code` / `location_name` fields the system
 * dispatches against.
 *
 * Regressions here mean the AI confirms one thing on the air but enters
 * something different in CAD — officers stop trusting the readback.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicDispatchAck } from "../../src/aiDispatch/dispatchAck.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

function makeParsed(over: Partial<AiDispatchParseResult> = {}): AiDispatchParseResult {
  return {
    actionable: true,
    intent: "dispatch",
    unit: "27-040",
    summary: "",
    confidence: 0.9,
    dispatcher_response: "LLM RAW RESPONSE (must be overridden)",
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

// ---------- guard clauses ------------------------------------------------

test("buildDeterministicDispatchAck returns null for non-dispatch/on_scene intents", () => {
  for (const intent of [
    "clear",
    "emergency",
    "request_info",
    "plate_request",
    "chitchat",
    "unknown",
  ] as const) {
    assert.equal(buildDeterministicDispatchAck(makeParsed({ intent })), null, intent);
  }
});

test("buildDeterministicDispatchAck returns null when no unit can be resolved", () => {
  assert.equal(buildDeterministicDispatchAck(makeParsed({ unit: null })), null);
});

test("buildDeterministicDispatchAck prefers requestingUnit over parsed.unit", () => {
  const out = buildDeterministicDispatchAck(
    makeParsed({ unit: "27-040", code: "415" }),
    "27-352",
  );
  assert.equal(out, "Copy 352, 415.");
});

// ---------- callsign formatting -----------------------------------------

test("buildDeterministicDispatchAck: patrol callsign drops the 27- prefix", () => {
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ unit: "27-040", code: "415" })),
    "Copy 040, 415.",
  );
});

test("buildDeterministicDispatchAck: command-staff callsigns 27-0X0 KEEP the 27- prefix", () => {
  // 27-010, 27-020, 27-030 are SSA command staff and are addressed with the
  // full prefix on the air. A regression that lops the 27- here would put
  // command staff onto the patrol callsign convention.
  for (const cs of ["27-010", "27-020", "27-030"]) {
    const out = buildDeterministicDispatchAck(makeParsed({ unit: cs, code: "415" }));
    assert.equal(out, `Copy ${cs}, 415.`);
  }
});

// ---------- dispatch intent ---------------------------------------------

test("buildDeterministicDispatchAck: dispatch + code 'ped' speaks 'pedestrian stop' (not 'ped')", () => {
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ intent: "dispatch", code: "ped" })),
    "Copy 040, pedestrian stop.",
  );
});

test("buildDeterministicDispatchAck: dispatch + code 'ped' with location speaks 'pedestrian stop at ...'", () => {
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "dispatch", code: "ped", location_name: "Main and 1st" }),
    ),
    "Copy 040, pedestrian stop at Main and 1st.",
  );
});

test("buildDeterministicDispatchAck: dispatch + code '961' is spoken verbatim (not 'car stop')", () => {
  // The radio convention is to call it "961", not "car stop", on the
  // acknowledgment line. Locks in the existing convention.
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ intent: "dispatch", code: "961" })),
    "Copy 040, 961.",
  );
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "dispatch", code: "961", location_name: "the Marriott" }),
    ),
    "Copy 040, 961 at the Marriott.",
  );
});

test("buildDeterministicDispatchAck: dispatch + generic code + location_name", () => {
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "dispatch", code: "415", location_name: "1805 Main St" }),
    ),
    "Copy 040, 415 at 1805 Main St.",
  );
});

test("buildDeterministicDispatchAck: dispatch + code only (no location)", () => {
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ intent: "dispatch", code: "415" })),
    "Copy 040, 415.",
  );
});

test("buildDeterministicDispatchAck: dispatch + location_name only (no code)", () => {
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "dispatch", code: null, location_name: "the gate" }),
    ),
    "Copy 040, at the gate.",
  );
});

test("buildDeterministicDispatchAck: dispatch + nothing structured falls back to 'Copy <cs>.'", () => {
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ intent: "dispatch", code: null })),
    "Copy 040.",
  );
});

// ---------- account code location speech --------------------------------

test("buildDeterministicDispatchAck: location_code '1805' is spoken as the dash form '18-05'", () => {
  // SSA properties are always read on the air in two-digit dash form.
  // Compare on the literal output to lock in the speech format.
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "dispatch", code: "415", location_code: "1805" }),
    ),
    "Copy 040, 415 at 18-05.",
  );
});

test("buildDeterministicDispatchAck: location_code takes precedence over location_name", () => {
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({
        intent: "dispatch",
        code: "415",
        location_code: "3208",
        location_name: "should-not-be-spoken",
      }),
    ),
    "Copy 040, 415 at 32-08.",
  );
});

// ---------- on_scene intent ---------------------------------------------

test("buildDeterministicDispatchAck: on_scene with location speaks 'on scene at <loc>'", () => {
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({ intent: "on_scene", location_name: "1805 Main" }),
    ),
    "Copy 040, on scene at 1805 Main.",
  );
});

test("buildDeterministicDispatchAck: on_scene without location falls back to 'on scene'", () => {
  assert.equal(
    buildDeterministicDispatchAck(makeParsed({ intent: "on_scene" })),
    "Copy 040, on scene.",
  );
});

test("buildDeterministicDispatchAck: on_scene + OUT W/ comment swaps to 'logged on your call' (out-with marker wins)", () => {
  // This is the bridge between applyOutWithCadRules() and the on-air ack: if
  // the comment is an OUT W/ ..., the spoken line must be the OUT W/
  // acknowledgment, not 'on scene at ...'. Locks in the contract that
  // out-with comments win over location wording on the speech side.
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({
        intent: "on_scene",
        comment_text: "OUT W/ THE RP",
        location_name: "1805 Main",
      }),
    ),
    "Copy 040, logged on your call.",
  );
});

test("buildDeterministicDispatchAck: on_scene + non-OUT-W comment is NOT treated as out-with", () => {
  // A plain on-scene with a comment that doesn't start OUT W/ should still
  // get the 'on scene at ...' line. Lock that in so we don't false-trigger
  // 'logged on your call' for arbitrary on-scene comments.
  assert.equal(
    buildDeterministicDispatchAck(
      makeParsed({
        intent: "on_scene",
        comment_text: "STATEMENT TAKEN",
        location_name: "1805 Main",
      }),
    ),
    "Copy 040, on scene at 1805 Main.",
  );
});
