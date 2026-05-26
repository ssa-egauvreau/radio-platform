/**
 * Regression tests for the live-control "delete emergency channel" guard
 * extracted from `server/web-console/src/pages/LiveControlPanel.tsx` into
 * `server/web-console/src/lib/emergencyChannel.ts`.
 *
 * Context — PR #140 ("Fix live-control emergency delete stale channel
 * mapping") fixed a real correctness bug where the `×` button next to an
 * emergency channel header could delete the *wrong* channel:
 *
 *  - The component held a `useMemo`-built `Map<name, id>` derived from a
 *    polled channel list (`channelsList`). State updates on that Map lag
 *    behind any concurrent admin action (another tab, a teammate, a
 *    server-side cleanup of an emergency channel).
 *  - `deleteEmergencyChannel` then called `api.deleteChannel(map.get(name))`
 *    and could resolve the name to an id that the server had since recycled
 *    onto a different channel.
 *  - Server-side, `DELETE /v1/admin/channels/:id` accepts any channel id an
 *    admin sends — there is **no** server-side "is this still emergency?"
 *    guard. The client guard tested here is therefore the only thing that
 *    keeps the affordance safe.
 *
 * The fix re-fetches the channel list at click time, looks up by name in the
 * fresh list, re-validates that the name is still emergency-shaped, and only
 * then prompts and deletes by the *fresh* id.
 *
 * Regressions these tests catch:
 *
 *  1. Reverting to a stale local-cache lookup (the original bug).
 *  2. Loosening `isEmergencyChannelName` so a non-emergency channel slips
 *     through (e.g. matching "Security Emergency" or "EmergencyBackup").
 *  3. Tightening it so admin-renamed bare-token names ("Emergency",
 *     "emergency-bravo") stop working.
 *  4. Treating a network failure on the refresh as if no emergency channel
 *     exists (would race-delete on next try when the refresh did succeed
 *     but returned the wrong list — by surfacing the failure explicitly
 *     and aborting, we keep the bad state visible to the operator instead).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideEmergencyDelete,
  isEmergencyChannelName,
  type ChannelLike,
} from "../../web-console/src/lib/emergencyChannel.js";

// -----------------------------------------------------------------------
// isEmergencyChannelName: shape of the name predicate
// -----------------------------------------------------------------------

test("isEmergencyChannelName: accepts every name shape POST /channels/emergency emits", () => {
  // The endpoint defaults to `EMERGENCY HH:MM` and lets the operator pass a
  // free-form name in the prompt. These are the realistic shapes we have to
  // keep matching, otherwise the `×` affordance silently disappears from
  // legitimately-emergency channels.
  for (const name of [
    "EMERGENCY 14:23",
    "EMERGENCY 09:05",
    "Emergency",
    "emergency",
    "EMERGENCY",
    "Emergency Bravo",
    "emergency-bravo",
    "  EMERGENCY 14:23  ", // trim() is part of the predicate's contract
  ]) {
    assert.equal(
      isEmergencyChannelName(name),
      true,
      `expected "${name}" to be recognised as an emergency channel`,
    );
  }
});

test("isEmergencyChannelName: rejects regular channel names", () => {
  // The list below is drawn from the agency seed data + names operators
  // realistically use. Each one MUST collapse to false, otherwise a `×`
  // button appears on a normal channel and an admin click can delete it.
  for (const name of [
    "Operations",
    "Dispatch",
    "Tac 1",
    "TAC-2",
    "Channel 7",
    "OPS-Main",
    "Search and Rescue",
    "Comms",
    "",
    "   ",
  ]) {
    assert.equal(
      isEmergencyChannelName(name),
      false,
      `did not expect "${name}" to be recognised as an emergency channel`,
    );
  }
});

test("isEmergencyChannelName: refuses substring / suffix matches", () => {
  // The most dangerous false positive: a channel that happens to *contain*
  // the word "emergency" but does not start with it. The fix predicate is
  // anchored — assert that explicitly, because a regression here is what
  // would let dispatchers nuke "Security Emergency Backup" with one click.
  assert.equal(isEmergencyChannelName("Security Emergency"), false);
  assert.equal(isEmergencyChannelName("Security Emergency Backup"), false);
  assert.equal(isEmergencyChannelName("Backup Emergency"), false);
  assert.equal(isEmergencyChannelName("post-emergency"), false);
});

test("isEmergencyChannelName: requires a word boundary after the token", () => {
  // "EmergencyBackup" or "emergencyops" should NOT be considered an
  // emergency channel — the token must be a standalone word. Underscore
  // counts as a word character in JS regex, so "EMERGENCY_TEAM" also
  // fails this guard. That is the intended, conservative behavior — if
  // the affordance is ever supposed to handle underscored names, the
  // predicate must change deliberately and this test will catch it.
  assert.equal(isEmergencyChannelName("EmergencyBackup"), false);
  assert.equal(isEmergencyChannelName("emergencyops"), false);
  assert.equal(isEmergencyChannelName("EMERGENCYISH"), false);
  assert.equal(isEmergencyChannelName("EMERGENCY_TEAM_2"), false);
});

// -----------------------------------------------------------------------
// decideEmergencyDelete: the bug-fix flow
// -----------------------------------------------------------------------

const FRESH: ChannelLike[] = [
  { id: 11, name: "Operations" },
  { id: 12, name: "Tac 1" },
  { id: 13, name: "EMERGENCY 14:23" },
];

test("decideEmergencyDelete: refresh_failed when latestChannels is null", () => {
  // The component passes `null` when `api.myChannels()` itself threw. The
  // panel must surface that to the operator instead of silently doing
  // nothing (or worse, falling back to a cached id).
  const decision = decideEmergencyDelete("EMERGENCY 14:23", null);
  assert.deepEqual(decision, { kind: "refresh_failed" });
});

test("decideEmergencyDelete: channel_missing when name is no longer in the fresh list", () => {
  // The exact scenario from PR #140: another admin (or the server's own
  // emergency-channel cleanup) already removed "EMERGENCY 14:23" between
  // the last poll and this click. The decision MUST be `channel_missing`,
  // not `confirm_delete` against a stale id.
  const decision = decideEmergencyDelete("EMERGENCY 14:23", [
    { id: 11, name: "Operations" },
    { id: 12, name: "Tac 1" },
  ]);
  assert.deepEqual(decision, {
    kind: "channel_missing",
    name: "EMERGENCY 14:23",
  });
});

test("decideEmergencyDelete: not_emergency when the name now resolves to a non-emergency channel", () => {
  // Defensive branch: if a channel with the clicked name exists in the
  // fresh list but its name no longer matches `isEmergencyChannelName`
  // (e.g. an admin rename collided with the click), bail out with a
  // dedicated decision rather than deleting it.
  const decision = decideEmergencyDelete("Security Emergency", [
    { id: 14, name: "Security Emergency" },
  ]);
  assert.deepEqual(decision, {
    kind: "not_emergency",
    name: "Security Emergency",
  });
});

test("decideEmergencyDelete: confirm_delete returns the *fresh* id, not a cached one", () => {
  // The whole point of PR #140: the function must consult only the
  // freshly fetched list. Pass a list whose id for the same name differs
  // from a "stale" hypothetical map and assert the decision uses the
  // fresh id.
  const decision = decideEmergencyDelete("EMERGENCY 14:23", FRESH);
  assert.deepEqual(decision, {
    kind: "confirm_delete",
    id: 13,
    name: "EMERGENCY 14:23",
  });
});

test("decideEmergencyDelete: confirm_delete uses the name from the fresh list", () => {
  // Same trimmed-or-cased name in fresh list should be returned verbatim
  // from the fresh entry, so the confirm prompt + audit log show what the
  // server actually has, not what was clicked.
  const decision = decideEmergencyDelete("EMERGENCY 14:23", [
    { id: 21, name: "EMERGENCY 14:23" },
  ]);
  assert.equal(decision.kind, "confirm_delete");
  if (decision.kind === "confirm_delete") {
    assert.equal(decision.id, 21);
    assert.equal(decision.name, "EMERGENCY 14:23");
  }
});

test("decideEmergencyDelete: distinguishes between two channels that share a prefix", () => {
  // Two emergency channels exist; clicking on one must resolve to that
  // exact channel's id even if another emergency channel sorts adjacent.
  const list: ChannelLike[] = [
    { id: 30, name: "EMERGENCY 09:05" },
    { id: 31, name: "EMERGENCY 14:23" },
    { id: 32, name: "Operations" },
  ];
  assert.deepEqual(decideEmergencyDelete("EMERGENCY 09:05", list), {
    kind: "confirm_delete",
    id: 30,
    name: "EMERGENCY 09:05",
  });
  assert.deepEqual(decideEmergencyDelete("EMERGENCY 14:23", list), {
    kind: "confirm_delete",
    id: 31,
    name: "EMERGENCY 14:23",
  });
});

test("decideEmergencyDelete: refusing to delete when fresh list is empty", () => {
  // After a sweep that removed every emergency channel, a click on a
  // header that is still painted in the (stale) UI must collapse to
  // `channel_missing` rather than trying to delete anything.
  assert.deepEqual(decideEmergencyDelete("EMERGENCY 14:23", []), {
    kind: "channel_missing",
    name: "EMERGENCY 14:23",
  });
});

test("decideEmergencyDelete: case-sensitive name lookup matches DB convention", () => {
  // The server stores channel names verbatim and compares case-sensitively
  // in `getChannelByName` / the channels DB. The decision function must
  // reflect that — a stale-cased click ("emergency 14:23" vs the canonical
  // "EMERGENCY 14:23") MUST surface as `channel_missing`, not silently
  // delete the canonical one.
  const decision = decideEmergencyDelete("emergency 14:23", FRESH);
  assert.deepEqual(decision, {
    kind: "channel_missing",
    name: "emergency 14:23",
  });
});

test("decideEmergencyDelete: never returns confirm_delete for a non-emergency-named channel even if the click target matches by name", () => {
  // Belt-and-suspenders: even if someone renames a real emergency channel
  // (id 13) to "Operations" between poll and click, the decision must
  // refuse to delete it via the emergency affordance — that's a regular
  // delete and should go through the admin Channels page instead.
  const renamed: ChannelLike[] = [{ id: 13, name: "Operations" }];
  const decision = decideEmergencyDelete("Operations", renamed);
  assert.equal(decision.kind, "not_emergency");
});
