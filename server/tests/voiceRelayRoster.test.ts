/**
 * Regression tests for the voice-relay roster *read* APIs in
 * `server/src/voiceRelay.ts`:
 *
 *   - `listChannelRoster(agencyId, channel)`  — drives the dispatch
 *     console's "who is on this channel?" panel and the handset HUD.
 *   - `listAgencyRosters(agencyId)`           — drives the admin Live
 *     Channel Control tree (every channel with at least one connected
 *     member, plus the move-lock annotation).
 *
 * The existing `voiceRelay.test.ts` and `voiceRelay/unitChannelCounts.test.ts`
 * already pin the *move-lock counting* rules. Neither one exercises these
 * two read-side functions — yet they are the routes the dispatch UI polls
 * every few seconds and a regression here either:
 *
 *   - leaks a roster across tenants (the `${agencyId} ` channelKey prefix
 *     boundary — agency 7 must NEVER see agency 77's roster),
 *   - returns the "----" off-air placeholder channel as if it were a real
 *     channel (which would put phantom units in the dispatch UI), or
 *   - drops the `move_locked` annotation in `listAgencyRosters`, which
 *     would let a dispatcher drag a multi-channel console operator
 *     mid-incident.
 *
 * All of those are silent, high-blast-radius UX bugs — no exception is
 * thrown, the roster is just wrong. These tests pin the observable
 * contract so future refactors of the roster reading code keep the
 * tenant boundary, the off-air filter, and the move-lock wiring intact.
 *
 * We seed the in-process roster directly via `__setVoiceRosterRecordForTest`,
 * the same helper the existing `voiceRelay.test.ts` uses — no WebSocket
 * server, no DB, fully deterministic.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  __resetVoiceRosterForTest,
  __setVoiceRosterRecordForTest,
  listAgencyRosters,
  listChannelRoster,
} from "../src/voiceRelay.js";

const AGENCY = 7;
const OTHER_AGENCY = 99;

beforeEach(() => {
  __resetVoiceRosterForTest();
});

afterEach(() => {
  __resetVoiceRosterForTest();
});

// ---------- listChannelRoster -----------------------------------------------

describe("listChannelRoster", () => {
  test("returns an empty list for the off-air '----' placeholder channel", () => {
    // The reserved "----" channel name means the unit is not currently
    // tuned to any voice channel. Returning seeded records here would
    // surface phantom transmitters on the dispatch HUD.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "----",
      unitId: "U1",
      kind: "account",
      deviceType: "phone",
    });
    assert.deepEqual(listChannelRoster(AGENCY, "----"), []);
  });

  test("returns an empty list when the requested channel name is blank", () => {
    // `normalizedChannel` collapses to "" for null/undefined/whitespace; the
    // route must refuse to enumerate every record in the roster.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "U1",
      kind: "account",
    });
    assert.deepEqual(listChannelRoster(AGENCY, ""), []);
    assert.deepEqual(listChannelRoster(AGENCY, "   "), []);
    assert.deepEqual(listChannelRoster(AGENCY, null), []);
    assert.deepEqual(listChannelRoster(AGENCY, undefined), []);
  });

  test("matches channel names case-insensitively and ignores surrounding whitespace", () => {
    // `normalizedChannel` lowercases + trims + collapses internal whitespace.
    // The console URL may carry any casing — the roster must still match.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "U1",
      kind: "account",
    });
    assert.equal(listChannelRoster(AGENCY, "green 1").length, 1);
    assert.equal(listChannelRoster(AGENCY, "  Green   1  ").length, 1);
    assert.equal(listChannelRoster(AGENCY, "GREEN 1").length, 1);
  });

  test("isolates rosters per agency (no cross-tenant leak)", () => {
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "OURS",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: OTHER_AGENCY,
      channelName: "Green 1",
      unitId: "THEIRS",
      kind: "account",
    });

    const ours = listChannelRoster(AGENCY, "Green 1");
    assert.equal(ours.length, 1);
    assert.equal(ours[0]!.unit_id, "OURS");

    const theirs = listChannelRoster(OTHER_AGENCY, "Green 1");
    assert.equal(theirs.length, 1);
    assert.equal(theirs[0]!.unit_id, "THEIRS");
  });

  test("does not leak a prefix-similar agency's roster (7 must not see 77)", () => {
    // channelKey is `${agencyId} ${chNorm}`. Without the trailing space, a
    // naive prefix check for agency 7 would match agency 77's records.
    // listChannelRoster uses exact key equality so this must be safe.
    __setVoiceRosterRecordForTest({
      agencyId: 77,
      channelName: "Green 1",
      unitId: "THEIRS",
      kind: "account",
    });
    assert.deepEqual(listChannelRoster(7, "Green 1"), []);
  });

  test("orders members longest-connected first", () => {
    // The dispatch UI relies on connected_ms ordering so the most-tenured
    // operator on the channel is at the top of the list.
    const now = Date.now();
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "SHORT",
      kind: "account",
      joinedAt: now - 1_000,
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "LONG",
      kind: "account",
      joinedAt: now - 60_000,
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "MEDIUM",
      kind: "account",
      joinedAt: now - 10_000,
    });

    const members = listChannelRoster(AGENCY, "Green 1");
    assert.deepEqual(
      members.map((m) => m.unit_id),
      ["LONG", "MEDIUM", "SHORT"],
    );
  });

  test("emits the public RosterMember shape with the expected fields", () => {
    // Pinning the field surface so a refactor cannot silently drop
    // `display_name`, `kind`, `client`, or `device_type` from the API
    // response (the dispatch UI keys off all of them).
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "U1",
      displayName: "Alice",
      kind: "account",
      client: "web",
      deviceType: "dispatch_console",
    });
    const [m] = listChannelRoster(AGENCY, "Green 1");
    assert.ok(m);
    assert.equal(m!.unit_id, "U1");
    assert.equal(m!.display_name, "Alice");
    assert.equal(m!.kind, "account");
    assert.equal(m!.client, "web");
    assert.equal(m!.device_type, "dispatch_console");
    assert.equal(typeof m!.connected_ms, "number");
    assert.ok(m!.connected_ms >= 0);
  });

  test("does not include records from other channels in the same agency", () => {
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "U_GREEN",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Blue 1",
      unitId: "U_BLUE",
      kind: "account",
    });

    const green = listChannelRoster(AGENCY, "Green 1");
    assert.deepEqual(
      green.map((m) => m.unit_id),
      ["U_GREEN"],
    );
  });
});

// ---------- listAgencyRosters ----------------------------------------------

describe("listAgencyRosters", () => {
  test("returns an empty list when the agency has no live sockets", () => {
    __setVoiceRosterRecordForTest({
      agencyId: OTHER_AGENCY,
      channelName: "Green 1",
      unitId: "U1",
      kind: "account",
    });
    assert.deepEqual(listAgencyRosters(AGENCY), []);
  });

  test("groups members by channel name, one entry per active channel", () => {
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "G1A",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "G1B",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Blue 1",
      unitId: "B1",
      kind: "account",
    });

    const rosters = listAgencyRosters(AGENCY);
    assert.equal(rosters.length, 2, "two active channels → two entries");

    const green = rosters.find((r) => r.channel === "Green 1");
    const blue = rosters.find((r) => r.channel === "Blue 1");
    assert.ok(green && blue);
    assert.equal(green!.members.length, 2);
    assert.equal(blue!.members.length, 1);
  });

  test("sorts channels by name ascending so the admin tree is stable", () => {
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Yankee",
      unitId: "U1",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Alpha",
      unitId: "U2",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Mike",
      unitId: "U3",
      kind: "account",
    });

    const rosters = listAgencyRosters(AGENCY);
    assert.deepEqual(
      rosters.map((r) => r.channel),
      ["Alpha", "Mike", "Yankee"],
    );
  });

  test("orders members within a channel longest-connected first", () => {
    const now = Date.now();
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "SHORT",
      kind: "account",
      joinedAt: now - 500,
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "LONG",
      kind: "account",
      joinedAt: now - 120_000,
    });

    const [{ members }] = listAgencyRosters(AGENCY);
    assert.deepEqual(
      members!.map((m) => m.unit_id),
      ["LONG", "SHORT"],
    );
  });

  test("annotates move_locked on a multi-channel dispatch console operator", () => {
    // A console operator scanning two channels is dispatching from both —
    // Live Channel Control must not drag-drop them between channels. The
    // move-lock counting is tested elsewhere; here we pin that
    // listAgencyRosters actually *applies* the annotation it computes.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "DISP1",
      kind: "account",
      deviceType: "dispatch_console",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 2",
      unitId: "DISP1",
      kind: "account",
      deviceType: "dispatch_console",
    });

    const rosters = listAgencyRosters(AGENCY);
    assert.equal(rosters.length, 2);
    for (const r of rosters) {
      const disp = r.members.find((m) => m.unit_id === "DISP1");
      assert.ok(disp, `DISP1 missing from ${r.channel}`);
      assert.equal(disp!.move_locked, true, `DISP1 must be move_locked on ${r.channel}`);
    }
  });

  test("does NOT lock a normal user who is on a handset + web tab on different channels (PR #140 fix)", () => {
    // The PR #140 regression: a normal user with the dashboard open while
    // also carrying a phone tuned to another channel must NOT be flagged
    // move_locked — they are not a dispatcher and Live Channel Control
    // must still allow drag-drop on their handset.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "USER42",
      kind: "account",
      deviceType: "phone",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 2",
      unitId: "USER42",
      kind: "account",
      deviceType: null, // web tab without device_type cached
      client: "android", // explicit handset client; NOT counted as console scanning
    });

    const rosters = listAgencyRosters(AGENCY);
    for (const r of rosters) {
      const u = r.members.find((m) => m.unit_id === "USER42");
      assert.ok(u, `USER42 missing from ${r.channel}`);
      assert.notEqual(
        u!.move_locked,
        true,
        `USER42 must remain movable on ${r.channel}`,
      );
    }
  });

  test("isolates per agency (no cross-tenant channel leak)", () => {
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "OURS",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: OTHER_AGENCY,
      channelName: "Red 1",
      unitId: "THEIRS",
      kind: "account",
    });

    const ours = listAgencyRosters(AGENCY);
    assert.equal(ours.length, 1);
    assert.equal(ours[0]!.channel, "Green 1");
    assert.equal(ours[0]!.members[0]!.unit_id, "OURS");
  });

  test("does not leak a prefix-similar agency's rosters (7 must not see 77)", () => {
    // channelKey prefix is `${agencyId} ` — the trailing space prevents a
    // naive startsWith("7") from matching "77 ...". This test pins the
    // boundary: agency 7 with no records of its own must see an empty
    // tree even when agency 77 has live channels.
    __setVoiceRosterRecordForTest({
      agencyId: 77,
      channelName: "Green 1",
      unitId: "THEIRS",
      kind: "account",
    });
    __setVoiceRosterRecordForTest({
      agencyId: 77,
      channelName: "Green 2",
      unitId: "THEIRS",
      kind: "account",
    });
    assert.deepEqual(listAgencyRosters(7), []);
    // And agency 77 still sees both of its channels.
    const tens = listAgencyRosters(77);
    assert.deepEqual(
      tens.map((r) => r.channel).sort(),
      ["Green 1", "Green 2"],
    );
  });

  test("includes legacy and bridge sockets in the per-channel members list", () => {
    // Legacy handsets and radio bridges are real channel occupants —
    // they must appear in the admin tree so a dispatcher can see them.
    // They are never move_locked (kind !== "account"), but the *presence*
    // entry must still surface.
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "LEG-101",
      kind: "legacy",
    });
    __setVoiceRosterRecordForTest({
      agencyId: AGENCY,
      channelName: "Green 1",
      unitId: "BRIDGE-A",
      kind: "bridge",
    });

    const [roster] = listAgencyRosters(AGENCY);
    assert.equal(roster!.channel, "Green 1");
    const kinds = roster!.members.map((m) => m.kind).sort();
    assert.deepEqual(kinds, ["bridge", "legacy"]);
    for (const m of roster!.members) {
      assert.notEqual(
        m.move_locked,
        true,
        `non-account kind ${m.kind} must never be move_locked`,
      );
    }
  });
});
