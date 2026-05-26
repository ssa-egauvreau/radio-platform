/**
 * Tests for `server/src/presence.ts`.
 *
 * The presence map drives every "who's listening on this channel right now"
 * decision in the server: the dispatch console roster, the radio handset
 * unit list, and (transitively, via `normalizedChannel`) the AI-dispatch
 * channel cache. Three regression classes matter most:
 *
 *  1. **Cross-tenant leakage.** Two agencies that pick the same channel
 *     name ("Green 1", "Dispatch", "Tac 2"…) must never see each other's
 *     units — that's a hard multi-tenancy boundary.
 *  2. **Channel normalisation.** A handset that joins "GREEN 1" must show
 *     up to a console listening on "green 1". If the normaliser stops
 *     case- or whitespace-folding, the dispatch console shows zero units
 *     online during a real incident.
 *  3. **TTL eviction.** Stale entries must time out (45 s) so a unit
 *     that loses its radio is no longer counted as "on the channel".
 *
 * The presence map is process-global by design (single-instance server).
 * Each test below uses unique agency IDs / unit IDs so prior tests can't
 * pollute later ones.
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  countPresence,
  heartbeatPresence,
  normalizedChannel,
} from "../src/presence.js";

let UNIQ = 0;
function uniqAgency(): number {
  return 700_000 + Math.floor(Date.now() % 100_000) + UNIQ++;
}

// ---------------------------------------------------------------------------
// normalizedChannel
// ---------------------------------------------------------------------------

test("normalizedChannel: trims, lower-cases, and collapses internal whitespace", () => {
  // The dispatch UI labels are mixed-case ("Green 1"), but radios send
  // arbitrary punctuation/casing. The normaliser is what makes those line
  // up — drop any of the three operations and a real handset stops
  // appearing on the matching console row.
  assert.equal(normalizedChannel("  GREEN 1  "), "green 1");
  assert.equal(normalizedChannel("Green   1"), "green 1");
  assert.equal(normalizedChannel("\tGreen\n1\t"), "green 1");
  assert.equal(normalizedChannel("dispatch"), "dispatch");
});

test("normalizedChannel: non-string inputs coerce to a sensible string (no throw)", () => {
  // The function takes `unknown` because it reads straight off `req.body`.
  // A confused client (or a JSON parser quirk) must not crash a hot path.
  assert.equal(normalizedChannel(null), "");
  assert.equal(normalizedChannel(undefined), "");
  assert.equal(normalizedChannel(42), "42");
  assert.equal(normalizedChannel(true), "true");
});

// ---------------------------------------------------------------------------
// heartbeatPresence input validation
// ---------------------------------------------------------------------------

test("heartbeatPresence: a clean heartbeat is recorded (count goes from 0 → 1)", () => {
  const agencyId = uniqAgency();
  assert.equal(countPresence(agencyId, "Green 1"), 0);
  const result = heartbeatPresence(agencyId, "27-040", "Green 1");
  assert.deepEqual(result, { ok: true });
  assert.equal(countPresence(agencyId, "Green 1"), 1);
});

test("heartbeatPresence: rejects empty unit / channel with bad_unit_or_channel", () => {
  const agencyId = uniqAgency();
  assert.deepEqual(heartbeatPresence(agencyId, "", "Green 1"), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  assert.deepEqual(heartbeatPresence(agencyId, "27-040", ""), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  assert.deepEqual(heartbeatPresence(agencyId, "   ", "   "), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  // Nothing was recorded for either side of the rejected heartbeats.
  assert.equal(countPresence(agencyId, "Green 1"), 0);
});

test('heartbeatPresence: rejects the literal "----" channel sentinel', () => {
  // The radio handset uses "----" to indicate "no channel selected".
  // If presence accepted that, an idle handset would be counted as
  // listening on a phantom channel.
  const agencyId = uniqAgency();
  assert.deepEqual(heartbeatPresence(agencyId, "27-040", "----"), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  assert.equal(countPresence(agencyId, "----"), 0);
});

test("heartbeatPresence: non-string unit / channel inputs are coerced (no throw)", () => {
  // Hot path runs on every location heartbeat — a malformed body must
  // never crash the route.
  const agencyId = uniqAgency();
  assert.deepEqual(heartbeatPresence(agencyId, null, "Green 1"), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  assert.deepEqual(heartbeatPresence(agencyId, undefined, "Green 1"), {
    ok: false,
    error: "bad_unit_or_channel",
  });
  // A numeric unit (`42`) becomes "42" upper-cased, which is fine.
  const ok = heartbeatPresence(agencyId, 42, "Green 1");
  assert.deepEqual(ok, { ok: true });
  assert.equal(countPresence(agencyId, "Green 1"), 1);
});

test("heartbeatPresence: same unit on different channels counts in each", () => {
  const agencyId = uniqAgency();
  heartbeatPresence(agencyId, "27-040", "Green 1");
  heartbeatPresence(agencyId, "27-040", "Green 2");
  assert.equal(countPresence(agencyId, "Green 1"), 1);
  assert.equal(countPresence(agencyId, "Green 2"), 1);
});

test("heartbeatPresence: repeated heartbeats from the same unit dedupe (count stays 1)", () => {
  // The presence bucket is a Map<unit, lastSeen>, so a unit that
  // heartbeats every 5 s must not inflate the count to 12 after a minute.
  const agencyId = uniqAgency();
  for (let i = 0; i < 12; i++) {
    heartbeatPresence(agencyId, "27-040", "Green 1");
  }
  assert.equal(countPresence(agencyId, "Green 1"), 1);
});

// ---------------------------------------------------------------------------
// Channel + unit normalisation
// ---------------------------------------------------------------------------

test("heartbeatPresence: case + whitespace differences in channel name match the same bucket", () => {
  // A radio that joins as "green 1" and a console that polls as "GREEN 1"
  // must see each other — that's the entire reason `normalizedChannel`
  // exists.
  const agencyId = uniqAgency();
  heartbeatPresence(agencyId, "27-040", "  GREEN  1 ");
  assert.equal(countPresence(agencyId, "green 1"), 1);
  assert.equal(countPresence(agencyId, "Green 1"), 1);
  assert.equal(countPresence(agencyId, "  green   1  "), 1);
});

test("heartbeatPresence: unit IDs are upper-cased + trimmed so case can't fork the bucket", () => {
  // If the same handset on the same channel hit the map twice — once as
  // "27-040" and once as " 27-040 " — under one key we'd count one unit;
  // under two we'd count two. Forcing a canonical form prevents that.
  const agencyId = uniqAgency();
  heartbeatPresence(agencyId, "27-040", "Green 1");
  heartbeatPresence(agencyId, " 27-040 ", "Green 1");
  heartbeatPresence(agencyId, "27-040", "Green 1");
  assert.equal(countPresence(agencyId, "Green 1"), 1);
});

test("heartbeatPresence: different channels under the same agency stay isolated", () => {
  const agencyId = uniqAgency();
  heartbeatPresence(agencyId, "27-040", "Green 1");
  heartbeatPresence(agencyId, "27-041", "Green 2");
  assert.equal(countPresence(agencyId, "Green 1"), 1);
  assert.equal(countPresence(agencyId, "Green 2"), 1);
  assert.equal(countPresence(agencyId, "Green 3"), 0);
});

// ---------------------------------------------------------------------------
// Multi-tenancy
// ---------------------------------------------------------------------------

test("heartbeatPresence: two agencies sharing a channel name are isolated", () => {
  // Hard multi-tenancy invariant: agency A's units must never count as
  // present for agency B even when both pick "Green 1" as the channel
  // label. A regression here is a P0.
  const a = uniqAgency();
  const b = uniqAgency();
  heartbeatPresence(a, "A-UNIT-1", "Green 1");
  heartbeatPresence(a, "A-UNIT-2", "Green 1");
  heartbeatPresence(b, "B-UNIT-1", "Green 1");

  assert.equal(countPresence(a, "Green 1"), 2);
  assert.equal(countPresence(b, "Green 1"), 1);
});

test("countPresence: returns 0 for an unknown agency / channel without throwing", () => {
  // A console polling for a freshly-created channel before any unit has
  // joined must get `0`, not `undefined` or an exception.
  const agencyId = uniqAgency();
  assert.equal(countPresence(agencyId, "Brand New Channel"), 0);
  assert.equal(countPresence(agencyId, ""), 0);
  assert.equal(countPresence(agencyId, null), 0);
});

// ---------------------------------------------------------------------------
// TTL pruning (45s)
// ---------------------------------------------------------------------------

test("heartbeatPresence: entries older than the 45s TTL are pruned on the next call", (t) => {
  // Mock the clock so we can advance time deterministically. Using
  // node:test's built-in mock.timers keeps the test fast and free of any
  // real-clock flakiness.
  t.mock.timers.enable({ apis: ["Date"] });

  const agencyId = uniqAgency();
  heartbeatPresence(agencyId, "STALE-UNIT", "Green 1");
  assert.equal(countPresence(agencyId, "Green 1"), 1);

  // 30 s — still inside the 45 s TTL — entry must remain.
  t.mock.timers.tick(30_000);
  assert.equal(countPresence(agencyId, "Green 1"), 1);

  // 50 s — past the 45 s TTL — the next observation prunes the entry.
  t.mock.timers.tick(20_000);
  assert.equal(countPresence(agencyId, "Green 1"), 0);

  t.mock.timers.reset();
});

test("heartbeatPresence: a heartbeat refreshes lastSeen so the unit isn't pruned", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const agencyId = uniqAgency();

  heartbeatPresence(agencyId, "FRESH-UNIT", "Green 1");
  // Cross half the TTL, then heartbeat again — the second heartbeat
  // resets the timer for that unit.
  t.mock.timers.tick(30_000);
  heartbeatPresence(agencyId, "FRESH-UNIT", "Green 1");
  // Now cross the original 45 s mark — the unit must still be present
  // because its lastSeen was bumped at the 30 s mark.
  t.mock.timers.tick(20_000);
  assert.equal(countPresence(agencyId, "Green 1"), 1);

  // Cross another 30 s without a heartbeat — now the unit is past its TTL.
  t.mock.timers.tick(30_000);
  assert.equal(countPresence(agencyId, "Green 1"), 0);

  t.mock.timers.reset();
});

test("heartbeatPresence: pruning on one channel does not affect a fresh unit on another", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const agencyId = uniqAgency();

  heartbeatPresence(agencyId, "OLD-UNIT", "Green 1");
  t.mock.timers.tick(40_000);
  // Brand-new heartbeat on a different channel arrives near the end of
  // the old unit's TTL. After the global prune sweep fires, the new
  // unit's entry must survive even though the old one is about to be
  // evicted.
  heartbeatPresence(agencyId, "NEW-UNIT", "Green 2");
  // Push past the old unit's TTL but stay well inside the new unit's.
  t.mock.timers.tick(10_000);

  assert.equal(countPresence(agencyId, "Green 1"), 0);
  assert.equal(countPresence(agencyId, "Green 2"), 1);

  t.mock.timers.reset();
});
