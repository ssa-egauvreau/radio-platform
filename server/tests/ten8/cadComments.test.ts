/**
 * Tests for `server/src/ten8/cadComments.ts`.
 *
 * These helpers gate every CAD comment we post back to 10-8 and how we extract
 * a call id from the New Incident API response. A regression here means:
 *
 *   - extractCallIdFromCreateResponse → wrong / no id → AI can never post the
 *     comment back to the right incident (orphaned radio log).
 *   - isVerifiedOpenCallId → false-positive → AI posts comments to a call id
 *     that no longer exists, false-negative → AI refuses to post a real
 *     comment.
 *   - formatTen8RadioComment → comment shape on the dispatcher's screen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractCallIdFromCreateResponse,
  formatTen8RadioComment,
  isVerifiedOpenCallId,
} from "../../src/ten8/cadComments.js";

// ---------- formatTen8RadioComment --------------------------------------

test("formatTen8RadioComment joins callsign and transcript with a single space", () => {
  assert.equal(
    formatTen8RadioComment("27-040", "I'll be out with the RP"),
    "27-040 I'll be out with the RP",
  );
});

test("formatTen8RadioComment trims input but keeps inner whitespace as-is", () => {
  assert.equal(
    formatTen8RadioComment("  27-040  ", "  on scene  "),
    "27-040 on scene",
  );
});

test("formatTen8RadioComment returns null when callsign or transcript is empty/whitespace", () => {
  assert.equal(formatTen8RadioComment("", "on scene"), null);
  assert.equal(formatTen8RadioComment("   ", "on scene"), null);
  assert.equal(formatTen8RadioComment("27-040", ""), null);
  assert.equal(formatTen8RadioComment("27-040", "   "), null);
});

test("formatTen8RadioComment caps comment at 4000 characters (10-8 CAD field cap)", () => {
  const long = "x".repeat(5000);
  const out = formatTen8RadioComment("27-040", long);
  assert.ok(out);
  assert.equal(out.length, 4000);
  assert.ok(out!.startsWith("27-040 xxxx"));
});

// ---------- isVerifiedOpenCallId ----------------------------------------

test("isVerifiedOpenCallId true only when id matches an active row exactly", () => {
  const active = [{ call_id: "ABC-001" }, { call_id: "XYZ-999" }];
  assert.equal(isVerifiedOpenCallId("ABC-001", active), true);
  assert.equal(isVerifiedOpenCallId("XYZ-999", active), true);
});

test("isVerifiedOpenCallId trims caller input and active entries", () => {
  const active = [{ call_id: "  ABC-001  " }];
  assert.equal(isVerifiedOpenCallId("  ABC-001  ", active), true);
});

test("isVerifiedOpenCallId is case-sensitive (10-8 call ids are case-sensitive)", () => {
  // 10-8 call ids are returned in a fixed casing. If we normalize case we may
  // collide two different incidents, so the contract is strict equality on
  // the trimmed string. Lock that contract in.
  const active = [{ call_id: "ABC-001" }];
  assert.equal(isVerifiedOpenCallId("abc-001", active), false);
});

test("isVerifiedOpenCallId false on empty id or empty list", () => {
  assert.equal(isVerifiedOpenCallId("", [{ call_id: "ABC-001" }]), false);
  assert.equal(isVerifiedOpenCallId("   ", [{ call_id: "ABC-001" }]), false);
  assert.equal(isVerifiedOpenCallId("ABC-001", []), false);
});

// ---------- extractCallIdFromCreateResponse -----------------------------

test("extractCallIdFromCreateResponse pulls incident_id from a single-object response", () => {
  assert.equal(
    extractCallIdFromCreateResponse({ incident_id: "C-1234" }),
    "C-1234",
  );
});

test("extractCallIdFromCreateResponse honors candidate priority: incident_id > incidentId > id > callID > callId", () => {
  // First non-empty wins. Locking the order so a future refactor doesn't
  // accidentally pick a stable internal `id` over the agency-facing
  // `incident_id`.
  assert.equal(
    extractCallIdFromCreateResponse({
      incident_id: "PRIMARY",
      incidentId: "SECONDARY",
      id: "TERTIARY",
      callId: "LAST",
    }),
    "PRIMARY",
  );
  assert.equal(
    extractCallIdFromCreateResponse({ incidentId: "PRIMARY", id: "BACKUP" }),
    "PRIMARY",
  );
  assert.equal(
    extractCallIdFromCreateResponse({ id: 12345 }),
    "12345",
    "numeric id is coerced to string",
  );
  assert.equal(
    extractCallIdFromCreateResponse({ callID: "CID-7" }),
    "CID-7",
  );
});

test("extractCallIdFromCreateResponse iterates an array and returns the first usable id", () => {
  const data = [{ no_id_here: true }, { incident_id: "C-1234" }, { incident_id: "C-9999" }];
  assert.equal(extractCallIdFromCreateResponse(data), "C-1234");
});

test("extractCallIdFromCreateResponse unwraps { incidents: [...] } wrapper", () => {
  assert.equal(
    extractCallIdFromCreateResponse({ incidents: [{ incident_id: "C-42" }] }),
    "C-42",
  );
});

test("extractCallIdFromCreateResponse returns null on missing / blank / wrong-shape input", () => {
  assert.equal(extractCallIdFromCreateResponse(null), null);
  assert.equal(extractCallIdFromCreateResponse(undefined), null);
  assert.equal(extractCallIdFromCreateResponse(""), null);
  assert.equal(extractCallIdFromCreateResponse(0), null);
  assert.equal(extractCallIdFromCreateResponse([]), null);
  assert.equal(extractCallIdFromCreateResponse([{ other: "field" }]), null);
  assert.equal(extractCallIdFromCreateResponse({ unrelated: "data" }), null);
  // Empty string in id must not count — that would post comments to "".
  assert.equal(extractCallIdFromCreateResponse({ incident_id: "" }), null);
  assert.equal(extractCallIdFromCreateResponse({ incident_id: "   " }), null);
});
