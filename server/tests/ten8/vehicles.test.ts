/**
 * Tests for `server/src/ten8/vehicles.ts`.
 *
 * `buildTen8AddVehicleBody` is the body posted to 10-8's
 * `POST /v1/incidents/{lookup}/vehicles` endpoint when an officer runs a
 * plate or VIN. `formatTen8VehicleLookupComment` is the fallback CAD comment
 * we duplicate the same facts into. Both run on every plate hit; a regression
 * here either drops vehicle details from the active call or sends garbage
 * (e.g. an invalid year) that 10-8 rejects.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTen8AddVehicleBody,
  formatTen8VehicleLookupComment,
} from "../../src/ten8/vehicles.js";
import type { PlateLookupResult } from "../../src/aiDispatch/plateLookup.js";

function lookup(over: Partial<PlateLookupResult> = {}): PlateLookupResult {
  return {
    ok: true,
    plate: "8VWV621",
    state: "CA",
    year: "2018",
    make: "Honda",
    model: "Civic",
    color: "white",
    vin: "1HGBH41JXMN109186",
    provider: "platetovin",
    ...over,
  };
}

// -------------------- buildTen8AddVehicleBody --------------------

test("buildTen8AddVehicleBody returns null when the lookup itself failed", () => {
  assert.equal(buildTen8AddVehicleBody({ ok: false, reason: "no_record" }), null);
});

test("buildTen8AddVehicleBody returns null when nothing useful was decoded", () => {
  assert.equal(
    buildTen8AddVehicleBody({ ok: true, plate: undefined, vin: undefined }),
    null,
  );
});

test("buildTen8AddVehicleBody fills the structured vehicle object on a clean plate hit", () => {
  const body = buildTen8AddVehicleBody(lookup());
  assert.ok(body);
  assert.deepEqual(body!.vehicle, {
    license: "8VWV621",
    vin: "1HGBH41JXMN109186",
    state: "CA",
    make: "Honda",
    model: "Civic",
    color: "white",
    year: 2018,
  });
  // notes line tags this as a plate run.
  assert.equal(body!.notes, "Plate lookup CA 8VWV621");
});

test("buildTen8AddVehicleBody upper-cases license, state, and VIN even when lookup did not", () => {
  const body = buildTen8AddVehicleBody(
    lookup({ plate: "  8vwv621  ", state: "  ca  ", vin: "  1hgbh41jxmn109186  " }),
  );
  assert.equal(body!.vehicle.license, "8VWV621");
  assert.equal(body!.vehicle.state, "CA");
  assert.equal(body!.vehicle.vin, "1HGBH41JXMN109186");
});

test("buildTen8AddVehicleBody drops a year that is non-numeric / out of [1900,2100]", () => {
  // Garbage years would crash 10-8's validator; the helper drops them.
  for (const bad of ["abcd", "1800", "9999", " "]) {
    const body = buildTen8AddVehicleBody(lookup({ year: bad }));
    assert.ok(body, `year=${bad} should still build a body`);
    assert.equal(body!.vehicle.year, undefined, `year=${bad} should be dropped`);
  }
  // Strips embedded non-digits and accepts the numeric tail.
  const ok = buildTen8AddVehicleBody(lookup({ year: "MY 2024" }));
  assert.equal(ok!.vehicle.year, 2024);
});

test("buildTen8AddVehicleBody uses 'VIN lookup' notes when only a VIN was present", () => {
  const body = buildTen8AddVehicleBody(
    lookup({ plate: undefined, state: undefined }),
  );
  assert.ok(body);
  assert.equal(body!.notes, "VIN lookup");
  assert.equal(body!.vehicle.license, undefined);
});

test("buildTen8AddVehicleBody falls back to 'Vehicle lookup' notes when neither plate nor VIN known", () => {
  const body = buildTen8AddVehicleBody(
    lookup({ plate: undefined, state: undefined, vin: undefined, make: "Honda" }),
  );
  assert.ok(body);
  assert.equal(body!.notes, "Vehicle lookup");
});

// -------------------- formatTen8VehicleLookupComment --------------------

test("formatTen8VehicleLookupComment returns null when the callsign is missing", () => {
  assert.equal(formatTen8VehicleLookupComment("", lookup()), null);
  assert.equal(formatTen8VehicleLookupComment("   ", lookup()), null);
});

test("formatTen8VehicleLookupComment writes the canonical 'VEHICLE LOOKUP' line for a plate hit", () => {
  const out = formatTen8VehicleLookupComment("352", lookup());
  assert.equal(
    out,
    "352 VEHICLE LOOKUP CA 8VWV621 2018 Honda Civic white VIN 1HGBH41JXMN109186",
  );
});

test("formatTen8VehicleLookupComment writes 'VIN <id>' for a VIN-only hit", () => {
  const out = formatTen8VehicleLookupComment(
    "352",
    lookup({ plate: undefined, state: undefined }),
  );
  assert.ok(out);
  assert.match(out!, /^352 VEHICLE LOOKUP VIN 1HGBH41JXMN109186/);
});

test("formatTen8VehicleLookupComment surfaces a friendly reason on failed lookups", () => {
  const out = formatTen8VehicleLookupComment(
    "352",
    { ok: false, plate: "8VWV621", state: "CA", reason: "no_record" },
  );
  // Underscores in the reason become spaces, and the whole tail is uppercased.
  assert.equal(out, "352 VEHICLE LOOKUP CA 8VWV621 NO RECORD");
});

test("formatTen8VehicleLookupComment falls back to the message when no reason is set", () => {
  const out = formatTen8VehicleLookupComment(
    "352",
    { ok: false, plate: "8VWV621", state: "CA", message: "auth error" },
  );
  assert.match(out!, /AUTH ERROR$/);
});

test("formatTen8VehicleLookupComment caps the comment at 4000 chars", () => {
  const huge = "X".repeat(8000);
  const out = formatTen8VehicleLookupComment(
    "352",
    lookup({ make: huge, model: huge, color: huge }),
  );
  assert.ok(out);
  assert.equal(out!.length, 4000);
  assert.ok(out!.startsWith("352 VEHICLE LOOKUP"));
});
