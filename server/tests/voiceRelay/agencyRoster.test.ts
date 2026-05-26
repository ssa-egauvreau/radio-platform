/**
 * Regression tests for the agency / channel roster read paths in
 * `server/src/voiceRelay.ts`:
 *
 *   - `listChannelRoster(agencyId, channelName)` — backs the per-channel
 *     "who's on this channel right now" view used by Android, iOS, and
 *     the web dispatcher pages, and is what `GET /v1/radio/presence`
 *     and the channel-detail panels read.
 *
 *   - `listAgencyRosters(agencyId)` — backs the Live Channel Control
 *     admin tree (drag-and-drop). It must group every connected member
 *     by channel name and apply the same move-lock rule the UI relies
 *     on so a dispatcher never sees a "movable" badge on someone who
 *     is, in fact, locked.
 *
 * Why this matters (no direct coverage today):
 *  - These two functions are the single source of truth for every "who
 *    is on this channel?" panel in the product. A bug that swapped the
 *    sort order, mis-normalised the channel name lookup, or leaked one
 *    agency's roster into another's response would be highly visible to
 *    dispatchers and immediately observable to other tenants.
 *  - `listAgencyRosters` re-applies the move-lock rules via
 *    `withRosterMoveLock` + `unitChannelCounts`, so a regression in any
 *    of those would show up here as a dispatcher seeing a console
 *    operator as drag-droppable (or, worse, a normal user as locked).
 *
 * The tests cover:
 *   1. `listChannelRoster` returns members in longest-connected-first
 *      order (the UI relies on this so the channel "owner" reads
 *      top-of-list).
 *   2. `listChannelRoster` is agency-scoped and channel-name normalised
 *      (case + whitespace) to match both the heartbeat write path and
 *      the WebSocket join path.
 *   3. `listChannelRoster` returns `[]` for an empty / sentinel channel
 *      value without throwing so the route handler can safely forward
 *      whatever the query string contained.
 *   4. `listAgencyRosters` groups every connected member by channel
 *      name, sorts channels alphabetically (matches the admin tree),
 *      sorts members inside each channel by connected_ms desc, and
 *      applies the move-lock rule so a single dispatch_console operator
 *      is marked locked even on a channel they're alone on.
 *   5. `listAgencyRosters` does NOT leak another agency's channels.
 *
 * Time is driven by `node:test` mock timers so the connected_ms values
 * we assert against are deterministic — no `setTimeout` sleeps.
 */

import { afterEach, beforeEach, test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import {
  __resetVoiceRosterForTest,
  __setVoiceRosterRecordForTest,
  listAgencyRosters,
  listChannelRoster,
} from "../../src/voiceRelay.js";

beforeEach(() => {
  __resetVoiceRosterForTest();
});

afterEach(() => {
  __resetVoiceRosterForTest();
});

test("listChannelRoster: returns connected members longest-connected first", (t: TestContext) => {
  t.mock.timers.enable({ apis: ["Date"] });
  // Mock timers start at epoch (Date.now() === 0). Anchor synthetic joins
  // at concrete `joinedAt` timestamps in the past so connected_ms is
  // deterministic.
  t.mock.timers.setTime(60_000);
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-LATE",
    kind: "account",
    joinedAt: 55_000, // 5 s ago
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-EARLY",
    kind: "account",
    joinedAt: 10_000, // 50 s ago
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-MID",
    kind: "account",
    joinedAt: 40_000, // 20 s ago
  });

  const roster = listChannelRoster(7, "Patrol");
  assert.deepEqual(
    roster.map((m) => m.unit_id),
    ["U-EARLY", "U-MID", "U-LATE"],
    "longest-connected first",
  );
  // connected_ms is computed against the mocked "now"; pin to exact values.
  assert.equal(roster[0]!.connected_ms, 50_000);
  assert.equal(roster[1]!.connected_ms, 20_000);
  assert.equal(roster[2]!.connected_ms, 5_000);
});

