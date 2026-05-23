/**
 * Tests for the pure helpers in `server/src/aiDispatch/plateLookup.ts`.
 *
 * These are the helpers that:
 *   - turn a PlateLookupResult into the on-air radio readback the officer
 *     actually hears (`buildPlateReadback`, `buildVinReadback`), and
 *   - track the 912 "plate request" window so the engine knows whether the
 *     next transmission is a plate readout from the unit
 *     (`notePendingPlateRequest` / `consumePendingPlateRequest`).
 *
 * Wrong readback wording = officer acts on the wrong vehicle info on a
 * felony stop. Wrong pending-window logic = engine either fires plate
 * lookups on unrelated traffic or never recognizes the plate when it
 * arrives.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPlateReadback,
  buildVinReadback,
  consumePendingPlateRequest,
  notePendingPlateRequest,
} from "../../src/aiDispatch/plateLookup.js";

// Each test uses a unique agency+unit pair so the process-global pendingPlate
// Map from a prior test cannot leak into later tests.
let UNIQ = 0;
function uniqAgency(): number {
  return 800_000 + Math.floor(Date.now() % 100_000) + UNIQ++;
}

// ---------- buildPlateReadback ------------------------------------------

test("buildPlateReadback: success path speaks unit, plate phonetically, and decoded vehicle", () => {
  const out = buildPlateReadback("27-205", {
    ok: true,
    plate: "ABC123",
    state: "CA",
    year: "2014",
    make: "Honda",
    model: "Civic",
    color: "White",
  });
  // callSignForReadback (platePhonetics): patrol (27-1XX..27-9XX) drops 27- prefix.
  assert.match(out, /^205, /, "patrol callsign drops the 27- prefix");
  assert.match(out, /California/, "state code is spoken as the full state name");
  assert.match(out, /alpha bravo charlie one two three/i, "plate is read NATO-phonetic");
  assert.match(out, /comes back to a White 2014 Honda Civic\.?$|White 2014 Honda Civic.+\.$/);
});

test("buildPlateReadback: success path appends 'last six of vin ...' when VIN is present", () => {
  const out = buildPlateReadback("27-205", {
    ok: true,
    plate: "ABC123",
    state: "CA",
    make: "Honda",
    model: "Civic",
    vin: "1HGCM82633A123456",
  });
  assert.match(out, /last six of vin/i);
  assert.match(out, /\.$/, "ends in a period for clean TTS phrasing");
});

test("buildPlateReadback: success but no decoded vehicle details still names the plate clearly", () => {
  const out = buildPlateReadback("27-205", {
    ok: true,
    plate: "ABC123",
    state: "CA",
  });
  assert.match(out, /no further details available/i);
  assert.match(out, /alpha bravo charlie one two three/i);
});

test("buildPlateReadback: no_record failure path explicitly says 'no record found' with the run plate", () => {
  const out = buildPlateReadback("27-205", {
    ok: false,
    plate: "ABC123",
    state: "CA",
    reason: "no_record",
  });
  assert.match(out, /no record found/i);
  assert.match(out, /alpha bravo charlie one two three/i);
});

test("buildPlateReadback: generic failure path says 'plate lookup unavailable, stand by'", () => {
  const out = buildPlateReadback("27-205", {
    ok: false,
    reason: "network_error",
    message: "Whatever",
  });
  assert.match(out, /plate lookup unavailable, stand by\.?$/i);
});

test("buildPlateReadback: command-staff callsign 27-020 KEEPS the 27- prefix on the air", () => {
  // 27-0XX (three-digit tail starting with 0) is command staff: keeps prefix.
  const out = buildPlateReadback("27-020", {
    ok: true,
    plate: "ABC123",
    state: "CA",
    make: "Honda",
  });
  assert.match(out, /^27-020, /);
});

test("buildPlateReadback: 27-040 (command-staff tail starts with 0) keeps the 27- prefix", () => {
  // Locks in the readback rule (different from dispatchAck's 27-0[0-3]0
  // rule). 27-040 here is COMMAND STAFF for plate readback purposes.
  const out = buildPlateReadback("27-040", {
    ok: true,
    plate: "ABC123",
    state: "CA",
    make: "Honda",
  });
  assert.match(out, /^27-040, /);
});

test("buildPlateReadback: empty/blank unitId is tolerated (no leading 'undefined,' prefix)", () => {
  const out = buildPlateReadback("", {
    ok: false,
    plate: "ABC123",
    state: "CA",
    reason: "no_record",
  });
  assert.equal(
    /^undefined/.test(out),
    false,
    "must not leak 'undefined' into the readback when unitId is empty",
  );
});

// ---------- buildVinReadback --------------------------------------------

test("buildVinReadback: success path speaks year/make/model", () => {
  const out = buildVinReadback("27-205", {
    ok: true,
    vin: "1HGCM82633A123456",
    year: "2014",
    make: "Honda",
    model: "Civic",
  });
  assert.equal(out, "205, vin comes back to a 2014 Honda Civic.");
});

test("buildVinReadback: success but no decoded fields falls back to 'vin comes back valid but vehicle details are unavailable'", () => {
  const out = buildVinReadback("27-205", { ok: true, vin: "1HGCM82633A123456" });
  assert.match(out, /vin comes back valid but vehicle details are unavailable\.?$/i);
});

test("buildVinReadback: no_record failure says 'vin lookup shows no record found'", () => {
  const out = buildVinReadback("27-205", {
    ok: false,
    vin: "1HGCM82633A123456",
    reason: "no_record",
  });
  assert.match(out, /vin lookup shows no record found\.?$/i);
});

test("buildVinReadback: invalid_vin failure asks for a 10-9", () => {
  // Officer mis-spoke the VIN — speak back '10-9' (repeat your last
  // transmission) instead of saying "no record" which would imply the
  // VIN was valid and unknown.
  const out = buildVinReadback("27-205", {
    ok: false,
    vin: "BADVIN",
    reason: "invalid_vin",
  });
  assert.match(out, /10-9/);
});

test("buildVinReadback: generic failure path says 'vin lookup unavailable, stand by'", () => {
  const out = buildVinReadback("27-205", {
    ok: false,
    vin: "1HGCM82633A123456",
    reason: "network_error",
  });
  assert.match(out, /vin lookup unavailable, stand by\.?$/i);
});

// ---------- pending 912 plate request window ----------------------------

test("consumePendingPlateRequest: returns false when no pending request was noted", () => {
  const agencyId = uniqAgency();
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), false);
});

test("notePending + consumePending: matches the first follow-up within the TTL window", () => {
  const agencyId = uniqAgency();
  notePendingPlateRequest(agencyId, "27-205");
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), true);
});

test("consumePendingPlateRequest is one-shot (a second consume after a hit returns false)", () => {
  // If we left the pending flag set, every later transmission from the unit
  // would be treated as a plate readout. Must be one-shot.
  const agencyId = uniqAgency();
  notePendingPlateRequest(agencyId, "27-205");
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), true);
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), false);
});

test("pending requests are isolated per (agencyId, unitId)", () => {
  const a = uniqAgency();
  const b = uniqAgency();
  notePendingPlateRequest(a, "27-205");
  assert.equal(consumePendingPlateRequest(b, "27-205"), false, "cross-agency leak");
  assert.equal(consumePendingPlateRequest(a, "27-205"), true);

  notePendingPlateRequest(a, "27-205");
  assert.equal(consumePendingPlateRequest(a, "27-352"), false, "cross-unit leak");
  assert.equal(consumePendingPlateRequest(a, "27-205"), true);
});

test("repeated notePendingPlateRequest refreshes the timestamp instead of stacking", () => {
  // A unit that asks for a plate twice in a row should still be one pending
  // (last-write wins).
  const agencyId = uniqAgency();
  notePendingPlateRequest(agencyId, "27-205");
  notePendingPlateRequest(agencyId, "27-205");
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), true);
  assert.equal(consumePendingPlateRequest(agencyId, "27-205"), false);
});
