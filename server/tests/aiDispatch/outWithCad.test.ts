/**
 * Tests for `server/src/aiDispatch/outWithCad.ts`.
 *
 * The "out-with" rules decide whether an officer's transmission becomes a NEW
 * 10-8 CAD incident (self-dispatch) or just a comment posted on the call the
 * officer is already assigned to. A regression here either:
 *   - duplicates calls (officer goes "out with white sedan" while already on a
 *     961 → applyOutWithCadRules wrongly creates a second 961), or
 *   - silently swallows new self-dispatches (officer goes "out with juvenile"
 *     with no active call → engine creates no incident at all).
 *
 * Both failure modes are visible to dispatchers and field officers, so this is
 * one of the highest blast-radius pure-function modules in the AI dispatcher.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyOutWithCadRules,
  buildOutWithCommentText,
  extractOutWithTail,
  inferOutWithCallCode,
  isOutWithTransmission,
  unitHasActiveAssignedCall,
} from "../../src/aiDispatch/outWithCad.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

function parseResult(over: Partial<AiDispatchParseResult> = {}): AiDispatchParseResult {
  return {
    actionable: false,
    intent: "unknown",
    unit: null,
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

function activeCall(over: { call_id?: string; payload?: unknown } = {}) {
  return {
    call_id: over.call_id ?? "C-1001",
    payload: over.payload ?? {
      incident: {
        callID: "C-1001",
        units: [{ unit: "352" }],
      },
    },
  };
}

// -------------------- isOutWithTransmission --------------------

test("isOutWithTransmission matches the canonical 'out with' phrasings", () => {
  assert.equal(isOutWithTransmission("352 out with a white sedan"), true);
  assert.equal(isOutwithCase("I'll be out with a juvenile"), true);
  assert.equal(isOutwithCase("will be out with the RP"), true);
  assert.equal(isOutwithCase("I am out with male juvenile"), true);
  assert.equal(isOutwithCase("352 OW one female"), true);
  assert.equal(isOutWithTransmission("352 out w/ white sedan"), true);
});

function isOutwithCase(s: string): boolean {
  return isOutWithTransmission(s);
}

test("isOutWithTransmission rejects unrelated traffic that mentions 'out'", () => {
  assert.equal(isOutWithTransmission("352 out at 18-06"), false);
  assert.equal(isOutWithTransmission("352 going out for lunch"), false);
  assert.equal(isOutWithTransmission(""), false);
});

// -------------------- extractOutWithTail --------------------

test("extractOutWithTail returns the text after the trigger phrase", () => {
  assert.equal(
    extractOutWithTail("352 out with white Toyota Camry"),
    "white Toyota Camry",
  );
  assert.equal(
    extractOutWithTail("I'll be out with one female juvenile."),
    "one female juvenile",
  );
  assert.equal(
    extractOutWithTail("352 out w/ subject"),
    "subject",
  );
});

test("extractOutWithTail returns null when the phrase isn't present", () => {
  assert.equal(extractOutWithTail("352 in service"), null);
  assert.equal(extractOutWithTail(""), null);
});

// -------------------- buildOutWithCommentText --------------------

test("buildOutWithCommentText canonicalizes to ALL CAPS 'OUT W/' shorthand", () => {
  assert.equal(
    buildOutWithCommentText("white Toyota Camry plate 8VWV621"),
    "OUT W/ WHITE TOYOTA CAMRY PLATE 8VWV621",
  );
  assert.equal(
    buildOutWithCommentText("subject with backpack"),
    "OUT W/ SUBJECT W/ BACKPACK",
  );
});

test("buildOutWithCommentText defaults to bare 'OUT W/' when tail is empty", () => {
  assert.equal(buildOutWithCommentText(""), "OUT W/");
});

test("buildOutWithCommentText accepts a full transcript and pulls the tail itself", () => {
  // When you pass the whole transmission, it locates "out with" and uses what
  // follows. If the trigger isn't found, it just upper-cases the input.
  assert.equal(
    buildOutWithCommentText("352 out with male juvenile blue hoodie"),
    "OUT W/ MALE JUVENILE BLUE HOODIE",
  );
});

test("buildOutWithCommentText caps the comment at 240 chars", () => {
  const long = "white sedan ".repeat(50); // 600 chars
  const out = buildOutWithCommentText(long);
  assert.ok(out.length <= 240, `expected ≤240 chars, got ${out.length}`);
  assert.ok(out.startsWith("OUT W/"), "should still start with the OUT W/ prefix");
});

// -------------------- inferOutWithCallCode --------------------

test("inferOutWithCallCode returns '961' for a vehicle description", () => {
  assert.equal(inferOutWithCallCode("white Toyota Camry plate 8VWV621", false), "961");
  assert.equal(inferOutWithCallCode("a vehicle", false), "961");
  assert.equal(inferOutWithCallCode("blue Honda Civic", false), "961");
});

test("inferOutWithCallCode returns 'ped' for a person description", () => {
  assert.equal(inferOutWithCallCode("male juvenile", false), "ped");
  assert.equal(inferOutWithCallCode("one female", false), "ped");
  assert.equal(inferOutWithCallCode("two subjects", false), "ped");
  // The leading-number heuristic also fires.
  assert.equal(inferOutWithCallCode("3 transients", false), "ped");
});

test("inferOutWithCallCode prefers '586' (illegal parking) when called out", () => {
  assert.equal(inferOutWithCallCode("586 white sedan", false), "586");
  assert.equal(inferOutWithCallCode("vehicle parked illegally", false), "586");
  assert.equal(
    inferOutWithCallCode("illegally parked Toyota in red zone", false),
    "586",
  );
});

test("inferOutWithCallCode declines to guess when only an on-call party word is present", () => {
  // hasActiveCall=true + "the RP" → return null (don't fabricate a new call code).
  assert.equal(inferOutWithCallCode("the RP", true), null);
  assert.equal(inferOutWithCallCode("property manager", true), null);
});

test("inferOutWithCallCode treats an on-call party word with no active call as a ped stop", () => {
  // hasActiveCall=false + "the RP" → ped (not creating a new vehicle stop).
  assert.equal(inferOutWithCallCode("the RP", false), "ped");
  assert.equal(inferOutWithCallCode("manager", false), "ped");
});

test("inferOutWithCallCode returns null when the tail is empty", () => {
  assert.equal(inferOutWithCallCode("", false), null);
  assert.equal(inferOutWithCallCode("   ", false), null);
});

// -------------------- unitHasActiveAssignedCall --------------------

test("unitHasActiveAssignedCall finds the unit on a stored incident payload", () => {
  const active = [activeCall({ payload: { incident: { units: [{ unit: "352" }] } } })];
  assert.equal(unitHasActiveAssignedCall(active, "352"), true);
});

test("unitHasActiveAssignedCall normalizes the 27- prefix on both sides", () => {
  // Stored as "352", queried as "27-352" — the engine must still find it.
  const active = [activeCall({ payload: { incident: { units: [{ unit: "352" }] } } })];
  assert.equal(unitHasActiveAssignedCall(active, "27-352"), true);

  // Stored as "27-352", queried as "352" — still a match.
  const active2 = [activeCall({ payload: { incident: { units: [{ unit: "27-352" }] } } })];
  assert.equal(unitHasActiveAssignedCall(active2, "352"), true);
});

test("unitHasActiveAssignedCall returns false when the unit isn't on any open call", () => {
  const active = [activeCall({ payload: { incident: { units: [{ unit: "100" }] } } })];
  assert.equal(unitHasActiveAssignedCall(active, "352"), false);
  assert.equal(unitHasActiveAssignedCall([], "352"), false);
  assert.equal(unitHasActiveAssignedCall(active, ""), false);
});

// -------------------- applyOutWithCadRules --------------------

test("applyOutWithCadRules: officer ON a call → coerce to on_scene + comment_only", () => {
  const parsed = parseResult({
    actionable: false,
    intent: "status_change",
    unit: "352",
    summary: "352 out with a male juvenile.",
  });
  const active = [activeCall({ call_id: "C-9001" })];
  const next = applyOutWithCadRules(parsed, "352 out with male juvenile", active, "352");
  assert.equal(next.intent, "on_scene");
  assert.equal(next.actionable, true);
  assert.equal(next.comment_text, "OUT W/ MALE JUVENILE");
  assert.match(next.recommended_action ?? "", /do not create a new incident/i);
  assert.match(next.recommended_action ?? "", /C-9001/);
  // Should always produce a default voice ack when none is set.
  assert.match(next.dispatcher_response ?? "", /352, logged on your call/i);
});

test("applyOutWithCadRules: officer ON a call rewrites a 'dispatch' summary so it doesn't trigger create-incident", () => {
  const parsed = parseResult({
    intent: "dispatch", // model wrongly thought this was a self-dispatch
    unit: "352",
    summary: "352 stopping a vehicle.",
  });
  const active = [activeCall()];
  const next = applyOutWithCadRules(parsed, "352 out with white sedan", active, "352");
  assert.equal(next.intent, "on_scene");
  assert.match(next.summary, /comment only/i);
});

test("applyOutWithCadRules: officer NOT on a call → coerce to dispatch + infer call type", () => {
  const parsed = parseResult({ intent: "status_change", unit: "352" });
  const next = applyOutWithCadRules(
    parsed,
    "352 out with white Toyota Camry",
    [], // no active calls assigned to this unit
    "352",
  );
  assert.equal(next.intent, "dispatch");
  assert.equal(next.actionable, true);
  assert.equal(next.code, "961"); // vehicle description → 961
  assert.equal(next.comment_text, "OUT W/ WHITE TOYOTA CAMRY");
  assert.match(next.recommended_action ?? "", /Create new 961 call/);
});

test("applyOutWithCadRules: NOT on a call, person description → infers ped", () => {
  const parsed = parseResult({ intent: "status_change", unit: "352" });
  const next = applyOutWithCadRules(parsed, "352 out with one female juvenile", [], "352");
  assert.equal(next.intent, "dispatch");
  assert.equal(next.code, "ped");
});

test("applyOutWithCadRules: NOT on a call, ambiguous tail keeps the parsed code (lower-cased)", () => {
  // No vehicle/ped/parking words → the rules fall back to whatever the LLM
  // already provided in `code`. We force-lowercase it to match downstream
  // expectations.
  const parsed = parseResult({ intent: "status_change", unit: "352", code: "415" });
  const next = applyOutWithCadRules(parsed, "352 out with the situation", [], "352");
  assert.equal(next.intent, "dispatch");
  assert.equal(next.code, "415");
});

test("applyOutWithCadRules: leaves the parse alone for skip intents (clear/emergency/plate/info)", () => {
  for (const intent of [
    "clear",
    "emergency",
    "emergency_clear",
    "plate_request",
    "plate_transmit",
    "request_info",
    "info_request_912",
    "info_clear_913",
  ] as const) {
    const parsed = parseResult({ intent, unit: "352" });
    const next = applyOutWithCadRules(parsed, "352 out with white sedan", [], "352");
    // Same object back, untouched.
    assert.equal(next, parsed, `intent=${intent} should be a no-op`);
  }
});

test("applyOutWithCadRules: passes parses with no out-with phrase straight through", () => {
  const parsed = parseResult({ intent: "status_change", unit: "352" });
  const next = applyOutWithCadRules(parsed, "352 in service", [], "352");
  assert.equal(next, parsed);
});

test("applyOutWithCadRules: preserves an explicit comment_text from the LLM", () => {
  const parsed = parseResult({
    intent: "status_change",
    unit: "352",
    comment_text: "OUT W/ WMA BLUE HOODIE BACKPACK",
  });
  const next = applyOutWithCadRules(parsed, "352 out with male blue hoodie", [], "352");
  // The model already picked the cop-shorthand; rules should not overwrite it.
  assert.equal(next.comment_text, "OUT W/ WMA BLUE HOODIE BACKPACK");
});
