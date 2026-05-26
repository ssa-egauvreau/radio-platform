/**
 * End-to-end regression coverage for the live-control "move lock" decision
 * exposed by `isUnitMoveLocked` and `listAgencyRosters`. These exercise the
 * full path — `voiceRoster` (in-memory) → `unitChannelCounts(agencyId)` →
 * `withRosterMoveLock` / `isUnitMoveLocked` — rather than the pure helpers in
 * isolation.
 *
 * Why this file exists alongside the existing suites:
 *
 *   - `voiceRelayMoveLock.test.ts` (PR #146) calls
 *     `unitChannelCountsFromRecords` directly. Its assertions can stay green
 *     even if the *integrated* path through `voiceRoster` regresses (e.g.
 *     `unitChannelCounts` accidentally calling `computeUnitChannelCounts`
 *     with a different signature, or stopping calling either at all).
 *
 *   - `voiceRelay/unitChannelCounts.test.ts` (PR #136) calls
 *     `computeUnitChannelCounts` directly with hand-built record lists. It
 *     does not seed the actual roster either.
 *
 *   - `voiceRelay.test.ts` (PR #150) covers the `isUnitMoveLocked` flow but
 *     does NOT cover the PR #140 "two web/desktop dispatch sessions on
 *     different channels even with deviceType=null must lock" case end-to-end.
 *     If a future change stops passing `client` through `voiceRoster` (or
 *     changes the `countsAsDispatchConsoleSession` rule), the existing tests
 *     pass while real dispatchers lose move protection in production.
 *
 * The May 2026 merge of PRs #136/#140/#146/#150 hit exactly this gap: the
 * production file ended up with two parallel `unitChannelCounts` definitions
 * pointing at *different* helpers, and the per-helper tests stayed green
 * because each helper still worked in isolation. These integrated checks
 * pin the contract the API actually serves.
 */

import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  __resetVoiceRosterForTest,
  __setVoiceRosterRecordForTest,
  computeUnitChannelCounts,
  isUnitMoveLocked,
  listAgencyRosters,
  unitChannelCounts,
  unitChannelCountsFromRecords,
} from "../../src/voiceRelay.js";

const AGENCY = 7;
const OTHER_AGENCY = 99;

beforeEach(() => {
  __resetVoiceRosterForTest();
});

afterEach(() => {
  __resetVoiceRosterForTest();
});

test("isUnitMoveLocked: web dispatcher scanning two channels with null deviceType IS locked (PR #140 fix, end-to-end)", () => {
  // The exact scenario PR #140 promised to lock: a dispatcher whose
  // device_type lookup hasn't completed (or whose row predates the column)
  // is keeping the web dashboard open on two channels. They must NOT be
  // drag-droppable — otherwise a dispatcher gets yanked off a channel
  // mid-incident.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 2",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "DISP1"), true);
});

test("isUnitMoveLocked: desktop dispatcher scanning two channels with null deviceType IS locked (PR #140 fix, end-to-end)", () => {
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Red",
    unitId: "DISP2",
    kind: "account",
    client: "desktop",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Blue",
    unitId: "DISP2",
    kind: "account",
    client: "desktop",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "DISP2"), true);
});

test("isUnitMoveLocked: mixed web+desktop sessions on different channels count toward the same lock", () => {
  // Same physical dispatcher running the web console on one screen and the
  // Electron desktop console on another — must be treated as a single
  // multi-channel scan and locked.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Alpha",
    unitId: "DISP3",
    kind: "account",
    client: "web",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Bravo",
    unitId: "DISP3",
    kind: "account",
    client: "desktop",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "DISP3"), true);
});

test("isUnitMoveLocked: a single web dashboard with no other sessions is NOT locked", () => {
  // PR #140's expansion only matters when n > 1 for the wrapper-level
  // count check. A single web dashboard session (no explicit
  // dispatch_console deviceType) should still be drag-droppable so the
  // dispatcher can be moved by another admin.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "USER42",
    kind: "account",
    client: "web",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "USER42"), false);
});

test("isUnitMoveLocked: handset + iOS dashboard scanning second channel does NOT promote the user to console-locked", () => {
  // The "ios" / "android" client values must not be treated as console.
  // The user is a field unit with a phone on one channel and their
  // monitoring tab on another — must stay movable.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "USER42",
    kind: "account",
    client: "ios",
    deviceType: "phone",
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 2",
    unitId: "USER42",
    kind: "account",
    client: "ios",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "USER42"), false);
});

test("isUnitMoveLocked: agency isolation — agency 7's web scanner does not lock agency 77's unit of the same id", () => {
  // The channelKey prefix is `${agencyId} ` — literally agency id plus a
  // space, so `7 ` does not match `77 `. Without the trailing space, an
  // agency-id prefix collision could spread the move lock across tenants.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 2",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: 77,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });

  assert.equal(isUnitMoveLocked(AGENCY, "DISP1"), true);
  assert.equal(isUnitMoveLocked(77, "DISP1"), false);
});

