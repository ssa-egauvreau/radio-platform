/**
 * Tests for the pure helpers exported by `server/src/aiDispatch/infoRequest.ts`.
 *
 * The full `buildInfoRequestResponse` flow is async + depends on Postgres /
 * web-search providers, so the integration paths aren't exercised here. The
 * pure helpers, however, are on the hot path of every transmission:
 *
 *   - `incidentPayloadHasUnit` is what the engine uses to decide which open
 *     10-8 call belongs to an officer (CAD comments / out-with rules / plate
 *     linkage). A regression here either silently drops legitimate comments
 *     or attaches them to an unrelated call.
 *   - `infoRequestNeedsAsync` decides whether the dispatcher gives an
 *     immediate "Standby." ack and follows up later, or answers inline.
 *   - `buildInfoRequestAck` is the deterministic "Standby." reply.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInfoRequestAck,
  incidentPayloadHasUnit,
  infoRequestNeedsAsync,
} from "../../src/aiDispatch/infoRequest.js";
import type { InfoRequestFields } from "../../src/aiDispatch/parse.js";

// -------------------- incidentPayloadHasUnit --------------------

test("incidentPayloadHasUnit finds the unit on a webhook-shaped payload", () => {
  const inc = {
    payload: {
      action: "created",
      incident: {
        callID: "C-1001",
        units: [{ unit: "352" }, { unit: "100" }],
      },
    },
  };
  assert.equal(incidentPayloadHasUnit(inc, "352"), true);
  assert.equal(incidentPayloadHasUnit(inc, "100"), true);
  assert.equal(incidentPayloadHasUnit(inc, "999"), false);
});

test("incidentPayloadHasUnit normalizes the 27- prefix on both sides", () => {
  const inc = {
    payload: { incident: { units: [{ unit: "352" }] } },
  };
  // Either format on either side should still match.
  assert.equal(incidentPayloadHasUnit(inc, "27-352"), true);

  const inc2 = {
    payload: { incident: { units: [{ unit: "27-352" }] } },
  };
  assert.equal(incidentPayloadHasUnit(inc2, "352"), true);
  assert.equal(incidentPayloadHasUnit(inc2, "27-352"), true);
});

test("incidentPayloadHasUnit accepts payloads with or without an 'incident' wrapper", () => {
  // Some store rows have the wrapper, some are flat.
  const wrapped = { payload: { incident: { units: [{ unit: "352" }] } } };
  const flat = { payload: { units: [{ unit: "352" }] } };
  assert.equal(incidentPayloadHasUnit(wrapped, "352"), true);
  assert.equal(incidentPayloadHasUnit(flat, "352"), true);
});

test("incidentPayloadHasUnit accepts 'Units' (capital) and alternative id keys", () => {
  // 10-8 has shipped both `units` and `Units`, and unit objects sometimes
  // carry id under a different key. Lock the tolerant lookup in.
  const a = { payload: { incident: { Units: [{ unit: "352" }] } } };
  const b = { payload: { incident: { units: [{ id: "352" }] } } };
  const c = { payload: { incident: { units: [{ unitId: "352" }] } } };
  const d = { payload: { incident: { units: [{ unit_id: "352" }] } } };
  for (const inc of [a, b, c, d]) {
    assert.equal(incidentPayloadHasUnit(inc, "352"), true);
  }
});

test("incidentPayloadHasUnit returns false for malformed payloads", () => {
  assert.equal(incidentPayloadHasUnit({ payload: null }, "352"), false);
  assert.equal(incidentPayloadHasUnit({ payload: "string" }, "352"), false);
  assert.equal(incidentPayloadHasUnit({ payload: {} }, "352"), false);
  // units must be an array.
  assert.equal(
    incidentPayloadHasUnit({ payload: { incident: { units: "352" } } }, "352"),
    false,
  );
  // empty target unit never matches.
  assert.equal(
    incidentPayloadHasUnit({ payload: { incident: { units: [{ unit: "352" }] } } }, ""),
    false,
  );
});

// -------------------- infoRequestNeedsAsync --------------------

test("infoRequestNeedsAsync flags exactly the slow / web-backed lookup types", () => {
  const slow: InfoRequestFields["type"][] = [
    "phone",
    "contact",
    "external_address",
    "legal_code",
    "general_query",
  ];
  for (const t of slow) {
    assert.equal(
      infoRequestNeedsAsync({ type: t, account_code: null, subject: null }),
      true,
      `${t} should be async`,
    );
  }
});

test("infoRequestNeedsAsync returns false for fast (in-memory / DB-backed) lookups", () => {
  const fast: InfoRequestFields["type"][] = [
    "address",
    "pending_calls",
    "active_calls_for_unit",
    "call_details",
    "unit_location",
    "unknown",
  ];
  for (const t of fast) {
    assert.equal(
      infoRequestNeedsAsync({ type: t, account_code: null, subject: null }),
      false,
      `${t} should be sync`,
    );
  }
});

// -------------------- buildInfoRequestAck --------------------

test("buildInfoRequestAck returns a generic 'Copy. Standby.' when no requesting unit is known", () => {
  assert.equal(buildInfoRequestAck(null), "Copy. Standby.");
  assert.equal(buildInfoRequestAck(undefined), "Copy. Standby.");
  assert.equal(buildInfoRequestAck(""), "Copy. Standby.");
});

test("buildInfoRequestAck drops the 27- prefix on patrol but keeps it for 27-0[0-3]0 dispatcher band", () => {
  assert.equal(buildInfoRequestAck("27-352"), "352, copy. Standby.");
  assert.equal(buildInfoRequestAck("100"), "100, copy. Standby.");
  // Dispatcher-side band keeps the prefix.
  for (const u of ["27-000", "27-010", "27-020", "27-030"]) {
    assert.equal(buildInfoRequestAck(u), `${u}, copy. Standby.`);
  }
});
