/**
 * Tests for `buildUnitStatusResponse` — the pure helper extracted from the
 * `case "unit_status":` branch of `buildInfoRequestResponse`.
 *
 * The unit_status info_request type was added in PR 2ad66ee to answer
 * questions like:
 *
 *   - "352, is 27-020 10-8?"
 *   - "is X on the air?"
 *   - "is X available?"
 *   - "what's X's status?"
 *
 * Before the PR, those questions were misrouted into `active_calls_for_unit`
 * and the dispatcher faithfully spoke "352, no active calls assigned at
 * this time." — wrong on its face, because the question is about service
 * status, not the call assignment. The new branch instead infers status
 * from a 4-step cascade:
 *
 *   1. On an open call (assigned to an active 10-8 incident)
 *        → "X is currently on [code] at [loc]"
 *   2. Otherwise: fresh GPS/presence (≤10 min)
 *        → "X shows 10-8"
 *   3. Otherwise: stale-but-recent GPS/presence (≤60 min)
 *        → "X last checked in N minutes ago in service"
 *   4. Otherwise: no recent activity, or unparseable timestamp, or unit
 *      not on the map at all
 *        → either "negative, no recent activity from X — last status
 *          unknown" (no/unparseable position) or "… last check-in was
 *          over an hour ago" (stale-stale position).
 *
 * This cascade is the entire user-visible behaviour of the feature and
 * has no test coverage today; a regression in any branch (e.g. flipping
 * the 10-min / 60-min thresholds, picking the wrong spoken callsign
 * format, or speaking the wrong "no recent activity" sentence) would
 * ship silently.
 *
 * The helper takes `nowMs` as a parameter so age-bucket assertions are
 * deterministic without monkey-patching `Date.now()`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildUnitStatusResponse,
  type UnitStatusActiveIncident,
  type UnitStatusPosition,
} from "../../src/aiDispatch/infoRequest.js";

const NOW = Date.UTC(2026, 4, 26, 18, 0, 0); // fixed reference instant

function isoMinAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}

function makeActive(
  unit: string,
  over: Partial<UnitStatusActiveIncident> = {},
): UnitStatusActiveIncident {
  return {
    incident_type: "415 - Disturbing the Peace",
    location: "1234 W Harbor Blvd, Anaheim, CA 92805",
    payload: { action: "open", incident: { units: [{ unit }] } },
    ...over,
  };
}

function makePos(unit: string, ageMin: number): UnitStatusPosition {
  return { unit_id: unit, updated_at: isoMinAgo(ageMin) };
}

// ---------- Branch 1: assigned to an open call ---------------------------

test("buildUnitStatusResponse: assigned to an open call speaks 'X is currently on [code] at [loc]'", () => {
  const active = [makeActive("352")];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  // "040, " prefix from requesting unit, "352" spoken without 27- prefix,
  // "415" extracted from the "415 - Disturbing the Peace" call type, and
  // the location trimmed to street + city (no state/zip).
  assert.equal(out, "040, 352 is currently on 415 at 1234 W Harbor Blvd, Anaheim.");
});

test("buildUnitStatusResponse: assigned call with blank location omits the 'at …' tail", () => {
  // A real bug surface: if the active incident has no location yet (just
  // created, no address resolved), we must NOT speak "at unknown" or "at
  // ." — the helper must drop the location clause entirely.
  const active = [makeActive("352", { location: null })];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  assert.equal(out, "040, 352 is currently on 415.");
});

test("buildUnitStatusResponse: assigned call with whitespace-only location omits the 'at …' tail", () => {
  const active = [makeActive("352", { location: "   " })];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  assert.equal(out, "040, 352 is currently on 415.");
});

test("buildUnitStatusResponse: assigned-call match uses incidentPayloadHasUnit normalization (27-XXX vs XXX)", () => {
  // CAD payload stores '27-040', officer asks about '040' — must match.
  const active = [makeActive("27-040")];
  const out = buildUnitStatusResponse(active, [], "040", "352", NOW);
  assert.equal(out, "352, 040 is currently on 415 at 1234 W Harbor Blvd, Anaheim.");
});

test("buildUnitStatusResponse: assigned-call branch wins over a fresh GPS position", () => {
  // If a unit is BOTH on an active call AND showing fresh GPS, the
  // assigned-call answer must win — speaking "shows 10-8" while the unit
  // is on a verified open call would be wrong.
  const active = [makeActive("352")];
  const positions = [makePos("352", 1)]; // 1 min — would otherwise be "shows 10-8"
  const out = buildUnitStatusResponse(active, positions, "352", "27-040", NOW);
  assert.match(out, /is currently on 415 at /);
  assert.doesNotMatch(out, /shows 10-8/);
});

test("buildUnitStatusResponse: a different unit's active call does not satisfy the target", () => {
  const active = [makeActive("999")]; // 999 is on a call, 352 is not
  const positions: UnitStatusPosition[] = [];
  const out = buildUnitStatusResponse(active, positions, "352", "27-040", NOW);
  assert.equal(
    out,
    "040, negative, no recent activity from 352 — last status unknown.",
  );
});

// ---------- Branch 2: fresh GPS (≤10 min) ---------------------------------

test("buildUnitStatusResponse: fresh GPS (now) → 'X shows 10-8'", () => {
  const out = buildUnitStatusResponse([], [makePos("352", 0)], "352", "27-040", NOW);
  assert.equal(out, "040, 352 shows 10-8.");
});

test("buildUnitStatusResponse: fresh GPS at the 10-min boundary still reports 10-8", () => {
  // The documented threshold is "≤ 10 min". Exactly 10 min must still
  // count as fresh — anything stricter (≤ 9 min) would surprise an
  // officer who just checked in at 10:00 and is now asked about a few
  // seconds later.
  const out = buildUnitStatusResponse([], [makePos("352", 10)], "352", "27-040", NOW);
  assert.equal(out, "040, 352 shows 10-8.");
});

test("buildUnitStatusResponse: 11 min crosses the fresh→stale boundary", () => {
  // Tightens the boundary from the other side: 11 min is no longer
  // "shows 10-8" — it's the stale-but-recent branch.
  const out = buildUnitStatusResponse([], [makePos("352", 11)], "352", "27-040", NOW);
  assert.equal(out, "040, 352 last checked in 11 minutes ago in service.");
});

test("buildUnitStatusResponse: fresh GPS uses findRadioMapPosition normalization (suffix match)", () => {
  // Map stores '27-2040', officer asks about '40'. The shared
  // findRadioMapPosition helper's endsWith fall-through must apply here
  // too, otherwise the unit_status branch would speak "negative, not on
  // the map" for any unit reported with a different prefix.
  const out = buildUnitStatusResponse([], [makePos("27-2040", 0)], "40", "27-040", NOW);
  assert.match(out, /shows 10-8/);
});

// ---------- Branch 3: stale-but-recent GPS (11–60 min) --------------------

test("buildUnitStatusResponse: 30 min ago → 'last checked in 30 minutes ago in service'", () => {
  const out = buildUnitStatusResponse([], [makePos("352", 30)], "352", "27-040", NOW);
  assert.equal(out, "040, 352 last checked in 30 minutes ago in service.");
});

test("buildUnitStatusResponse: 60 min ago still falls in the stale-but-recent branch", () => {
  // The documented "≤60 min" upper bound — exactly 60 min must still be
  // reported as a minute count, not as "over an hour ago".
  const out = buildUnitStatusResponse([], [makePos("352", 60)], "352", "27-040", NOW);
  assert.equal(out, "040, 352 last checked in 60 minutes ago in service.");
});

test("buildUnitStatusResponse: age is rounded to the nearest minute", () => {
  // `Math.round((nowMs - lastSeenMs) / 60_000)` — 29 min 25 s rounds to 29,
  // 29 min 35 s rounds to 30. Pin both sides of the half-minute boundary
  // so a future change to floor/ceil is caught.
  const pos29 = { unit_id: "352", updated_at: new Date(NOW - 29 * 60_000 - 25_000).toISOString() };
  const pos30 = { unit_id: "352", updated_at: new Date(NOW - 29 * 60_000 - 35_000).toISOString() };
  assert.match(
    buildUnitStatusResponse([], [pos29], "352", "27-040", NOW),
    /last checked in 29 minutes ago/,
  );
  assert.match(
    buildUnitStatusResponse([], [pos30], "352", "27-040", NOW),
    /last checked in 30 minutes ago/,
  );
});

// ---------- Branch 4a: very stale (> 60 min) ------------------------------

test("buildUnitStatusResponse: 61 min ago → 'over an hour ago'", () => {
  const out = buildUnitStatusResponse([], [makePos("352", 61)], "352", "27-040", NOW);
  assert.equal(
    out,
    "040, negative, no recent activity from 352 — last check-in was over an hour ago.",
  );
});

test("buildUnitStatusResponse: many hours ago → still 'over an hour ago' (no day-count drift)", () => {
  const out = buildUnitStatusResponse([], [makePos("352", 24 * 60)], "352", "27-040", NOW);
  assert.match(out, /last check-in was over an hour ago\.$/);
});

// ---------- Branch 4b: no map entry / unparseable timestamp ---------------

test("buildUnitStatusResponse: target not on the map → 'last status unknown'", () => {
  const out = buildUnitStatusResponse([], [], "352", "27-040", NOW);
  assert.equal(
    out,
    "040, negative, no recent activity from 352 — last status unknown.",
  );
});

test("buildUnitStatusResponse: unparseable updated_at → 'last status unknown' (NOT 'over an hour ago')", () => {
  // Important contract: a bogus / NaN timestamp must NOT silently fall
  // through into the ageMin branches with `lastSeenMs = NaN`, because
  // `Math.round((nowMs - NaN) / 60_000)` is NaN and the subsequent
  // `<= 10` / `<= 60` comparisons are false, which would land on the
  // "over an hour ago" sentence and be misleading. The helper has an
  // explicit early-out that we lock here.
  const positions: UnitStatusPosition[] = [
    { unit_id: "352", updated_at: "not-a-date" },
  ];
  const out = buildUnitStatusResponse([], positions, "352", "27-040", NOW);
  assert.equal(
    out,
    "040, negative, no recent activity from 352 — last status unknown.",
  );
});

test("buildUnitStatusResponse: future timestamps clamp to age 0 (clock-skew tolerance)", () => {
  // If a handset's clock is slightly ahead of the server, lastSeenMs >
  // nowMs and the naive subtraction would produce a negative age. The
  // helper clamps with Math.max(0, …) so the unit shows up as fresh
  // 10-8 rather than as "-2 minutes ago in service" or "over an hour
  // ago" via NaN handling.
  const future = { unit_id: "352", updated_at: new Date(NOW + 5 * 60_000).toISOString() };
  const out = buildUnitStatusResponse([], [future], "352", "27-040", NOW);
  assert.equal(out, "040, 352 shows 10-8.");
});

// ---------- Spoken-callsign rules ----------------------------------------

test("buildUnitStatusResponse: 27-0[0-3]0 command-staff keep the 27- prefix in the spoken target", () => {
  // 27-010 / 27-020 / 27-030 are command staff; their spoken callsigns
  // KEEP the 27- prefix on the air. Every other 27-XYZ drops it.
  for (const cs of ["27-010", "27-020", "27-030"]) {
    const out = buildUnitStatusResponse([], [makePos(cs, 0)], cs, "352", NOW);
    assert.equal(out, `352, ${cs} shows 10-8.`);
  }
});

test("buildUnitStatusResponse: 27-040 patrol drops the 27- prefix in the spoken target", () => {
  const out = buildUnitStatusResponse([], [makePos("27-040", 0)], "27-040", "352", NOW);
  assert.equal(out, "352, 040 shows 10-8.");
});

test("buildUnitStatusResponse: requesting 27-020 keeps its prefix in the leading callsign", () => {
  // The requesting-unit prefix follows the same rule as the spoken target.
  const out = buildUnitStatusResponse([], [makePos("352", 0)], "352", "27-020", NOW);
  assert.equal(out, "27-020, 352 shows 10-8.");
});

test("buildUnitStatusResponse: null / undefined requestingUnit produces no leading callsign", () => {
  // Trains-of-thought from the test page or replay paths can lack a
  // requesting unit. The helper must drop the "X, " prefix entirely
  // rather than speak "null, " or " , ".
  assert.equal(
    buildUnitStatusResponse([], [makePos("352", 0)], "352", null, NOW),
    "352 shows 10-8.",
  );
  assert.equal(
    buildUnitStatusResponse([], [makePos("352", 0)], "352", undefined, NOW),
    "352 shows 10-8.",
  );
});

// ---------- callCodeForRadio handling -----------------------------------

test("buildUnitStatusResponse: assigned-call code falls back to 'call' for blank incident_type", () => {
  const active = [makeActive("352", { incident_type: null })];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  // "blank/null incident_type" → speak "call" rather than e.g. "null".
  assert.match(out, /is currently on call at /);
});

test("buildUnitStatusResponse: assigned-call code reads as-is when no leading numeric prefix", () => {
  const active = [makeActive("352", { incident_type: "Issue Notice" })];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  assert.match(out, /is currently on Issue Notice at /);
});

test("buildUnitStatusResponse: assigned-call code strips state/zip/country tail from location", () => {
  const active = [
    makeActive("352", {
      location: "1234 W Harbor Blvd, Anaheim, CA 92805, USA",
    }),
  ];
  const out = buildUnitStatusResponse(active, [], "352", "27-040", NOW);
  // shortenLocationForRadio drops the CA 92805 + USA tail and keeps the
  // first two non-empty pieces.
  assert.equal(out, "040, 352 is currently on 415 at 1234 W Harbor Blvd, Anaheim.");
});