test("listAgencyRosters: surfaces move_locked=true on every channel where a multi-channel web dispatcher appears", () => {
  // The Live Channel Control admin tree consumes this exact output. A
  // dispatcher who is on N channels must show as `move_locked: true` on
  // ALL of them — not just the channel discovered first.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 2",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: null,
  });

  const rosters = listAgencyRosters(AGENCY);
  assert.equal(rosters.length, 2);
  for (const channel of rosters) {
    const member = channel.members.find((m) => m.unit_id === "DISP1");
    assert.ok(member, `expected DISP1 on ${channel.channel}`);
    assert.equal(member!.move_locked, true, `expected DISP1 to be move_locked on ${channel.channel}`);
  }
});

test("listAgencyRosters: a non-console user on a single channel + a separate dispatcher on another is not cross-locked", () => {
  // Two different unit_ids — locking one must not bleed onto the other.
  // This is the canonical regression check for the bug where the counts
  // map was keyed by something other than unit_id.
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "USER42",
    kind: "account",
    client: "ios",
    deviceType: "phone",
  });

  const rosters = listAgencyRosters(AGENCY);
  const green1 = rosters.find((r) => r.channel === "Green 1");
  assert.ok(green1);
  const disp = green1!.members.find((m) => m.unit_id === "DISP1");
  const user = green1!.members.find((m) => m.unit_id === "USER42");
  assert.ok(disp && user);
  assert.equal(disp!.move_locked, true, "dispatch_console is always locked");
  assert.equal(user!.move_locked, undefined, "phone user must not be locked");
});

test("listAgencyRosters: scoping is exact — agency 7 listings exclude an agency-77 record with the same unit on the same channel name", () => {
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  __setVoiceRosterRecordForTest({
    agencyId: OTHER_AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });

  const own = listAgencyRosters(AGENCY);
  const other = listAgencyRosters(OTHER_AGENCY);
  assert.equal(own.length, 1);
  assert.equal(own[0]!.members.length, 1);
  assert.equal(other.length, 1);
  assert.equal(other[0]!.members.length, 1);
});

// --- Helper-consistency contract -----------------------------------------
//
// `unitChannelCountsFromRecords` (PR #140 API, `(agencyId, records)`) and
// `computeUnitChannelCounts` (PR #136 API, `(records, agencyId)`) are two
// public names for the same rule. The May 2026 merge corruption produced a
// brief window where one called the looser helper and the other was wired to
// stricter behaviour — both per-helper test suites stayed green because each
// was correct in isolation. These checks pin that they must agree on every
// case the codebase already cares about.

test("computeUnitChannelCounts and unitChannelCountsFromRecords agree on the empty case", () => {
  assert.deepEqual(
    computeUnitChannelCounts([], AGENCY),
    unitChannelCountsFromRecords(AGENCY, []),
  );
});

test("computeUnitChannelCounts and unitChannelCountsFromRecords agree on a mixed roster", () => {
  const records = [
    {
      channelKey: `${AGENCY} green 1`,
      channelName: "Green 1",
      unitId: "DISP1",
      kind: "account" as const,
      client: "web",
      deviceType: "dispatch_console",
    },
    {
      channelKey: `${AGENCY} green 2`,
      channelName: "Green 2",
      unitId: "DISP1",
      kind: "account" as const,
      client: "web",
      deviceType: null,
    },
    {
      channelKey: `${AGENCY} green 3`,
      channelName: "Green 3",
      unitId: "USER42",
      kind: "account" as const,
      client: "ios",
      deviceType: "phone",
    },
    {
      channelKey: `${OTHER_AGENCY} green 1`,
      channelName: "Green 1",
      unitId: "DISP1",
      kind: "account" as const,
      client: "web",
      deviceType: "dispatch_console",
    },
  ];

  const fromCompute = computeUnitChannelCounts(records, AGENCY);
  const fromRecords = unitChannelCountsFromRecords(AGENCY, records);

  assert.deepEqual(
    [...fromCompute.entries()].sort(),
    [...fromRecords.entries()].sort(),
  );
  // And the actual expected value, so a "both wrong the same way" regression
  // also breaks this test:
  assert.equal(fromCompute.get("DISP1"), 2);
  assert.equal(fromCompute.get("USER42"), undefined);
});

test("unitChannelCounts wrapper sees the same data as unitChannelCountsFromRecords called with the live roster", () => {
  // Pins that the wrapper still delegates to the same rule rather than to a
  // detached helper that may drift (the exact bug the May 2026 merge produced).
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 1",
    unitId: "DISP1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 2",
    unitId: "DISP1",
    kind: "account",
    client: "desktop",
    deviceType: null,
  });
  __setVoiceRosterRecordForTest({
    agencyId: AGENCY,
    channelName: "Green 3",
    unitId: "USER42",
    kind: "account",
    client: "ios",
    deviceType: "phone",
  });

  const fromWrapper = unitChannelCounts(AGENCY);
  assert.equal(fromWrapper.get("DISP1"), 2);
  assert.equal(fromWrapper.get("USER42"), undefined);
});
