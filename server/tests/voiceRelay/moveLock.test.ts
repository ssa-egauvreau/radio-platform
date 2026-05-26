/**
 * Regression tests for the Live Channel Control "move lock" logic in
 * `server/src/voiceRelay.ts`.
 *
 * Two pure functions back the lock:
 *
 *   - {@link computeUnitChannelCounts} — counts how many distinct channels
 *     each unit is currently dispatching on. After PR #136 the count only
 *     includes `account` records whose `deviceType === "dispatch_console"`,
 *     so a user with their handset/phone on one channel and the dashboard
 *     open on another no longer trips the multi-channel scan signal.
 *
 *   - {@link withRosterMoveLock} — stamps `move_locked: true` on roster
 *     members that the live-control drag-drop must refuse to relocate.
 *     The rule is "account AND (dispatch_console device OR n > 1)" —
 *     legacy/bridge records (handset-via-radio-key, in-process bridge
 *     worker) are never locked regardless of count.
 *
 * Both functions are agency-scoped via the channelKey prefix `"${agencyId} "`
 * so two tenants with the same channel and unit ids stay isolated.
 *
 * A regression in either function silently breaks the dispatcher UX:
 *
 *   - If `computeUnitChannelCounts` stops filtering on dispatch_console,
 *     every admin who keeps the console open on one channel while also
 *     monitoring on their phone becomes undraggable — the exact bug the
 *     fix in #136 was reverting.
 *
 *   - If `withRosterMoveLock` stops locking dispatch-console operators,
 *     a drag in Live Control yanks the operator off their console mid-
 *     scan, which is the original guard the lock was added for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeUnitChannelCounts,
  withRosterMoveLock,
  type RosterRecord,
  type RosterMember,
} from "../../src/voiceRelay.js";

// ---------------------------------------------------------------------------
// Helpers — build the small immutable record shapes that the real WebSocket
// join path mutates into the module-private voiceRoster map. Tests only need
// the fields that the count / lock logic actually reads.
// ---------------------------------------------------------------------------

function record(over: Partial<RosterRecord> & { agencyId: number; channel: string }): RosterRecord {
  const channelNorm = over.channel.trim().toLowerCase();
  return {
    channelKey: `${over.agencyId} ${channelNorm}`,
    channelName: over.channel,
    unitId: "U-1",
    displayName: null,
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
    joinedAt: 0,
    ...over,
  };
}

function member(over: Partial<RosterMember> = {}): RosterMember {
  return {
    unit_id: "U-1",
    display_name: null,
    kind: "account",
    client: "web",
    device_type: "dispatch_console",
    connected_ms: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// computeUnitChannelCounts — the dispatch-console-only filter.
// ---------------------------------------------------------------------------

test("computeUnitChannelCounts: counts only dispatch_console sessions per unit", () => {
  // Dispatcher U-1 has the console open on Green 1 AND Blue 1: that's two
  // distinct dispatch channels and should be flagged as a multi-channel
  // scan (count = 2 → withRosterMoveLock will refuse to move them).
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "U-1", channel: "Green 1" }),
    record({ agencyId: 1, unitId: "U-1", channel: "Blue 1" }),
  ];
  const counts = computeUnitChannelCounts(records, 1);
  assert.equal(counts.get("U-1"), 2);
});

test("computeUnitChannelCounts: phone-on-A + console-on-B counts as ONE (the #136 bug fix)", () => {
  // Before the fix: a user with their phone (deviceType !== dispatch_console)
  // on channel A AND the dashboard open on channel B counted as n=2 and
  // became undraggable. After the fix, only the dispatch_console session
  // contributes — the phone session is ignored, so count = 1 and the user
  // stays movable.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "U-7", channel: "Green 1", deviceType: "phone" }),
    record({ agencyId: 1, unitId: "U-7", channel: "Blue 1", deviceType: "dispatch_console" }),
  ];
  const counts = computeUnitChannelCounts(records, 1);
  assert.equal(counts.get("U-7"), 1);
});

test("computeUnitChannelCounts: ignores legacy and bridge records entirely", () => {
  // A radio-key handset (legacy) and the in-process bridge worker can each
  // appear in the roster on multiple channels, but neither represents a
  // dispatch operator — they MUST NOT contribute to the lock count.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "RADIO-A", channel: "Green 1", kind: "legacy", deviceType: null }),
    record({ agencyId: 1, unitId: "RADIO-A", channel: "Blue 1", kind: "legacy", deviceType: null }),
    record({
      agencyId: 1,
      unitId: "BRIDGE-1",
      channel: "Green 1",
      kind: "bridge",
      deviceType: null,
    }),
    record({
      agencyId: 1,
      unitId: "BRIDGE-1",
      channel: "Blue 1",
      kind: "bridge",
      deviceType: null,
    }),
  ];
  const counts = computeUnitChannelCounts(records, 1);
  assert.equal(counts.size, 0, "non-account records must never contribute to counts");
});

test("computeUnitChannelCounts: same console session keyed on the same channel counts once", () => {
  // Multiple sockets for the same dispatcher on the same channel (e.g. a
  // browser reload race) must not double-count: the set is keyed on the
  // channel display name.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "U-1", channel: "Green 1" }),
    record({ agencyId: 1, unitId: "U-1", channel: "Green 1" }),
    record({ agencyId: 1, unitId: "U-1", channel: "Green 1" }),
  ];
  assert.equal(computeUnitChannelCounts(records, 1).get("U-1"), 1);
});

test("computeUnitChannelCounts: agency prefix isolates tenants with identical unit ids", () => {
  // Agency 1's U-1 is on two channels (locked); agency 2's U-1 is on one
  // channel (movable). The prefix filter must keep them strictly separate.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "U-1", channel: "Green 1" }),
    record({ agencyId: 1, unitId: "U-1", channel: "Blue 1" }),
    record({ agencyId: 2, unitId: "U-1", channel: "Green 1" }),
  ];
  const a1 = computeUnitChannelCounts(records, 1);
  const a2 = computeUnitChannelCounts(records, 2);
  assert.equal(a1.get("U-1"), 2, "agency 1's U-1 dispatches on two channels");
  assert.equal(a2.get("U-1"), 1, "agency 2's U-1 dispatches on one channel only");
});

test("computeUnitChannelCounts: agency prefix must match the leading 'N ' exactly", () => {
  // The prefix is `${agencyId} ` with a trailing SPACE, so agency 1 must
  // not pick up records for agency 11 (which both start with "1"). A
  // regression here would cross-leak tenants — the worst kind of bug.
  const records: RosterRecord[] = [
    record({ agencyId: 11, unitId: "U-1", channel: "Green 1" }),
    record({ agencyId: 11, unitId: "U-1", channel: "Blue 1" }),
  ];
  assert.equal(computeUnitChannelCounts(records, 1).size, 0);
  assert.equal(computeUnitChannelCounts(records, 11).get("U-1"), 2);
});

test("computeUnitChannelCounts: unit ids are upper-cased so case variants collapse", () => {
  // The same dispatcher reconnecting with "u-1" vs "U-1" (a casing slip
  // from an older client) must not count as two distinct units.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "u-1", channel: "Green 1" }),
    record({ agencyId: 1, unitId: "U-1", channel: "Blue 1" }),
  ];
  const counts = computeUnitChannelCounts(records, 1);
  assert.equal(counts.size, 1);
  assert.equal(counts.get("U-1"), 2);
});

test("computeUnitChannelCounts: empty input returns an empty map (no allocation surprises)", () => {
  assert.equal(computeUnitChannelCounts([], 1).size, 0);
});

test("computeUnitChannelCounts: a dispatch console on ONE channel is count 1, not omitted", () => {
  // The presence of a single-channel dispatch console MUST still register —
  // the route layer relies on `(counts.get(unit) ?? 0) > 1` semantics, but
  // omitting single-channel consoles from the map would have to be carefully
  // distinguished from "unit had no console at all" elsewhere. Better to
  // explicitly include n=1 entries so the contract is unambiguous.
  const records: RosterRecord[] = [
    record({ agencyId: 1, unitId: "U-9", channel: "Green 1" }),
  ];
  assert.equal(computeUnitChannelCounts(records, 1).get("U-9"), 1);
});

// ---------------------------------------------------------------------------
// withRosterMoveLock — the actual lock-stamping logic.
// ---------------------------------------------------------------------------

test("withRosterMoveLock: dispatch_console accounts are locked even when count <= 1", () => {
  // The original guard — a single-channel dispatch console is still a
  // dispatcher and must not be silently relocated by a UI drag.
  const counts = new Map<string, number>([["U-1", 1]]);
  const [m] = withRosterMoveLock([member({ device_type: "dispatch_console" })], counts);
  assert.equal(m!.move_locked, true);
});

test("withRosterMoveLock: dispatch_console accounts are locked even when not in counts at all", () => {
  // computeUnitChannelCounts only emits entries for units it observed.
  // A dispatch console that just joined a single channel may be in the
  // count map with n=1, but absence (n defaults to 0) must still lock.
  const counts = new Map<string, number>();
  const [m] = withRosterMoveLock([member({ device_type: "dispatch_console" })], counts);
  assert.equal(m!.move_locked, true);
});

test("withRosterMoveLock: account with n > 1 is locked (multi-channel scan)", () => {
  // A non-console account with count > 1 should not happen after the #136
  // fix in practice (only dispatch_console contributes to the count) but
  // the lock predicate must still hold the line if it ever did, so the
  // logic stays defensive.
  const counts = new Map<string, number>([["U-2", 2]]);
  const [m] = withRosterMoveLock([member({ unit_id: "U-2", device_type: "phone" })], counts);
  assert.equal(m!.move_locked, true);
});

test("withRosterMoveLock: account on ONE channel with non-console device is NOT locked", () => {
  // This is the exact UX the #136 fix wanted to restore — a regular phone
  // / handset account on a single channel must remain draggable.
  const counts = new Map<string, number>([["U-3", 1]]);
  const [m] = withRosterMoveLock(
    [member({ unit_id: "U-3", device_type: "phone" })],
    counts,
  );
  assert.equal(m!.move_locked, undefined);
});

test("withRosterMoveLock: legacy and bridge members are NEVER locked, regardless of count", () => {
  // The lock predicate requires kind === "account". Radio-key handsets
  // (legacy) and the in-process bridge worker (bridge) are not human
  // dispatchers and so MUST stay relocatable even if their unit id
  // somehow appeared with a high count.
  const counts = new Map<string, number>([["RADIO-A", 5], ["BRIDGE-1", 5]]);
  const out = withRosterMoveLock(
    [
      member({ unit_id: "RADIO-A", kind: "legacy", device_type: null }),
      member({ unit_id: "BRIDGE-1", kind: "bridge", device_type: null }),
    ],
    counts,
  );
  assert.equal(out[0]!.move_locked, undefined);
  assert.equal(out[1]!.move_locked, undefined);
});

test("withRosterMoveLock: looks up counts by upper-cased unit id (case-insensitive)", () => {
  // computeUnitChannelCounts stores keys upper-cased; withRosterMoveLock
  // must match that convention or a member rendered as "u-1" would miss
  // its count entry and incorrectly become movable.
  const counts = new Map<string, number>([["U-4", 2]]);
  const [m] = withRosterMoveLock(
    [member({ unit_id: "u-4", device_type: "phone" })],
    counts,
  );
  assert.equal(m!.move_locked, true);
});

test("withRosterMoveLock: does not mutate the input member objects", () => {
  // The roster array is shared with other consumers (live-control panel,
  // /v1/voice/roster response). A locked member must be a NEW object
  // with `move_locked: true`, not an in-place mutation.
  const input = [member({ unit_id: "U-5", device_type: "dispatch_console" })];
  const before = JSON.parse(JSON.stringify(input));
  const out = withRosterMoveLock(input, new Map([["U-5", 1]]));
  assert.notEqual(out[0], input[0], "locked member must be a fresh object");
  assert.deepEqual(input, before, "input must be unchanged");
});

test("withRosterMoveLock: leaves unlocked members as-is (same object reference)", () => {
  // Tiny memory optimisation that's worth pinning — when there's nothing
  // to lock, we return the same member reference rather than allocate a
  // shallow clone. A regression that always clones is not a correctness
  // bug, but it's worth knowing it changed.
  const input = [member({ unit_id: "U-6", kind: "legacy", device_type: null })];
  const out = withRosterMoveLock(input, new Map());
  assert.equal(out[0], input[0]);
});

test("withRosterMoveLock: returns an array of the same length as the input", () => {
  // Sanity check that the .map() never accidentally filters.
  const input = [
    member({ unit_id: "A", device_type: "dispatch_console" }),
    member({ unit_id: "B", device_type: "phone" }),
    member({ unit_id: "C", kind: "bridge", device_type: null }),
  ];
  const out = withRosterMoveLock(input, new Map());
  assert.equal(out.length, input.length);
});
