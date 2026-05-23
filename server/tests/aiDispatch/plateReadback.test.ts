/**
 * Tests for the pure helpers in `server/src/aiDispatch/plateLookup.ts` —
 * `buildPlateReadback`, `buildVinReadback`, and the pending-plate window
 * (`notePendingPlateRequest` + `consumePendingPlateRequest`).
 *
 * These run on every plate or VIN transmission. A regression in a readback
 * means officers hear the wrong plate / state / vehicle on the air; a
 * regression in the pending window either drops a held 912 (officer asks
 * for a plate, then transmits the plate, and dispatch never reads it back)
 * or leaks across agencies / units.
 *
 * The network-touching flow (`runPlateLookup`, `lookupVin`) needs Postgres +
 * external APIs and is intentionally not unit-tested here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPlateReadback,
  buildVinReadback,
  consumePendingPlateRequest,
  notePendingPlateRequest,
  type PlateLookupResult,
} from "../../src/aiDispatch/plateLookup.js";

// -------------------- buildPlateReadback --------------------

test("buildPlateReadback says the full vehicle on a successful hit", () => {
  const out = buildPlateReadback("27-352", {
    ok: true,
    plate: "8VWV621",
    state: "CA",
    year: "2018",
    make: "Honda",
    model: "Civic",
    color: "white",
    vin: "1HGBH41JXMN109186",
  });
  // Patrol callsign drops 27-, plate is read phonetically, last 6 of VIN
  // is included. State expanded to "California".
  assert.equal(
    out,
    "352, your California plate of eight Victor Whiskey Victor six two one comes back to a white 2018 Honda Civic, last six of vin one zero nine one eight six.",
  );
});

test("buildPlateReadback handles a hit with no decoded vehicle details", () => {
  const out = buildPlateReadback("27-352", {
    ok: true,
    plate: "8VWV621",
    state: "CA",
  });
  assert.match(out, /comes back to a vehicle with no further details available\.$/);
});

test("buildPlateReadback says 'no record found' on a no_record miss", () => {
  const out = buildPlateReadback("27-352", {
    ok: false,
    reason: "no_record",
    plate: "8VWV621",
    state: "CA",
  });
  assert.equal(
    out,
    "352, your California plate of eight Victor Whiskey Victor six two one shows no record found.",
  );
});

test("buildPlateReadback says 'plate lookup unavailable' on auth/network/etc.", () => {
  for (const reason of ["auth_error", "insufficient_credit", "network_error", "api_error"] as const) {
    const out = buildPlateReadback("27-352", {
      ok: false,
      reason,
      plate: "8VWV621",
      state: "CA",
    });
    assert.match(out, /plate lookup unavailable, stand by\./);
  }
});

// -------------------- buildVinReadback --------------------

test("buildVinReadback returns the year/make/model on a clean hit", () => {
  const out = buildVinReadback("27-352", {
    ok: true,
    vin: "1HGBH41JXMN109186",
    year: "2018",
    make: "Honda",
    model: "Civic",
  });
  assert.equal(out, "352, vin comes back to a 2018 Honda Civic.");
});

test("buildVinReadback distinguishes invalid_vin from no_record from network", () => {
  assert.match(
    buildVinReadback("27-352", { ok: false, reason: "invalid_vin" }),
    /negative on that vin, please 10-9 the transmission\./,
  );
  assert.match(
    buildVinReadback("27-352", { ok: false, reason: "no_record" }),
    /vin lookup shows no record found\./,
  );
  assert.match(
    buildVinReadback("27-352", { ok: false, reason: "network_error" }),
    /vin lookup unavailable, stand by\./,
  );
});

test("buildVinReadback handles a successful hit with no vehicle details", () => {
  const out = buildVinReadback("27-352", {
    ok: true,
    vin: "1HGBH41JXMN109186",
  });
  assert.equal(
    out,
    "352, vin comes back valid but vehicle details are unavailable.",
  );
});

// -------------------- pending-plate window --------------------

test("consumePendingPlateRequest is false when no request was noted", () => {
  // Use a unique agency id per test so prior runs can't poison state.
  const agencyId = 800_001 + (Math.floor(Math.random() * 100_000));
  assert.equal(consumePendingPlateRequest(agencyId, "352"), false);
});

test("notePendingPlateRequest holds for exactly one consume (one-shot)", () => {
  const agencyId = 800_002 + (Math.floor(Math.random() * 100_000));
  notePendingPlateRequest(agencyId, "352");
  assert.equal(consumePendingPlateRequest(agencyId, "352"), true);
  // Second consume returns false — the held window was already used.
  assert.equal(consumePendingPlateRequest(agencyId, "352"), false);
});

test("pending-plate window is keyed by (agencyId, unitId) and does not leak across agencies/units", () => {
  const agencyA = 800_010 + (Math.floor(Math.random() * 100_000));
  const agencyB = 800_011 + (Math.floor(Math.random() * 100_000));
  notePendingPlateRequest(agencyA, "352");

  // Different unit, same agency → no match.
  assert.equal(consumePendingPlateRequest(agencyA, "100"), false);
  // Different agency, same unit → no match.
  assert.equal(consumePendingPlateRequest(agencyB, "352"), false);
  // Original combo still consumes.
  assert.equal(consumePendingPlateRequest(agencyA, "352"), true);
});

test("pending-plate window expires after PLATE_TTL_MS (~30s); use fake clock", (t) => {
  // The TTL is 30s; we don't want to wait that long, so we monkey-patch Date.now.
  const realNow = Date.now;
  let now = 1_000_000_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = realNow;
  });

  const agencyId = 800_020 + (Math.floor(Math.random() * 100_000));
  notePendingPlateRequest(agencyId, "352");
  // Advance by 31s (past PLATE_TTL_MS=30_000).
  now += 31_000;
  assert.equal(
    consumePendingPlateRequest(agencyId, "352"),
    false,
    "should have expired",
  );
});
