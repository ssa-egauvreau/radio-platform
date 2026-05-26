/**
 * Regression tests for the API surface of the live-control "move lock"
 * counting helpers in `server/src/voiceRelay.ts`.
 *
 * Background — why this file exists
 * --------------------------------
 *
 * The repository carries TWO public counting helpers because each was
 * introduced by a separate PR and each is exercised by a different
 * pre-existing regression suite:
 *
 *   - `computeUnitChannelCounts(records, agencyId)`        (PR #136)
 *       → tested by `voiceRelay/unitChannelCounts.test.ts`
 *
 *   - `unitChannelCountsFromRecords(agencyId, records)`    (PR #149)
 *       → tested by `voiceRelayMoveLock.test.ts`
 *
 * They MUST stay observationally equivalent. A bad three-way merge that
 * branched their implementations was the root cause of the crash that
 * PRs #149/#150/#151 chased in production (`voiceRelay.ts` ended up with
 * two different `unitChannelCounts` bodies and a truncated
 * `unitChannelCountsFromRecords` signature, taking the whole server
 * down). The fix unified both as aliases of a single backing
 * implementation; these tests pin that contract so a future refactor
 * that drops the alias or quietly diverges its filtering rules trips
 * here instead of in production.
 *
 * What this file covers that the pre-existing suites do not
 * ------------------------------------------------------------
 *
 *  1. Both APIs MUST return Maps with the same keys + same values for
 *     every record shape the relay actually produces (account /
 *     legacy / bridge × dispatch_console / unit_radio / phone / null
 *     × web / desktop / android / ios). Either suite alone only
 *     covers half of the cross-product.
 *
 *  2. Both APIs MUST apply the PR #149 "null deviceType on a web or
 *     desktop client still counts as a console session" fallback.
 *     `voiceRelay/unitChannelCounts.test.ts` predates that rule and
 *     does not pass a `client` field, so it does not exercise it
 *     through `computeUnitChannelCounts` — meaning a regression that
 *     re-split the implementations could leave `computeUnitChannelCounts`
 *     ignoring web/desktop fallback without any pre-existing test
 *     catching it.
 *
 *  3. The argument ORDER difference is part of the contract: callers
 *     of the older `computeUnitChannelCounts` pass `(records, agencyId)`,
 *     callers of `unitChannelCountsFromRecords` pass `(agencyId, records)`.
 *     A merge that "fixed" one to match the other would silently flip
 *     every existing call site.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeUnitChannelCounts,
  unitChannelCountsFromRecords,
  type UnitChannelCountRecord,
} from "../src/voiceRelay.js";

/** Build a roster record with sensible defaults. */
function record(
  overrides: Partial<UnitChannelCountRecord> & {
    agencyId: number;
    channelName: string;
    unitId: string;
  },
): UnitChannelCountRecord {
  const { agencyId, channelName, unitId, ...rest } = overrides;
  return {
    channelKey: `${agencyId} ${channelName.toLowerCase()}`,
    channelName,
    unitId,
    kind: "account",
    client: "android",
    deviceType: "dispatch_console",
    ...rest,
  };
}

/** Assert that two Maps have identical key/value pairs (order-agnostic). */
function assertMapsEqual(
  actual: Map<string, number>,
  expected: Map<string, number>,
  message?: string,
): void {
  assert.equal(
    actual.size,
    expected.size,
    `${message ?? ""} sizes differ (actual=${actual.size}, expected=${expected.size})`,
  );
  for (const [k, v] of expected) {
    assert.equal(
      actual.get(k),
      v,
      `${message ?? ""} key=${k}: actual=${actual.get(k)}, expected=${v}`,
    );
  }
}

/**
 * Run a fixture through BOTH counting APIs and assert they produced the
 * exact same Map. Returns the (shared) Map for any additional pointwise
 * assertions the caller wants to make.
 */
function bothCounts(
  agencyId: number,
  records: UnitChannelCountRecord[],
): Map<string, number> {
  const viaCompute = computeUnitChannelCounts(records, agencyId);
  const viaFromRecords = unitChannelCountsFromRecords(agencyId, records);
  assertMapsEqual(
    viaFromRecords,
    viaCompute,
    "computeUnitChannelCounts and unitChannelCountsFromRecords diverged —",
  );
  return viaCompute;
}

