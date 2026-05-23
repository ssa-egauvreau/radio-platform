/**
 * Tests for `server/src/ten8/cadComments.ts`.
 *
 * These three helpers gate every 10-8 CAD comment the AI dispatcher posts.
 * Critically, `isVerifiedOpenCallId` is the safety net that prevents the
 * engine from posting a comment to a guessed/made-up call id — which can
 * cascade into 10-8 errors that crash the dispatcher's screen. A regression
 * here either drops legitimate comments or, worse, posts to the wrong call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractCallIdFromCreateResponse,
  formatTen8RadioComment,
  isVerifiedOpenCallId,
} from "../../src/ten8/cadComments.js";

// -------------------- formatTen8RadioComment --------------------

test("formatTen8RadioComment prefixes the callsign before the transcript", () => {
  assert.equal(
    formatTen8RadioComment("352", "961 at 18-06"),
    "352 961 at 18-06",
  );
});

test("formatTen8RadioComment trims whitespace on both sides", () => {
  assert.equal(
    formatTen8RadioComment("  352  ", "  961 at 18-06  "),
    "352 961 at 18-06",
  );
});

test("formatTen8RadioComment returns null when callsign or transcript is empty", () => {
  assert.equal(formatTen8RadioComment("", "anything"), null);
  assert.equal(formatTen8RadioComment("   ", "anything"), null);
  assert.equal(formatTen8RadioComment("352", ""), null);
  assert.equal(formatTen8RadioComment("352", "    "), null);
});

test("formatTen8RadioComment caps total length at 4000 chars (10-8 column limit)", () => {
  const long = "x".repeat(8000);
  const out = formatTen8RadioComment("352", long);
  assert.ok(out);
  assert.equal(out!.length, 4000);
  assert.ok(out!.startsWith("352 "));
});

// -------------------- isVerifiedOpenCallId --------------------

test("isVerifiedOpenCallId is false for empty / whitespace ids", () => {
  assert.equal(isVerifiedOpenCallId("", []), false);
  assert.equal(isVerifiedOpenCallId("   ", [{ call_id: "C-1" }]), false);
});

test("isVerifiedOpenCallId returns true only when the call appears in the open list", () => {
  const active = [{ call_id: "C-1001" }, { call_id: "C-1002" }, { call_id: "C-1003" }];
  assert.equal(isVerifiedOpenCallId("C-1002", active), true);
  // Whitespace tolerant on the input side and on the row side.
  assert.equal(isVerifiedOpenCallId("  C-1002  ", active), true);
  assert.equal(
    isVerifiedOpenCallId("C-1002", [{ call_id: "  C-1002  " }]),
    true,
  );
});

test("isVerifiedOpenCallId rejects ids not in the open list (case-sensitive)", () => {
  const active = [{ call_id: "C-1001" }];
  assert.equal(isVerifiedOpenCallId("C-9999", active), false);
  // No fuzzy / case folding — the compare is exact after trim.
  assert.equal(isVerifiedOpenCallId("c-1001", active), false);
});

// -------------------- extractCallIdFromCreateResponse --------------------

test("extractCallIdFromCreateResponse returns null on empty / null input", () => {
  assert.equal(extractCallIdFromCreateResponse(null), null);
  assert.equal(extractCallIdFromCreateResponse(undefined), null);
  assert.equal(extractCallIdFromCreateResponse(""), null);
  assert.equal(extractCallIdFromCreateResponse([]), null);
  assert.equal(extractCallIdFromCreateResponse({}), null);
});

test("extractCallIdFromCreateResponse pulls 'incident_id' from a single-object response", () => {
  assert.equal(
    extractCallIdFromCreateResponse({ incident_id: "C-2001" }),
    "C-2001",
  );
});

test("extractCallIdFromCreateResponse falls back through the candidate id keys", () => {
  // Order: incident_id, incidentId, id, callID, callId.
  assert.equal(
    extractCallIdFromCreateResponse({ incidentId: "C-1" }),
    "C-1",
  );
  assert.equal(extractCallIdFromCreateResponse({ id: "C-2" }), "C-2");
  assert.equal(extractCallIdFromCreateResponse({ callID: "C-3" }), "C-3");
  assert.equal(extractCallIdFromCreateResponse({ callId: "C-4" }), "C-4");

  // First non-blank wins.
  assert.equal(
    extractCallIdFromCreateResponse({
      incident_id: "  ",
      id: "C-2",
      callID: "C-3",
    }),
    "C-2",
  );
});

test("extractCallIdFromCreateResponse handles arrays of incident objects", () => {
  // 10-8's New Incident response is an array.
  const data = [{ incident_id: "C-2001", type: "961" }];
  assert.equal(extractCallIdFromCreateResponse(data), "C-2001");

  // Skip empties; pick the first object that has an id.
  const data2 = [{}, { random: "thing" }, { id: "C-5005" }];
  assert.equal(extractCallIdFromCreateResponse(data2), "C-5005");

  // Whitespace-only ids are not accepted.
  const data3 = [{ id: "   " }, { id: "C-7777" }];
  assert.equal(extractCallIdFromCreateResponse(data3), "C-7777");
});

test("extractCallIdFromCreateResponse unwraps a top-level { incidents: [...] } envelope", () => {
  const data = { incidents: [{ incident_id: "C-3003" }] };
  assert.equal(extractCallIdFromCreateResponse(data), "C-3003");
});

test("extractCallIdFromCreateResponse coerces non-string ids (numbers) to trimmed strings", () => {
  assert.equal(extractCallIdFromCreateResponse({ id: 12345 }), "12345");
});
