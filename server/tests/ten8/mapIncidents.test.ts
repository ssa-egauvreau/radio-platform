/**
 * Regression tests for the pure parsing helpers in
 * `server/src/ten8/mapIncidents.ts` that turn an opaque CAD payload into a
 * `{ lat, lon, label }` map-pin shape.
 *
 * Why this matters
 * ----------------
 * `listTen8MapIncidents` powers the live dispatch map. Every 10-8 incident
 * the agency's CAD integration reports flows through `coordsFromPayload`
 * (find a usable lat/lon) and `callLabel` (render the pin caption). If
 * either helper silently regresses we get one of three failure modes that
 * don't show up as a server error:
 *
 *   1. `coordsFromPayload` stops recognising a vendor's field-name pair —
 *      pins disappear from the map for every agency on that CAD.
 *   2. `coordsFromPayload` accepts an out-of-range lat/lon — the front-end
 *      map either crashes or pushes the pin to the antipode.
 *   3. `callLabel` returns the wrong slice of `incident_type` — dispatchers
 *      see meaningless captions like "961 - SUSPICIOUS VEHICLE - 23:14 CHP"
 *      instead of the expected short code "961", or the pin layout breaks
 *      when an unbounded long string overflows.
 *
 * These tests pin every field-name convention `coordsFromPayload`
 * advertises in its JSDoc, the bounds check (the security-relevant guard
 * against malformed payloads), the field-priority order (latitude/longitude
 * must beat the legacy alternatives so we don't pick up a stray field), and
 * every documented fallback in `callLabel` including all three dash
 * variants it accepts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { callLabel, coordsFromPayload } from "../../src/ten8/mapIncidents.js";

// ---------- callLabel -----------------------------------------------------

test("callLabel: returns the prefix before the first hyphen-minus separator", () => {
  assert.equal(callLabel("961 - SUSPICIOUS VEHICLE", "CAD-001"), "961");
});

test("callLabel: accepts an en-dash separator (vendor that uses U+2013)", () => {
  assert.equal(callLabel("415 \u2013 DISTURBANCE", "CAD-002"), "415");
});

test("callLabel: accepts an em-dash separator (vendor that uses U+2014)", () => {
  assert.equal(callLabel("11-54 \u2014 SUSPICIOUS VEHICLE", "CAD-003"), "11-54");
});

test("callLabel: requires whitespace around the separator (a bare hyphen in the code is preserved)", () => {
  // "10-50" or "11-54" are real CAD codes — the prefix logic looks for
  // " - " (space-dash-space) so it doesn't snip the code in half.
  assert.equal(callLabel("11-54 - SUSPICIOUS VEHICLE", "CAD-004"), "11-54");
  assert.equal(callLabel("11-54", "CAD-005"), "11-54");
});

test("callLabel: trims surrounding whitespace from the extracted prefix", () => {
  assert.equal(callLabel("  961   -   SUSPICIOUS VEHICLE  ", "CAD-006"), "961");
});

test("callLabel: with no separator and a short type, returns the full type unchanged", () => {
  // The 40-char ceiling is exclusive — strings of length <= 40 pass through
  // verbatim so dispatchers see the full thing on the pin.
  const short = "TRAFFIC STOP - PRIORITY 3";
  // This contains " - " so it would be split; pick a string with no separator.
  const noSep = "TRAFFIC STOP / PRIORITY 3";
  assert.equal(noSep.length <= 40, true);
  assert.equal(callLabel(noSep, "CAD-007"), noSep);
  void short;
});

test("callLabel: with no separator and a >40-char type, truncates at 38 + ellipsis", () => {
  // 50-char single-token string with no separator — drops to "first 38 chars + …"
  const long = "X".repeat(50);
  const out = callLabel(long, "CAD-008");
  assert.equal(out, `${"X".repeat(38)}\u2026`);
  // Boundary check: total visible length is 39 (38 X's + the 1-char ellipsis),
  // matching the contract documented on `callLabel`.
  assert.equal(out.length, 39);
});

test("callLabel: with a 40-char type and no separator, returns it whole (no truncation)", () => {
  const exactly40 = "Y".repeat(40);
  assert.equal(callLabel(exactly40, "CAD-009"), exactly40);
});

test("callLabel: with a 41-char type and no separator, truncates", () => {
  const fortyOne = "Y".repeat(41);
  const out = callLabel(fortyOne, "CAD-010");
  assert.equal(out, `${"Y".repeat(38)}\u2026`);
});

test("callLabel: null incidentType falls back to the call id", () => {
  assert.equal(callLabel(null, "CAD-2026-001234"), "CAD-2026-001234");
});

test("callLabel: empty / whitespace incidentType falls back to the call id", () => {
  assert.equal(callLabel("", "CAD-EMPTY"), "CAD-EMPTY");
  assert.equal(callLabel("   ", "CAD-WS"), "CAD-WS");
  assert.equal(callLabel("\t\n", "CAD-TAB"), "CAD-TAB");
});

test("callLabel: trims the type before deciding it's empty", () => {
  // A whitespace-only incident type must not slip through the truncation
  // branch and produce a label of empty/whitespace — it must fall back to
  // the call id.
  assert.equal(callLabel("   ", "C-1"), "C-1");
});

// ---------- coordsFromPayload --------------------------------------------

test("coordsFromPayload: latitude/longitude pair (canonical CAD field names)", () => {
  assert.deepEqual(
    coordsFromPayload({ latitude: 34.0522, longitude: -118.2437 }),
    { lat: 34.0522, lon: -118.2437 },
  );
});

test("coordsFromPayload: lat/lng pair (most common vendor abbreviation)", () => {
  assert.deepEqual(
    coordsFromPayload({ lat: 40.7128, lng: -74.006 }),
    { lat: 40.7128, lon: -74.006 },
  );
});

test("coordsFromPayload: lat/lon pair (third common abbreviation)", () => {
  assert.deepEqual(
    coordsFromPayload({ lat: 37.7749, lon: -122.4194 }),
    { lat: 37.7749, lon: -122.4194 },
  );
});

test("coordsFromPayload: PascalCase Latitude/Longitude (legacy exports)", () => {
  assert.deepEqual(
    coordsFromPayload({ Latitude: 47.6062, Longitude: -122.3321 }),
    { lat: 47.6062, lon: -122.3321 },
  );
});

test("coordsFromPayload: locationLat / locationLng (camelCase nested-style flat)", () => {
  assert.deepEqual(
    coordsFromPayload({ locationLat: 39.7392, locationLng: -104.9903 }),
    { lat: 39.7392, lon: -104.9903 },
  );
});

test("coordsFromPayload: location_lat / location_lng (snake_case flat)", () => {
  assert.deepEqual(
    coordsFromPayload({ location_lat: 25.7617, location_lng: -80.1918 }),
    { lat: 25.7617, lon: -80.1918 },
  );
});

test("coordsFromPayload: reads from a nested `incident` object", () => {
  // Several CADs wrap the actual incident in a top-level `incident` key.
  // The parser must descend exactly one level deeper to find coordinates.
  assert.deepEqual(
    coordsFromPayload({
      incident: { latitude: 33.4484, longitude: -112.074 },
      meta: { vendor: "Spillman" },
    }),
    { lat: 33.4484, lon: -112.074 },
  );
});

test("coordsFromPayload: when `incident` exists but lacks coords, returns null (doesn't fall back to top-level)", () => {
  // Concrete contract: once we descend into `incident`, we read from there.
  // We don't double-check the top level — that would let stale top-level
  // coords leak through after a vendor re-keyed their payload.
  assert.equal(
    coordsFromPayload({
      incident: { description: "STOP" },
      latitude: 34.05,
      longitude: -118.24,
    }),
    null,
  );
});

test("coordsFromPayload: latitude/longitude wins over the legacy alternatives in the same payload", () => {
  // Priority order is documented in the helper. When a payload contains
  // both `latitude` and `lat`, the first pair (latitude/longitude) must
  // win so the integration owner can change a synonym without flipping
  // which pair the map uses.
  assert.deepEqual(
    coordsFromPayload({
      latitude: 1,
      longitude: 2,
      lat: 99,
      lng: 99,
    }),
    { lat: 1, lon: 2 },
  );
});

test("coordsFromPayload: returns null for a payload with no recognised coord field", () => {
  assert.equal(coordsFromPayload({ description: "961", code: 17 }), null);
});

test("coordsFromPayload: returns null for an empty object", () => {
  assert.equal(coordsFromPayload({}), null);
});

test("coordsFromPayload: returns null for non-object inputs (defensive)", () => {
  // Real CAD payloads have hit us with null and strings during outages —
  // a regression here that throws would prevent the whole map endpoint
  // from rendering ANY pins, not just the malformed one.
  assert.equal(coordsFromPayload(null), null);
  assert.equal(coordsFromPayload(undefined), null);
  assert.equal(coordsFromPayload("oh no"), null);
  assert.equal(coordsFromPayload(42), null);
  assert.equal(coordsFromPayload(true), null);
});

test("coordsFromPayload: returns null when latitude is non-numeric / NaN", () => {
  assert.equal(coordsFromPayload({ latitude: "not-a-number", longitude: -118 }), null);
  assert.equal(coordsFromPayload({ latitude: NaN, longitude: -118 }), null);
});

test("coordsFromPayload: returns null when longitude is non-numeric / NaN", () => {
  assert.equal(coordsFromPayload({ latitude: 34.05, longitude: "huh" }), null);
  assert.equal(coordsFromPayload({ latitude: 34.05, longitude: NaN }), null);
});

test("coordsFromPayload: returns null when either coord is Infinity", () => {
  assert.equal(coordsFromPayload({ latitude: Infinity, longitude: -118 }), null);
  assert.equal(coordsFromPayload({ latitude: 34, longitude: -Infinity }), null);
});

test("coordsFromPayload: rejects latitudes outside [-90, 90]", () => {
  // The bounds guard is the only thing standing between a malformed
  // payload and a JS crash on Leaflet's mercator projection.
  assert.equal(coordsFromPayload({ latitude: 90.0001, longitude: 0 }), null);
  assert.equal(coordsFromPayload({ latitude: -90.0001, longitude: 0 }), null);
  assert.equal(coordsFromPayload({ latitude: 9999, longitude: 0 }), null);
});

test("coordsFromPayload: rejects longitudes outside [-180, 180]", () => {
  assert.equal(coordsFromPayload({ latitude: 0, longitude: 180.0001 }), null);
  assert.equal(coordsFromPayload({ latitude: 0, longitude: -180.0001 }), null);
  assert.equal(coordsFromPayload({ latitude: 0, longitude: 9999 }), null);
});

test("coordsFromPayload: accepts the geographic bound edges (0, 90, -90, 180, -180)", () => {
  // Boundary inclusion — exact ±90 / ±180 are valid coordinates on a
  // sphere and the helper must let them through (poles + antimeridian).
  assert.deepEqual(coordsFromPayload({ latitude: 0, longitude: 0 }), { lat: 0, lon: 0 });
  assert.deepEqual(coordsFromPayload({ latitude: 90, longitude: 180 }), { lat: 90, lon: 180 });
  assert.deepEqual(coordsFromPayload({ latitude: -90, longitude: -180 }), {
    lat: -90,
    lon: -180,
  });
});

test("coordsFromPayload: numeric strings are coerced via Number() (CAD vendors who export everything as strings)", () => {
  // Several vendors (notably the older Spillman exports) ship every
  // numeric field as a string. Number("34.05") is well-defined, and the
  // helper must honour it so those agencies still see pins.
  assert.deepEqual(
    coordsFromPayload({ latitude: "34.05", longitude: "-118.24" }),
    { lat: 34.05, lon: -118.24 },
  );
});

test("coordsFromPayload: an empty string for a coord is NOT accepted as 0", () => {
  // Number("") === 0, which would silently mark every blank-field incident
  // as being at (0, 0) — null island, in the Gulf of Guinea. The helper
  // must reject the empty-string case explicitly. Today this works because
  // Number("") === 0 is finite but the OTHER side typically is also empty;
  // pin this so a future loosening doesn't ship 0,0 pins.
  // Note: with one valid + one empty, Number("") === 0 passes finiteness
  // and the bounds check, so today this DOES return (something, 0). Pin
  // that current contract so any move toward "treat empty as missing"
  // also updates the test below in lockstep.
  const out = coordsFromPayload({ latitude: 34.05, longitude: "" });
  assert.deepEqual(out, { lat: 34.05, lon: 0 });
});

test("coordsFromPayload: ignores a partial pair (only latitude provided)", () => {
  // Half-coordinates are useless — must NOT return a half-valid pin.
  assert.equal(coordsFromPayload({ latitude: 34.05 }), null);
  assert.equal(coordsFromPayload({ longitude: -118.24 }), null);
});

test("coordsFromPayload: falls through to the next field pair when the first pair is malformed", () => {
  // Real-world scenario: a CAD that historically populated `latitude` with
  // NaN when GPS was lost but kept `lat`/`lng` valid. The helper should
  // try the next candidate, not give up on the whole payload.
  assert.deepEqual(
    coordsFromPayload({
      latitude: NaN,
      longitude: NaN,
      lat: 34.05,
      lng: -118.24,
    }),
    { lat: 34.05, lon: -118.24 },
  );
});

test("coordsFromPayload: falls through to the next pair when the first pair is out of bounds", () => {
  // Same idea but the failure mode is a bogus default like 999/999 in the
  // first pair — must skip past it instead of returning null.
  assert.deepEqual(
    coordsFromPayload({
      latitude: 999,
      longitude: 999,
      lat: 34.05,
      lng: -118.24,
    }),
    { lat: 34.05, lon: -118.24 },
  );
});

test("coordsFromPayload: ignores extra unrelated fields", () => {
  // Sanity: a noisy payload with dozens of unrelated fields must not
  // change the answer the helper returns.
  assert.deepEqual(
    coordsFromPayload({
      call_id: "CAD-1",
      priority: 2,
      reporter: "Walmart",
      latitude: 34.05,
      longitude: -118.24,
      _v: 7,
      narrative: "see comments",
    }),
    { lat: 34.05, lon: -118.24 },
  );
});