test("alias-equivalence: both APIs agree on the all-console happy path", () => {
  const counts = bothCounts(1, [
    record({ agencyId: 1, channelName: "Green 1", unitId: "DISP1" }),
    record({ agencyId: 1, channelName: "Green 2", unitId: "DISP1" }),
    record({ agencyId: 1, channelName: "Green 3", unitId: "DISP1" }),
  ]);
  assert.equal(counts.get("DISP1"), 3);
});

test("alias-equivalence: both APIs apply the PR #149 web+null-deviceType fallback", () => {
  // This is the rule the older `voiceRelay/unitChannelCounts.test.ts`
  // does NOT exercise (no `client` field on its fixtures). A regression
  // that re-split the two implementations could silently restore the
  // pre-#149 behavior in `computeUnitChannelCounts` only.
  const counts = bothCounts(7, [
    record({
      agencyId: 7,
      channelName: "Patrol 1",
      unitId: "DISP-A",
      client: "web",
      deviceType: null,
    }),
    record({
      agencyId: 7,
      channelName: "Patrol 2",
      unitId: "DISP-A",
      client: "desktop",
      deviceType: null,
    }),
  ]);
  assert.equal(
    counts.get("DISP-A"),
    2,
    "web+null and desktop+null on different channels MUST both count",
  );
});

test("alias-equivalence: both APIs reject phone/ios/android accounts with null deviceType", () => {
  // The fallback rule is `client === 'web' || client === 'desktop'` —
  // an iOS or Android handset whose deviceType lookup raced the join
  // must NOT be counted.
  const counts = bothCounts(11, [
    record({
      agencyId: 11,
      channelName: "C1",
      unitId: "U-1",
      client: "ios",
      deviceType: null,
    }),
    record({
      agencyId: 11,
      channelName: "C2",
      unitId: "U-1",
      client: "android",
      deviceType: null,
    }),
    record({
      agencyId: 11,
      channelName: "C3",
      unitId: "U-1",
      client: "ios",
      deviceType: "phone",
    }),
  ]);
  assert.equal(
    counts.size,
    0,
    "handset accounts with no explicit dispatch_console deviceType must not lock",
  );
});

test("alias-equivalence: both APIs ignore legacy and bridge kinds even on dispatch_console", () => {
  const counts = bothCounts(2, [
    record({
      agencyId: 2,
      channelName: "Green 1",
      unitId: "BRIDGE",
      kind: "bridge",
      deviceType: "dispatch_console",
    }),
    record({
      agencyId: 2,
      channelName: "Green 2",
      unitId: "BRIDGE",
      kind: "bridge",
      deviceType: "dispatch_console",
    }),
    record({
      agencyId: 2,
      channelName: "Green 1",
      unitId: "LEG",
      kind: "legacy",
      deviceType: "dispatch_console",
    }),
    record({
      agencyId: 2,
      channelName: "Green 2",
      unitId: "LEG",
      kind: "legacy",
      deviceType: "dispatch_console",
    }),
  ]);
  assert.equal(counts.size, 0);
});

test("alias-equivalence: both APIs honor the exact agency-id prefix (7 vs 70)", () => {
  // The channel-key prefix is "${agencyId} " (trailing space). Without
  // the space, agency 70 would leak into agency 7's counts via String
  // .startsWith. A regression that dropped the space from one helper
  // but not the other would surface here.
  const records: UnitChannelCountRecord[] = [
    record({ agencyId: 7, channelName: "G1", unitId: "U-7" }),
    record({ agencyId: 70, channelName: "G1", unitId: "U-7" }),
    record({ agencyId: 70, channelName: "G2", unitId: "U-7" }),
  ];
  const ag7 = bothCounts(7, records);
  const ag70 = bothCounts(70, records);
  assert.equal(ag7.get("U-7"), 1, "agency 7 must not see agency 70's record");
  assert.equal(ag70.get("U-7"), 2, "agency 70 sees both of its own records");
});

test("alias-equivalence: both APIs case-fold unit ids to upper-case", () => {
  const counts = bothCounts(1, [
    record({ agencyId: 1, channelName: "G1", unitId: "disp-1" }),
    record({ agencyId: 1, channelName: "G2", unitId: "DISP-1" }),
    record({ agencyId: 1, channelName: "G3", unitId: "Disp-1" }),
  ]);
  assert.equal(counts.size, 1);
  assert.equal(counts.get("DISP-1"), 3);
});

