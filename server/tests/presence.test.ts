/**
 * Tests for `server/src/presence.ts`.
 *
 * Channel presence is a small in-memory map that every Android / iOS
 * handset on the agency pokes every ~12 s via
 * `POST /v1/presence/heartbeat`, and that every dispatcher screen reads
 * via `GET /v1/presence/count`. The numbers it returns drive the "X
 * units on this channel" badge — every "is anyone actually listening"
 * UI decision a user makes flows through these two functions.
 *
 * A regression here is easy to miss in QA because the symptoms only
 * show up across tenants or after a TTL has elapsed:
 *
 *  - Cross-tenant leakage: two agencies that happen to name a channel
 *    the same thing (e.g. "Dispatch") seeing each other's unit counts.
 *    `presenceKey` namespaces by agencyId — if that ever drifts, every
 *    paying agency would silently expose presence to every other one.
 *  - "----" sentinel ack: the Android client uses "----" to mean "tuned
 *    to no channel". A naive normaliser would happily register a unit
 *    on the literal "----" channel and inflate every dispatcher's
 *    presence count for whichever channel a future code path normalises
 *    to that string.
 *  - Channel/unit normalisation drift: heartbeats arrive with sloppy
 *    casing and whitespace from real-world handsets — if the canonical
 *    form drifts between writer and reader, every refreshed heartbeat
 *    creates a brand-new bucket and the count looks like it's climbing
 *    unboundedly, or never decreases as units roam off the channel.
 *  - TTL pruning: stuck-on / crashed handsets must drop off the count
 *    after `TTL_MS`. A regression that leaves stale entries in the map
 *    permanently inflates the dispatcher's "units listening" badge.
 *
 * State isolation: `presence.ts` keeps a module-level Map with no
 * exported reset hook. Each test below uses a unique `agencyId` derived
 * from a monotonic counter so concurrent / sequential tests can never
 * collide on the same presence bucket — even if a future change leaves
 * stale entries behind, they sit under a different agencyId and don't
 * pollute later asserts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countPresence,
  heartbeatPresence,
  normalizedChannel,
} from "../src/presence.js";

// Bump per test so module-level Map state cannot leak between cases.
// Start high to stay clear of any agency IDs another suite might happen
// to use if the test runner is ever changed to share state.
let NEXT_AGENCY = 9_000_000;
function uniqueAgency(): number {
  return NEXT_AGENCY++;
}

// --- normalizedChannel ---------------------------------------------------

test("normalizedChannel: lower-cases and trims surrounding whitespace", () => {
  // Real handsets send a mix of casings: the Android channel picker
  // produces title-case strings, the iOS one all-lowercase, and the
  // dispatch console sometimes sends user-typed labels with stray
  // spaces. Every one must land on the same key or presence buckets
  // fragment across casings.
  assert.equal(normalizedChannel(" Dispatch "), "dispatch");
  assert.equal(normalizedChannel("DISPATCH"), "dispatch");
  assert.equal(normalizedChannel("dispatch"), "dispatch");
  assert.equal(normalizedChannel("\tDispatch\n"), "dispatch");
});

test("normalizedChannel: collapses runs of internal whitespace to a single space", () => {
  // "Tac   1" and "Tac 1" must be the same bucket — otherwise a single
  // user-typed double space in the channel name fragments presence in
  // a way no operator can see or fix.
  assert.equal(normalizedChannel("Tac   1"), "tac 1");
  assert.equal(normalizedChannel("Tac\t1"), "tac 1");
  assert.equal(normalizedChannel("Tac\n\n1"), "tac 1");
});

test("normalizedChannel: maps null / undefined / non-string to the empty string", () => {
  // The route reads `req.body?.channel` straight off Express, which can
  // be anything. The function must not blow up on a non-string input
  // and must not write "undefined" / "[object Object]" into the key.
  assert.equal(normalizedChannel(undefined), "");
  assert.equal(normalizedChannel(null), "");
  assert.equal(normalizedChannel(""), "");
  assert.equal(normalizedChannel("   "), "");
  assert.equal(normalizedChannel({}), "[object object]");
  // Numbers and booleans coerce to their string form — the route layer
  // is responsible for type validation, the normaliser just keeps the
  // shape predictable so the key never holds surprises.
  assert.equal(normalizedChannel(123), "123");
  assert.equal(normalizedChannel(true), "true");
});

// --- heartbeatPresence: input validation --------------------------------

test("heartbeatPresence: rejects an empty unit id", () => {
  const r = heartbeatPresence(uniqueAgency(), "", "Dispatch");
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_unit_or_channel");
});

test("heartbeatPresence: rejects whitespace-only unit ids", () => {
  // The unit id is upper-cased and trimmed; a pure-whitespace string
  // collapses to "" and must be refused so a misconfigured handset
  // can't silently register as the empty unit and dominate the count.
  for (const bad of ["   ", "\t", "\n", "  \t  "]) {
    const r = heartbeatPresence(uniqueAgency(), bad, "Dispatch");
    assert.equal(r.ok, false, `unit=${JSON.stringify(bad)} should be refused`);
    assert.equal(r.error, "bad_unit_or_channel");
  }
});

test("heartbeatPresence: rejects null / undefined / empty-array unit ids (coerce to '')", () => {
  // The route hands us `req.body?.unit_id` raw. Anything whose
  // `String(value ?? "").trim()` lands on the empty string must be
  // refused so a misconfigured handset can't silently register as
  // the empty unit.
  for (const bad of [undefined, null, []] as const) {
    const r = heartbeatPresence(uniqueAgency(), bad, "Dispatch");
    assert.equal(r.ok, false, `unit=${JSON.stringify(bad)} should be refused`);
    assert.equal(r.error, "bad_unit_or_channel");
  }
});

test("heartbeatPresence: known coercion gap — non-empty non-string unit ids land as their String() form", () => {
  // The current contract is "tolerant of weird input via String()
  // coercion" rather than "strictly typed". This test pins that
  // behaviour so the route layer (which is the actual type-validation
  // boundary) is the thing that has to refuse — if `presence.ts`
  // ever tightens to reject non-strings outright, this assertion
  // will fail and force a deliberate review of the route layer.
  const agencyId = uniqueAgency();
  // `0` coerces to "0" (truthy after trim).
  assert.equal(heartbeatPresence(agencyId, 0, "Dispatch").ok, true);
  // `{}` coerces to "[object Object]" (truthy after trim).
  assert.equal(heartbeatPresence(agencyId, {}, "Dispatch").ok, true);
  // Together they land as two distinct presence entries, since the
  // upper-cased Map keys differ ("0" vs "[OBJECT OBJECT]").
  assert.equal(countPresence(agencyId, "Dispatch"), 2);
});

test("heartbeatPresence: rejects an empty channel", () => {
  for (const bad of ["", "   ", undefined, null]) {
    const r = heartbeatPresence(uniqueAgency(), "UNIT-1", bad);
    assert.equal(r.ok, false, `channel=${JSON.stringify(bad)} should be refused`);
    assert.equal(r.error, "bad_unit_or_channel");
  }
});

test("heartbeatPresence: rejects the '----' sentinel channel", () => {
  // The Android client sends "----" to mean "tuned to no channel"; if
  // the server accepted it, every off-channel handset would pile into
  // a phantom presence bucket and inflate counts for any dispatcher
  // who ever queried that literal string.
  const r = heartbeatPresence(uniqueAgency(), "UNIT-1", "----");
  assert.equal(r.ok, false);
  assert.equal(r.error, "bad_unit_or_channel");
});

// --- heartbeatPresence: counting + normalisation ------------------------

test("heartbeatPresence: a single heartbeat makes the unit visible to countPresence", () => {
  const agencyId = uniqueAgency();
  const r = heartbeatPresence(agencyId, "UNIT-7", "Dispatch");
  assert.equal(r.ok, true);
  assert.equal(r.error, undefined);
  assert.equal(countPresence(agencyId, "Dispatch"), 1);
});

test("heartbeatPresence: distinct units on the same channel are counted independently", () => {
  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "A-1", "Tac 1");
  heartbeatPresence(agencyId, "A-2", "Tac 1");
  heartbeatPresence(agencyId, "A-3", "Tac 1");
  assert.equal(countPresence(agencyId, "Tac 1"), 3);
});

test("heartbeatPresence: re-registering the same unit does NOT double-count", () => {
  // The Map keys by upper-cased unit id, so a second heartbeat from
  // the same handset just refreshes its TTL — the dispatcher's badge
  // must stay at 1, not climb to N over time.
  const agencyId = uniqueAgency();
  for (let i = 0; i < 5; i++) {
    heartbeatPresence(agencyId, "UNIT-1", "Dispatch");
  }
  assert.equal(countPresence(agencyId, "Dispatch"), 1);
});

test("heartbeatPresence: unit id is upper-cased so casing variants collapse to one entry", () => {
  // The Android side reports "UNIT-1" upper-case, the iOS side sends
  // it lower-cased; both must land on the same Map key or one handset
  // would silently count as two units after a hand-off.
  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "unit-1", "Dispatch");
  heartbeatPresence(agencyId, "Unit-1", "Dispatch");
  heartbeatPresence(agencyId, "UNIT-1", "Dispatch");
  assert.equal(countPresence(agencyId, "Dispatch"), 1);
});

test("heartbeatPresence: unit id is trimmed of surrounding whitespace", () => {
  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "  UNIT-1  ", "Dispatch");
  heartbeatPresence(agencyId, "UNIT-1", "Dispatch");
  assert.equal(countPresence(agencyId, "Dispatch"), 1);
});

test("heartbeatPresence: channel normalisation collapses casing/whitespace variants to one bucket", () => {
  // The writer side normalises with `normalizedChannel`, and the
  // reader side does the same. Sloppy inputs from either side must
  // converge on a single bucket or the dispatcher would see a fresh
  // "0 units" the moment a heartbeat happened to arrive with extra
  // whitespace.
  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "U1", "Tac 1");
  heartbeatPresence(agencyId, "U2", "TAC 1");
  heartbeatPresence(agencyId, "U3", "  tac   1  ");
  assert.equal(countPresence(agencyId, "tac 1"), 3);
  assert.equal(countPresence(agencyId, "Tac 1"), 3);
  assert.equal(countPresence(agencyId, "TAC  1"), 3);
});

// --- multi-tenant isolation ---------------------------------------------

test("heartbeatPresence: two agencies on the same channel name are fully isolated", () => {
  // This is the cross-tenant leak guard. If `presenceKey` ever stops
  // namespacing by agencyId, agency A's units would appear in agency
  // B's dispatcher screen — a serious privacy + safety bug.
  const agencyA = uniqueAgency();
  const agencyB = uniqueAgency();
  heartbeatPresence(agencyA, "A1", "Dispatch");
  heartbeatPresence(agencyA, "A2", "Dispatch");
  heartbeatPresence(agencyB, "B1", "Dispatch");
  assert.equal(countPresence(agencyA, "Dispatch"), 2);
  assert.equal(countPresence(agencyB, "Dispatch"), 1);
});

test("heartbeatPresence: a unit registered against one agency is invisible to a different agency", () => {
  // Belt-and-suspenders on the above: even a perfectly-matching unit
  // id must not surface across the tenancy boundary.
  const agencyA = uniqueAgency();
  const agencyB = uniqueAgency();
  heartbeatPresence(agencyA, "UNIT-1", "Dispatch");
  assert.equal(countPresence(agencyA, "Dispatch"), 1);
  assert.equal(countPresence(agencyB, "Dispatch"), 0);
});

// --- countPresence: empty + unknown -------------------------------------

test("countPresence: returns 0 for a channel no unit ever heartbeated on", () => {
  // The dispatcher polls this endpoint for every channel in the list,
  // including ones nobody's listening on. The function must return 0
  // (not throw, not return undefined) so the UI badge renders cleanly.
  const agencyId = uniqueAgency();
  assert.equal(countPresence(agencyId, "NeverHeardOf"), 0);
});

test("countPresence: returns 0 for an empty / whitespace / null channel query", () => {
  const agencyId = uniqueAgency();
  // Pre-register some units so the test would catch a regression that
  // silently returned the whole-agency unit count on an empty query.
  heartbeatPresence(agencyId, "U1", "Dispatch");
  assert.equal(countPresence(agencyId, ""), 0);
  assert.equal(countPresence(agencyId, "   "), 0);
  assert.equal(countPresence(agencyId, undefined), 0);
  assert.equal(countPresence(agencyId, null), 0);
});

// --- TTL pruning --------------------------------------------------------

test("countPresence: prunes entries whose last heartbeat is older than the 45s TTL", async (t) => {
  // The TTL is 45s; we mock Date so the test doesn't take 45 seconds
  // to run. Mocking `Date` (and `setTimeout` / `setInterval`) is the
  // documented use of `mock.timers.enable` in node:test.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "U1", "Dispatch");
  heartbeatPresence(agencyId, "U2", "Dispatch");
  assert.equal(countPresence(agencyId, "Dispatch"), 2);

  // Just shy of TTL — both entries still alive.
  t.mock.timers.tick(44_000);
  assert.equal(countPresence(agencyId, "Dispatch"), 2);

  // Past TTL — both pruned.
  t.mock.timers.tick(2_000);
  assert.equal(countPresence(agencyId, "Dispatch"), 0);
});

test("countPresence: a refreshed heartbeat keeps the unit alive past the original TTL window", async (t) => {
  // A healthy handset polls every ~12s; the most-recent heartbeat
  // must reset the TTL so a long-running radio session doesn't drop
  // off the dispatcher's count just because the FIRST heartbeat was
  // ages ago.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "U1", "Dispatch");
  t.mock.timers.tick(30_000);
  heartbeatPresence(agencyId, "U1", "Dispatch"); // refresh
  t.mock.timers.tick(30_000); // 60s total, but only 30s since refresh
  assert.equal(
    countPresence(agencyId, "Dispatch"),
    1,
    "refreshed heartbeat should keep the unit visible past the original 45s window",
  );
});

test("countPresence: prunes the channel itself once all of its units expire", async (t) => {
  // The pruner deletes the whole channel entry when its last unit
  // goes stale, so the count must drop back to 0 once everyone has
  // timed out — not stay at 1+ because of a dangling empty bucket.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "U1", "Dispatch");
  heartbeatPresence(agencyId, "U2", "Dispatch");
  heartbeatPresence(agencyId, "U3", "Dispatch");
  assert.equal(countPresence(agencyId, "Dispatch"), 3);

  t.mock.timers.tick(60_000);

  // After full TTL has elapsed for everyone, the count must be 0
  // and stay 0 on subsequent reads.
  assert.equal(countPresence(agencyId, "Dispatch"), 0);
  assert.equal(countPresence(agencyId, "Dispatch"), 0);
});

test("countPresence: pruning only drops stale units, not fresh ones in the same channel", async (t) => {
  // Mixed-age units in the same channel: the older one ages out, the
  // newer one stays. A regression that pruned by-channel rather than
  // by-unit would drop the whole channel as soon as ONE unit went
  // stale.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "OLD", "Dispatch");
  t.mock.timers.tick(40_000);
  heartbeatPresence(agencyId, "NEW", "Dispatch");
  // OLD now 40s old, NEW is 0s old; both still visible.
  assert.equal(countPresence(agencyId, "Dispatch"), 2);

  // Tick another 10s: OLD is now 50s (>TTL), NEW is 10s (<TTL).
  t.mock.timers.tick(10_000);
  assert.equal(countPresence(agencyId, "Dispatch"), 1);
});

test("heartbeatPresence: registering a new unit also opportunistically prunes stale ones", async (t) => {
  // The internal `prunePresence` runs on every heartbeat AND every
  // count read. This pins the heartbeat-side pruning behaviour so a
  // refactor that moved pruning out of the write path doesn't let
  // stale entries persist indefinitely between count reads.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

  const agencyId = uniqueAgency();
  heartbeatPresence(agencyId, "STALE", "Dispatch");
  t.mock.timers.tick(60_000); // STALE is now well past TTL

  // A fresh heartbeat on a SEPARATE channel must still trigger
  // pruning on Dispatch — the pruner sweeps the whole presence Map,
  // not just the channel the write landed on.
  heartbeatPresence(agencyId, "FRESH", "OtherChannel");

  // STALE should have been swept out; Dispatch count is back to 0.
  assert.equal(countPresence(agencyId, "Dispatch"), 0);
  assert.equal(countPresence(agencyId, "OtherChannel"), 1);
});
