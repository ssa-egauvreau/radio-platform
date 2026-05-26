/**
 * Regression — `unitChannelCountsFromRecords(agencyId, records)` and
 * `computeUnitChannelCounts(records, agencyId)` MUST return identical maps.
 *
 * Context: the merge of PR #150 (which extracted `computeUnitChannelCounts`
 * for the PR #136 pin-tests) and PR #149 (which added the more permissive
 * `unitChannelCountsFromRecords` to recognise web/desktop dispatch consoles
 * with `deviceType=null`) landed two competing copies of the function in
 * `voiceRelay.ts` with the alias forwarding broken by a misplaced doc
 * comment. The branch failed `tsc --noEmit` and every Live Channel Control
 * roster computation in production would have thrown at module load.
 *
 * The recovery commit unifies the two names: one is now an argument-flipped
 * alias of the other. These tests pin that contract so any future change
 * that re-introduces two parallel implementations (and silently diverges on
 * the web/desktop predicate, agency scoping, or case-folding) fails loud.
 *
 * What this catches that the per-function suites do not:
 *  - The two functions share the same predicate (PR #149's behavior is the
 *    source of truth, including the "web/desktop account with null
 *    deviceType counts" rule that PR #150's predecessor was stricter on).
 *  - The argument order on the alias is `(agencyId, records)` — flipping it
 *    would silently produce empty maps because the prefix wouldn't match.
 *  - Both names return value-equal maps for the same input, so call sites
 *    can be migrated either way without a behavior change.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeUnitChannelCounts,
  unitChannelCountsFromRecords,
  type UnitChannelCountRecord,
} from "../../src/voiceRelay.js";

/** Compact assertion: two count maps have identical (key, value) pairs. */
function assertSameCounts(a: Map<string, number>, b: Map<string, number>) {
  assert.equal(a.size, b.size, "map sizes differ");
  for (const [unit, count] of a) {
    assert.equal(b.get(unit), count, `count for ${unit} differs`);
  }
}

test("alias: both names return identical maps for a mixed roster", () => {
  const records: UnitChannelCountRecord[] = [
    // dispatch_console — counted by both predicates
    {
      channelKey: "5 alpha",
      channelName: "Alpha",
      unitId: "DISP-1",
      kind: "account",
      deviceType: "dispatch_console",
    },
    {
      channelKey: "5 bravo",
      channelName: "Bravo",
      unitId: "disp-1",
      kind: "account",
      deviceType: "dispatch_console",
    },
    // web account with null deviceType — counted (PR #149 fix)
    {
      channelKey: "5 charlie",
      channelName: "Charlie",
      unitId: "SCAN-2",
      kind: "account",
      client: "web",
      deviceType: null,
    },
    // legacy/bridge — never counted
    {
      channelKey: "5 alpha",
      channelName: "Alpha",
      unitId: "BRIDGE-1",
      kind: "bridge",
      deviceType: "dispatch_console",
    },
    // other agency — must be ignored regardless of which name is used
    {
      channelKey: "9 alpha",
      channelName: "Alpha",
      unitId: "DISP-1",
      kind: "account",
      deviceType: "dispatch_console",
    },
  ];

  const viaCompute = computeUnitChannelCounts(records, 5);
  const viaAlias = unitChannelCountsFromRecords(5, records);

  assertSameCounts(viaCompute, viaAlias);
  // And spot-check the actual counts to make sure the test isn't vacuous
  // (e.g. both functions returning empty maps would also pass `assertSameCounts`).
  assert.equal(viaCompute.get("DISP-1"), 2, "DISP-1 should be counted on 2 channels");
  assert.equal(viaCompute.get("SCAN-2"), 1, "web/null-deviceType account counts");
  assert.equal(viaCompute.get("BRIDGE-1"), undefined, "bridge never counts");
});

test("alias: empty inputs round-trip identically", () => {
  const viaCompute = computeUnitChannelCounts([], 1);
  const viaAlias = unitChannelCountsFromRecords(1, []);
  assertSameCounts(viaCompute, viaAlias);
  assert.equal(viaAlias.size, 0);
});

test("alias: same agency-id prefix scoping on both names (no agency-7 leakage into agency-77)", () => {
  // The shared predicate uses `${agencyId} ` (trailing space) as the prefix,
  // so an agency-7 record must not be counted for agency 77 — regardless of
  // which entry point the caller uses.
  const records: UnitChannelCountRecord[] = [
    {
      channelKey: "7 alpha",
      channelName: "Alpha",
      unitId: "X",
      kind: "account",
      deviceType: "dispatch_console",
    },
    {
      channelKey: "77 alpha",
      channelName: "Alpha",
      unitId: "X",
      kind: "account",
      deviceType: "dispatch_console",
    },
  ];

  const seven = unitChannelCountsFromRecords(7, records);
  const sevenViaCompute = computeUnitChannelCounts(records, 7);
  assertSameCounts(seven, sevenViaCompute);
  assert.equal(seven.get("X"), 1, "only the 7-prefixed record matches");

  const seventySeven = unitChannelCountsFromRecords(77, records);
  const seventySevenViaCompute = computeUnitChannelCounts(records, 77);
  assertSameCounts(seventySeven, seventySevenViaCompute);
  assert.equal(seventySeven.get("X"), 1, "only the 77-prefixed record matches");
});

test("alias: PR #149 predicate is the source of truth (web/desktop with null deviceType counts on BOTH names)", () => {
  // Pre-merge, PR #150's `computeUnitChannelCounts` was stricter (counted
  // only `deviceType === "dispatch_console"`). PR #149's fix relaxed the
  // predicate for the web/desktop case. The recovery commit picked PR
  // #149's behavior for both function names — this test pins that choice
  // so any future change that re-tightens the predicate behind one name
  // (and silently splits the two implementations) fails loud.
  const records: UnitChannelCountRecord[] = [
    {
      channelKey: "1 alpha",
      channelName: "Alpha",
      unitId: "DISP-1",
      kind: "account",
      client: "web",
      deviceType: null,
    },
    {
      channelKey: "1 bravo",
      channelName: "Bravo",
      unitId: "DISP-1",
      kind: "account",
      client: "desktop",
      deviceType: null,
    },
  ];

  const viaCompute = computeUnitChannelCounts(records, 1);
  const viaAlias = unitChannelCountsFromRecords(1, records);
  assertSameCounts(viaCompute, viaAlias);
  assert.equal(viaCompute.get("DISP-1"), 2, "web + desktop with null deviceType both count");
});

test("alias: undefined client + null deviceType is NOT a console on BOTH names", () => {
  // A roster row without a `client` field (legacy import path or test
  // fixture omitting the field) must not be promoted to console status.
  // Pin the conservative default that survived the merge.
  const records: UnitChannelCountRecord[] = [
    {
      channelKey: "1 alpha",
      channelName: "Alpha",
      unitId: "U",
      kind: "account",
      deviceType: null,
    },
    {
      channelKey: "1 bravo",
      channelName: "Bravo",
      unitId: "U",
      kind: "account",
      deviceType: null,
    },
  ];

  const viaCompute = computeUnitChannelCounts(records, 1);
  const viaAlias = unitChannelCountsFromRecords(1, records);
  assertSameCounts(viaCompute, viaAlias);
  assert.equal(viaCompute.size, 0);
});