test("alias-equivalence: both APIs dedupe duplicate (unit, channel) pairs", () => {
  // The relay re-seats a roster record on every `join` — a duplicate
  // (unit, channel) row is expected and must NOT inflate the count past
  // the number of distinct channels.
  const counts = bothCounts(1, [
    record({ agencyId: 1, channelName: "Green 1", unitId: "DISP1" }),
    record({ agencyId: 1, channelName: "Green 1", unitId: "DISP1" }),
    record({ agencyId: 1, channelName: "Green 1", unitId: "DISP1" }),
    record({ agencyId: 1, channelName: "Green 2", unitId: "DISP1" }),
  ]);
  assert.equal(counts.get("DISP1"), 2);
});

test("alias-equivalence: empty input → empty Map (and both APIs return a NEW Map)", () => {
  const a = computeUnitChannelCounts([], 1);
  const b = unitChannelCountsFromRecords(1, []);
  assert.equal(a.size, 0);
  assert.equal(b.size, 0);
  // The two APIs must hand back DISTINCT Map instances — if one were
  // returning the other's underlying map, mutating one would corrupt
  // the other. Defensive: we never expect a caller to mutate the
  // returned map, but the contract is "fresh Map per call".
  assert.notEqual(a, b, "each call must produce a fresh Map");
});

test("alias-equivalence: argument order is not interchangeable (regression guard)", () => {
  // If a future change "fixed" the argument order of one helper to match
  // the other, calling computeUnitChannelCounts(agencyId, records) would
  // hit a runtime TypeError because `records` would be a number — but
  // TypeScript would let it through if the signature were silently
  // swapped. This test pins the ORDER that production code uses today.
  const records = [record({ agencyId: 5, channelName: "G1", unitId: "U-1" })];
  assert.equal(computeUnitChannelCounts(records, 5).get("U-1"), 1);
  assert.equal(unitChannelCountsFromRecords(5, records).get("U-1"), 1);

  // And the OTHER agency id must produce an empty result with the same
  // records — confirming the second positional argument really is the
  // agency filter (in each helper's chosen order).
  assert.equal(computeUnitChannelCounts(records, 9).size, 0);
  assert.equal(unitChannelCountsFromRecords(9, records).size, 0);
});

test("alias-equivalence: large mixed roster — same Map content from both APIs", () => {
  // End-to-end fixture combining every gotcha at once.
  const records: UnitChannelCountRecord[] = [
    // DISP-A: a console on 3 channels (count = 3)
    record({ agencyId: 100, channelName: "C1", unitId: "DISP-A" }),
    record({ agencyId: 100, channelName: "C2", unitId: "disp-a" }),
    record({ agencyId: 100, channelName: "C3", unitId: "DISP-A" }),
    // DISP-A duplicate row on C1 — dedup must keep count at 3
    record({ agencyId: 100, channelName: "C1", unitId: "DISP-A" }),
    // DISP-B: web with null deviceType across 2 channels (count = 2 via #149)
    record({
      agencyId: 100,
      channelName: "C1",
      unitId: "DISP-B",
      client: "web",
      deviceType: null,
    }),
    record({
      agencyId: 100,
      channelName: "C2",
      unitId: "DISP-B",
      client: "web",
      deviceType: null,
    }),
    // U-IOS: ios handset on 2 channels — must NOT lock (count = absent)
    record({
      agencyId: 100,
      channelName: "C1",
      unitId: "U-IOS",
      client: "ios",
      deviceType: "phone",
    }),
    record({
      agencyId: 100,
      channelName: "C2",
      unitId: "U-IOS",
      client: "ios",
      deviceType: "phone",
    }),
    // Bridge — never counted
    record({
      agencyId: 100,
      channelName: "C1",
      unitId: "BR",
      kind: "bridge",
      deviceType: "dispatch_console",
    }),
    // Different agency — never counted from agency 100
    record({ agencyId: 200, channelName: "X1", unitId: "DISP-A" }),
  ];
  const counts = bothCounts(100, records);
  assert.equal(counts.get("DISP-A"), 3);
  assert.equal(counts.get("DISP-B"), 2);
  assert.equal(counts.get("U-IOS"), undefined);
  assert.equal(counts.get("BR"), undefined);
  assert.equal(counts.size, 2);
});
