/**
 * Regression: pin the public API surface of the live-control move-lock helpers
 * in `server/src/voiceRelay.ts`.
 *
 * Why this exists — context from the broken-merge incident on main at
 * commit 203eae4: three separate PRs (#136 / #149 / #150) each landed their
 * own variant of the "how many channels is this unit dispatching on?" helper
 * (`computeUnitChannelCounts(records, agencyId)` and
 * `unitChannelCountsFromRecords(agencyId, records)`) plus the dispatch-
 * console-aware `unitChannelCounts(agencyId)` that production code calls.
 *
 * The successive merges produced a file that failed to parse:
 *
 *     src/voiceRelay.ts(411,2): error TS1003: Identifier expected.
 *
 * which in turn took out the entire server test suite (every test file that
 * transitively imports `voiceRelay.ts` failed to load). That regression is
 * exactly the kind of thing the existing per-PR move-lock suites cannot
 * catch on their own — each one only verifies that *their* preferred
 * spelling resolves, so a merge that picks one and drops the others silently
 * breaks the unrelated suite without any single test naming the issue.
 *
 * What we pin here:
 *
 *  1. All three public counter entry points exist as functions. A future
 *     refactor that consolidates them must consciously update this test
 *     (and migrate the call sites in the same change set).
 *  2. The two pure record-iterating variants produce identical results for
 *     the same inputs regardless of argument order. That guarantees the
 *     "two parallel suites pinning the same rule" arrangement remains
 *     correct: a fix in one spelling is automatically a fix in the other.
 *  3. The agency-scoped `unitChannelCounts` and `isUnitMoveLocked` paths
 *     stay observable via the test-only roster seed/reset helpers — these
 *     are the only way unit tests can drive the in-memory voice roster
 *     without standing up a WebSocket server, so silently dropping them
 *     would make the entire suite go untested.
 *  4. The move-lock decision agrees with the count under the exact rule:
 *     account-kind + (dispatch_console OR multi-channel) → locked.
 *
 * The blast radius of a regression in these primitives is large and
 * silent: it breaks drag-drop in Live Channel Control for any operator
 * with the dispatch console open on more than one channel (a real-world
 * bug PR #140 fixed) without producing any user-visible error.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as voiceRelay from "../../src/voiceRelay.js";
import {
  __resetVoiceRosterForTest,
  __setVoiceRosterRecordForTest,
  computeUnitChannelCounts,
  isUnitMoveLocked,
  unitChannelCounts,
  unitChannelCountsFromRecords,
  withRosterMoveLock,
  type RosterMember,
  type UnitChannelCountRecord,
} from "../../src/voiceRelay.js";

test("voiceRelay exports every public move-lock helper (broken-merge canary)", () => {
  const required = [
    "unitChannelCounts",
    "unitChannelCountsFromRecords",
    "computeUnitChannelCounts",
    "withRosterMoveLock",
    "isUnitMoveLocked",
    "__setVoiceRosterRecordForTest",
    "__resetVoiceRosterForTest",
  ] as const;
  for (const name of required) {
    assert.equal(
      typeof (voiceRelay as Record<string, unknown>)[name],
      "function",
      `voiceRelay.${name} must be exported as a function (regression: parallel PR merge dropped it)`,
    );
  }
});

test("computeUnitChannelCounts and unitChannelCountsFromRecords are interchangeable for the same inputs", () => {
  // Both spellings are public because two parallel regression suites
  // pinned the same rule under different names. If a future change makes
  // them disagree, the two test suites will start contradicting each
  // other; pin equivalence here so the divergence is caught directly.
  const fixture: UnitChannelCountRecord[] = [
    {
      channelKey: "5 alpha",
      channelName: "Alpha",
      unitId: "DISP-A",
      kind: "account",
      deviceType: "dispatch_console",
    },
    {
      channelKey: "5 bravo",
      channelName: "Bravo",
      unitId: "DISP-A",
      kind: "account",
      deviceType: null,
      client: "web",
    },
    // Different agency — must be filtered by both spellings.
    {
      channelKey: "6 alpha",
      channelName: "Alpha",
      unitId: "DISP-A",
      kind: "account",
      deviceType: "dispatch_console",
    },
    // Non-console session — never counts.
    {
      channelKey: "5 charlie",
      channelName: "Charlie",
      unitId: "USER-7",
      kind: "account",
      deviceType: "phone",
    },
  ];

  const viaCompute = computeUnitChannelCounts(fixture, 5);
  const viaRecords = unitChannelCountsFromRecords(5, fixture);

  assert.deepEqual(
    [...viaCompute.entries()].sort(),
    [...viaRecords.entries()].sort(),
    "the two helpers must produce identical counts for identical inputs",
  );
  // And the count itself is what we expect (DISP-A on 2 console channels in agency 5).
  assert.equal(viaCompute.get("DISP-A"), 2);
  assert.equal(viaCompute.get("USER-7"), undefined);
});

test("agency-scoped unitChannelCounts + isUnitMoveLocked stay wired to the roster seeders", () => {
  // If a refactor ever drops the `__setVoiceRosterRecordForTest` /
  // `__resetVoiceRosterForTest` test-only handles, the entire move-lock
  // test surface goes dark — there's no other way to seed the voice
  // roster without a full WebSocket upgrade. Exercise the whole chain end
  // to end here so a regression that removes (or no-ops) either handle
  // shows up in this single test rather than as silent skipped coverage
  // across the rest of the suite.
  __resetVoiceRosterForTest();
  try {
    __setVoiceRosterRecordForTest({
      agencyId: 31,
      channelName: "Ops 1",
      unitId: "DISP-X",
      kind: "account",
      client: "web",
      deviceType: "dispatch_console",
    });
    __setVoiceRosterRecordForTest({
      agencyId: 31,
      channelName: "Ops 2",
      unitId: "DISP-X",
      kind: "account",
      client: "desktop",
      deviceType: "dispatch_console",
    });
    // A different unit on a single channel — must NOT be locked.
    __setVoiceRosterRecordForTest({
      agencyId: 31,
      channelName: "Ops 1",
      unitId: "FIELD-9",
      kind: "account",
      client: "ios",
      deviceType: "phone",
    });

    const counts = unitChannelCounts(31);
    assert.equal(counts.get("DISP-X"), 2);
    assert.equal(counts.get("FIELD-9"), undefined);

    assert.equal(isUnitMoveLocked(31, "DISP-X"), true);
    assert.equal(isUnitMoveLocked(31, "field-9"), false);

    // A different agency must not see agency 31's roster.
    assert.equal(unitChannelCounts(32).size, 0);
    assert.equal(isUnitMoveLocked(32, "DISP-X"), false);
  } finally {
    __resetVoiceRosterForTest();
  }
});

test("withRosterMoveLock agrees with the count under the documented rule", () => {
  // Re-derive the lock decision from the count and assert
  // `withRosterMoveLock` produces the same result for every relevant
  // (kind, device_type, count) combination. This catches a regression
  // where `withRosterMoveLock` drifts away from the counter (e.g. starts
  // ignoring the count for `kind === "account"` with no device_type, or
  // re-introduces a lock for legacy sockets that the count never feeds).
  const members: RosterMember[] = [
    { unit_id: "A1", kind: "account", client: "web", device_type: "dispatch_console", display_name: null, connected_ms: 0 },
    { unit_id: "A2", kind: "account", client: "web", device_type: null, display_name: null, connected_ms: 0 },
    { unit_id: "A3", kind: "account", client: "ios", device_type: "phone", display_name: null, connected_ms: 0 },
    { unit_id: "L1", kind: "legacy", client: "android", device_type: null, display_name: null, connected_ms: 0 },
    { unit_id: "B1", kind: "bridge", client: "bridge", device_type: "dispatch_console", display_name: null, connected_ms: 0 },
  ];
  const counts = new Map<string, number>([
    ["A1", 1],
    ["A2", 2],
    ["A3", 2],
    ["L1", 5],
    ["B1", 5],
  ]);

  const out = withRosterMoveLock(members, counts);
  const lockedByUnit = new Map(out.map((m) => [m.unit_id, m.move_locked === true]));

  // A1: dispatch_console → always locked (count irrelevant).
  assert.equal(lockedByUnit.get("A1"), true);
  // A2: account, no dispatch_console, count > 1 → locked (multi-channel dispatcher).
  assert.equal(lockedByUnit.get("A2"), true);
  // A3: account, phone, count > 1 (stale carrier from older logic) → still
  // locked under the current rule (account + count > 1 → locked). This
  // pins the existing behavior so a re-tightening is a deliberate change.
  assert.equal(lockedByUnit.get("A3"), true);
  // Legacy + bridge: never locked, regardless of count or device_type.
  assert.equal(lockedByUnit.get("L1"), false);
  assert.equal(lockedByUnit.get("B1"), false);
});