test("listChannelRoster: channel name lookup is normalized (case + internal whitespace)", () => {
  // The cache key is `${agencyId} ${normalizedChannel(name)}` for writes; the
  // reader must compose the same lookup or every "Patrol" join would be
  // invisible to a "patrol" request from a slightly different client.
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol Alpha",
    unitId: "U-1",
    kind: "account",
  });
  assert.equal(listChannelRoster(7, "patrol alpha").length, 1);
  assert.equal(listChannelRoster(7, "  PATROL\tALPHA  ").length, 1);
  assert.equal(listChannelRoster(7, "patrol    alpha").length, 1);
});

test("listChannelRoster: agency-scoped — never leaks another tenant's members", () => {
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-AGENCY-7",
    kind: "account",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 8,
    channelName: "Patrol",
    unitId: "U-AGENCY-8",
    kind: "account",
  });
  assert.deepEqual(
    listChannelRoster(7, "Patrol").map((m) => m.unit_id),
    ["U-AGENCY-7"],
  );
  assert.deepEqual(
    listChannelRoster(8, "Patrol").map((m) => m.unit_id),
    ["U-AGENCY-8"],
  );
});

test("listChannelRoster: returns [] for empty / sentinel / non-string channels", () => {
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Real",
    unitId: "U-1",
    kind: "account",
  });
  assert.deepEqual(listChannelRoster(7, ""), []);
  assert.deepEqual(listChannelRoster(7, "----"), []);
  assert.deepEqual(listChannelRoster(7, undefined), []);
  assert.deepEqual(listChannelRoster(7, null), []);
  assert.deepEqual(listChannelRoster(7, 0), []);
  // And the real channel still resolves on the same agency.
  assert.equal(listChannelRoster(7, "Real").length, 1);
});

test("listChannelRoster: returns the right member metadata (kind / client / device_type)", () => {
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-1",
    displayName: "Officer Doe",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-2",
    kind: "legacy",
    client: "android",
    deviceType: "unit_radio",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "BR-1",
    kind: "bridge",
    client: "bridge",
    deviceType: null,
  });
  const roster = listChannelRoster(7, "Patrol");
  assert.equal(roster.length, 3);
  const byUnit = new Map(roster.map((m) => [m.unit_id, m]));
  assert.equal(byUnit.get("U-1")!.display_name, "Officer Doe");
  assert.equal(byUnit.get("U-1")!.kind, "account");
  assert.equal(byUnit.get("U-1")!.client, "web");
  assert.equal(byUnit.get("U-1")!.device_type, "dispatch_console");
  assert.equal(byUnit.get("U-2")!.kind, "legacy");
  assert.equal(byUnit.get("U-2")!.device_type, "unit_radio");
  assert.equal(byUnit.get("BR-1")!.kind, "bridge");
  assert.equal(byUnit.get("BR-1")!.device_type, null);
});

test("listAgencyRosters: groups members by channel name, sorts channels alphabetically", () => {
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Zulu",
    unitId: "U-Z",
    kind: "account",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Alpha",
    unitId: "U-A",
    kind: "account",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Mike",
    unitId: "U-M",
    kind: "account",
  });
  const rosters = listAgencyRosters(7);
  assert.deepEqual(
    rosters.map((r) => r.channel),
    ["Alpha", "Mike", "Zulu"],
    "channels must be sorted alphabetically for a stable admin tree",
  );
});

test("listAgencyRosters: members inside each channel are longest-connected first", (t: TestContext) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(100_000);
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-LATE",
    kind: "account",
    joinedAt: 90_000,
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-EARLY",
    kind: "account",
    joinedAt: 10_000,
  });
  const [patrol] = listAgencyRosters(7);
  assert.ok(patrol);
  assert.deepEqual(patrol.members.map((m) => m.unit_id), ["U-EARLY", "U-LATE"]);
});

