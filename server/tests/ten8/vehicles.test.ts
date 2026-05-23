/**
 * Tests for `server/src/ten8/vehicles.ts`.
 *
 * These helpers build the AddVehicleRequest body that gets POSTed to
 * 10-8 CAD `POST /v1/incidents/{lookup}/vehicles` and the structured
 * comment that gets posted to a call when the structured AddVehicle API
 * is not available.
 *
 * A regression here means a plate-lookup result either:
 *   - never makes it onto the incident (officer's run never shows on
 *     the call sheet), or
 *   - is posted with the wrong year / make / VIN (officer sees a
 *     mismatched record for the car they actually have stopped).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTen8AddVehicleBody,
  formatTen8VehicleLookupComment,
} from "../../src/ten8/vehicles.js";
import type { PlateLookupResult } from "../../src/aiDispatch/plateLookup.js";

// ---------- buildTen8AddVehicleBody --------------------------------------

test("buildTen8AddVehicleBody returns null when lookup.ok is false", () => {
  const failed: PlateLookupResult = {
    ok: false,
    plate: "8VWV621",
    state: "CA",
    reason: "no_record",
  };
  assert.equal(buildTen8AddVehicleBody(failed), null);
});

test("buildTen8AddVehicleBody returns null when ok but every vehicle field is empty", () => {
  // A 'success' response with no usable fields would otherwise POST an
  // empty vehicle row to 10-8 and clutter the incident.
  const empty: PlateLookupResult = { ok: true, plate: "", vin: "", state: "" };
  assert.equal(buildTen8AddVehicleBody(empty), null);
});

test("buildTen8AddVehicleBody uppercases plate/state/VIN and includes only present fields", () => {
  const lookup: PlateLookupResult = {
    ok: true,
    plate: " 8vwv621 ",
    state: " ca ",
    vin: " 1HGCM82633A123456 ",
    make: "Honda",
    model: "Civic",
    color: "White",
    year: "2014",
  };
  const out = buildTen8AddVehicleBody(lookup);
  assert.deepEqual(out, {
    notes: "Plate lookup CA 8VWV621",
    vehicle: {
      license: "8VWV621",
      vin: "1HGCM82633A123456",
      state: "CA",
      make: "Honda",
      model: "Civic",
      color: "White",
      year: 2014,
    },
  });
});

test("buildTen8AddVehicleBody parses 4-digit year, rejects garbage and out-of-range years", () => {
  const base: PlateLookupResult = {
    ok: true,
    plate: "ABC123",
    state: "CA",
    make: "Ford",
  };
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "2020" })?.vehicle.year, 2020);
  // Digit-strip happens before parseInt, but a 2-digit "year" (e.g. "'14")
  // falls below the 1900 floor and gets discarded — we never post a 2-digit
  // year to 10-8 because it would otherwise be displayed as the year 14 AD.
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "  '14 " })?.vehicle.year, undefined);
  // year < 1900 or > 2100 must be dropped.
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "1800" })?.vehicle.year, undefined);
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "9999" })?.vehicle.year, undefined);
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "abc" })?.vehicle.year, undefined);
  assert.equal(buildTen8AddVehicleBody({ ...base, year: null })?.vehicle.year, undefined);
  // Reasonable model years all pass.
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "1995" })?.vehicle.year, 1995);
  assert.equal(buildTen8AddVehicleBody({ ...base, year: "2026" })?.vehicle.year, 2026);
});

test("buildTen8AddVehicleBody notes prefer plate+state, then VIN-only, then generic", () => {
  // Plate + state
  assert.equal(
    buildTen8AddVehicleBody({ ok: true, plate: "ABC123", state: "CA", make: "Ford" })?.notes,
    "Plate lookup CA ABC123",
  );
  // VIN-only
  assert.equal(
    buildTen8AddVehicleBody({
      ok: true,
      vin: "1HGCM82633A123456",
      make: "Ford",
    })?.notes,
    "VIN lookup",
  );
  // Neither plate+state nor VIN — just decoded fields
  assert.equal(
    buildTen8AddVehicleBody({ ok: true, make: "Ford", model: "F-150", color: "Red" })?.notes,
    "Vehicle lookup",
  );
});

test("buildTen8AddVehicleBody omits absent optional fields (no undefined keys leak into the body)", () => {
  const lookup: PlateLookupResult = { ok: true, plate: "ABC123", state: "CA" };
  const out = buildTen8AddVehicleBody(lookup);
  assert.ok(out);
  assert.deepEqual(Object.keys(out!.vehicle).sort(), ["license", "state"]);
});

// ---------- formatTen8VehicleLookupComment ------------------------------

test("formatTen8VehicleLookupComment: success comment carries plate, state, and decoded car", () => {
  const out = formatTen8VehicleLookupComment("27-040", {
    ok: true,
    plate: "8VWV621",
    state: "CA",
    year: "2014",
    make: "Honda",
    model: "Civic",
    color: "White",
  });
  assert.equal(out, "27-040 VEHICLE LOOKUP CA 8VWV621 2014 Honda Civic White");
});

test("formatTen8VehicleLookupComment: includes VIN suffix when both plate and VIN are present", () => {
  const out = formatTen8VehicleLookupComment("27-040", {
    ok: true,
    plate: "8VWV621",
    state: "CA",
    make: "Honda",
    model: "Civic",
    vin: "1HGCM82633A123456",
  });
  assert.ok(out);
  assert.match(out!, /VIN 1HGCM82633A123456$/);
});

test("formatTen8VehicleLookupComment: VIN-only success drops the plate slot", () => {
  const out = formatTen8VehicleLookupComment("27-040", {
    ok: true,
    vin: "1HGCM82633A123456",
    make: "Honda",
    model: "Civic",
  });
  assert.equal(out, "27-040 VEHICLE LOOKUP VIN 1HGCM82633A123456 Honda Civic");
});

test("formatTen8VehicleLookupComment: failure path uppercases reason and replaces underscores with spaces", () => {
  // 'no_record' must NOT be left in machine form — dispatchers read this on
  // the screen.
  assert.equal(
    formatTen8VehicleLookupComment("27-040", {
      ok: false,
      plate: "8VWV621",
      state: "CA",
      reason: "no_record",
    }),
    "27-040 VEHICLE LOOKUP CA 8VWV621 NO RECORD",
  );
});

test("formatTen8VehicleLookupComment: failure path prefers message over generic 'no record'", () => {
  assert.equal(
    formatTen8VehicleLookupComment("27-040", {
      ok: false,
      plate: "8VWV621",
      state: "CA",
      message: "Out of credits",
    }),
    "27-040 VEHICLE LOOKUP CA 8VWV621 OUT OF CREDITS",
  );
});

test("formatTen8VehicleLookupComment: returns null when callsign is blank", () => {
  assert.equal(
    formatTen8VehicleLookupComment("", {
      ok: true,
      plate: "8VWV621",
      state: "CA",
      make: "Honda",
    }),
    null,
  );
  assert.equal(
    formatTen8VehicleLookupComment("   ", {
      ok: true,
      plate: "8VWV621",
    }),
    null,
  );
});

test("formatTen8VehicleLookupComment: success with no decoded fields skips the description segment", () => {
  // Common case: plate is valid but DMV record has no vehicle details.
  const out = formatTen8VehicleLookupComment("27-040", {
    ok: true,
    plate: "8VWV621",
    state: "CA",
  });
  assert.equal(out, "27-040 VEHICLE LOOKUP CA 8VWV621");
});

test("formatTen8VehicleLookupComment caps comment at 4000 characters", () => {
  const out = formatTen8VehicleLookupComment("27-040", {
    ok: true,
    plate: "ABC123",
    state: "CA",
    make: "x".repeat(5000),
  });
  assert.ok(out);
  assert.equal(out!.length, 4000);
});