test("listAgencyRosters: marks a dispatch_console operator move_locked even on a single channel", () => {
  // The Live Channel Control tree shows a lock badge on console operators
  // so dispatchers don't try to drag them out from under an active call.
  // This is the rule `withRosterMoveLock` enforces; pin it explicitly via
  // the end-to-end `listAgencyRosters` path to catch a future regression
  // that bypassed `withRosterMoveLock` from this code path.
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "DISP-1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  const [patrol] = listAgencyRosters(7);
  assert.equal(patrol!.members.length, 1);
  assert.equal(patrol!.members[0]!.move_locked, true);
});

test("listAgencyRosters: a handset alone on a channel is NOT marked move_locked", () => {
  // The drag-and-drop UX needs handsets to remain movable.
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "27-040",
    kind: "account",
    client: "android",
    deviceType: "unit_radio",
  });
  const [patrol] = listAgencyRosters(7);
  assert.equal(patrol!.members[0]!.move_locked, undefined);
  // And the literal property is absent (not just falsy) — the wire format
  // omits this key for movable members.
  assert.equal(
    Object.prototype.hasOwnProperty.call(patrol!.members[0], "move_locked"),
    false,
  );
});

test("listAgencyRosters: multi-channel dispatch console operator gets move_locked on every channel", () => {
  // Same console operator on two channels — both members must read locked.
  // This pins the integration between `unitChannelCounts` (count is 2) and
  // `withRosterMoveLock` (locks any account whose count > 1).
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "DISP-1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Backup",
    unitId: "DISP-1",
    kind: "account",
    client: "web",
    deviceType: "dispatch_console",
  });
  const rosters = listAgencyRosters(7);
  // Both channels are present.
  assert.deepEqual(rosters.map((r) => r.channel), ["Backup", "Patrol"]);
  for (const r of rosters) {
    assert.equal(r.members.length, 1);
    assert.equal(r.members[0]!.unit_id, "DISP-1");
    assert.equal(r.members[0]!.move_locked, true, `must lock on channel ${r.channel}`);
  }
});

test("listAgencyRosters: does NOT include another agency's channels", () => {
  __setVoiceRosterRecordForTest({
    agencyId: 7,
    channelName: "Patrol",
    unitId: "U-A7",
    kind: "account",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 8,
    channelName: "Patrol",
    unitId: "U-A8",
    kind: "account",
  });
  __setVoiceRosterRecordForTest({
    agencyId: 8,
    channelName: "Backup",
    unitId: "U-A8-B",
    kind: "account",
  });
  const ag7 = listAgencyRosters(7);
  assert.deepEqual(ag7.map((r) => r.channel), ["Patrol"]);
  assert.equal(ag7[0]!.members[0]!.unit_id, "U-A7");

  const ag8 = listAgencyRosters(8);
  assert.deepEqual(ag8.map((r) => r.channel), ["Backup", "Patrol"]);
});

test("listAgencyRosters: returns an empty array when no channels are connected", () => {
  // The admin tree handles an empty agency by rendering "no active
  // channels"; the helper must therefore not throw or return undefined.
  const rosters = listAgencyRosters(7);
  assert.deepEqual(rosters, []);
});

test("listAgencyRosters: agency-id prefix is exact (does not match super-strings like '77 …')", () => {
  // `channelKey` is `${agencyId} ${chNorm}` — a naive `startsWith("7")`
  // without the trailing space would let agency 7 see agency 77's roster.
  // Pin the space-delimited prefix contract.
  __setVoiceRosterRecordForTest({
    agencyId: 77,
    channelName: "Patrol",
    unitId: "U-77",
    kind: "account",
  });
  assert.deepEqual(listAgencyRosters(7), []);
  const ag77 = listAgencyRosters(77);
  assert.deepEqual(ag77.map((r) => r.channel), ["Patrol"]);
});
