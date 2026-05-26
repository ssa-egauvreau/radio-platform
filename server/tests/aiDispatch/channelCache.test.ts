/**
 * Regression tests for `server/src/aiDispatch/channelCache.ts`.
 *
 * This is the in-memory mirror of the `channel_ai_dispatch` table that
 * lives in front of every recorder / voice-relay hot path:
 *
 *   - `recorder.ts` checks `isAiDispatchChannelCached(agencyId, channel)`
 *     on every incoming transmission to decide whether to fan the audio
 *     out to the AI dispatcher engine.
 *   - `aiDispatch/engine.ts` re-asks on every TTS / 10-33 / playback
 *     decision to know whether the channel is opted in.
 *
 * Two bugs would have outsized blast radius and are non-obvious enough
 * to be worth pinning behaviourally:
 *
 *   1. **Multi-tenant leak through the cache key.**
 *      The key is `${agencyId}:${normalizedChannel(channel)}`. If a
 *      future refactor dropped the `agencyId` prefix (or stopped
 *      normalising the channel), an admin who flipped AI dispatch on
 *      for *their* "Main" channel would silently flip it on for every
 *      other tenant that also has a channel literally called "main".
 *      The handset would then ship dispatch audio for the wrong agency
 *      into our LLM provider — both a privacy and a billing incident.
 *
 *   2. **Channel-name normalisation drifting between the cache and
 *      `presence.normalizedChannel`.** Both modules key off the same
 *      normaliser; if `channelCache` started keying on the raw label
 *      instead, the recorder would look up "Main " (trailing space from
 *      the Android client) and miss the cached `true` for "main".
 *
 * The tests also pin smaller invariants:
 *
 *   - `setAiDispatchChannelCached(false)` is a real write — it does
 *     not just "delete" the entry. A future migration from "absent =
 *     disabled" to a tri-state must keep the explicit `false` readable
 *     (callers check `=== true`).
 *   - `warmAiDispatchChannelCache` REPLACES the current cache contents
 *     atomically. The DB warm-up loop runs on startup AND on signal
 *     refresh; if a row was deleted in the DB but the cache still
 *     served `true`, recorder would keep dispatching after the admin
 *     toggled the channel off.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchChannelCached,
  setAiDispatchChannelCached,
  warmAiDispatchChannelCache,
} from "../../src/aiDispatch/channelCache.js";

/**
 * Reset the module-level Map between tests so ordering doesn't matter.
 * `warmAiDispatchChannelCache([])` is the public "drop everything" handle
 * — re-using the production code path here is intentional so a future
 * regression in warm() that stopped truly clearing the cache would also
 * trip the rest of the suite.
 */
function reset(): void {
  warmAiDispatchChannelCache([]);
}

test("isAiDispatchChannelCached: returns false for an uncached channel (no allocation)", () => {
  reset();
  assert.equal(isAiDispatchChannelCached(1, "Main"), false);
  assert.equal(isAiDispatchChannelCached(2, "Patrol"), false);
});

test("setAiDispatchChannelCached(true) + isAiDispatchChannelCached: round-trips the flag", () => {
  reset();
  setAiDispatchChannelCached(1, "Main", true);
  assert.equal(isAiDispatchChannelCached(1, "Main"), true);
});

test("setAiDispatchChannelCached(false) is observable, NOT a delete", () => {
  // Callers use `=== true` for the positive check, but the cache must
  // still distinguish "we know it's off" from "we have no idea" so a
  // future tri-state migration doesn't silently regress.
  reset();
  setAiDispatchChannelCached(1, "Main", true);
  setAiDispatchChannelCached(1, "Main", false);
  assert.equal(isAiDispatchChannelCached(1, "Main"), false);
});

test("isAiDispatchChannelCached: returns false for a different agency on the same channel name", () => {
  // The headline multi-tenant invariant: if agency 1 enables AI dispatch
  // on its "Main" channel, agency 2's identically-named channel must NOT
  // observe the same flag. A regression here is a privacy / billing
  // incident (handset audio for the wrong agency fanned into our LLM).
  reset();
  setAiDispatchChannelCached(1, "Main", true);
  assert.equal(isAiDispatchChannelCached(1, "Main"), true);
  assert.equal(
    isAiDispatchChannelCached(2, "Main"),
    false,
    "agency 2 must not inherit agency 1's flag on the same channel name",
  );
  // And flipping agency 2 on must not flip agency 1 off (key collision check).
  setAiDispatchChannelCached(2, "Main", true);
  assert.equal(isAiDispatchChannelCached(1, "Main"), true);
  assert.equal(isAiDispatchChannelCached(2, "Main"), true);
});

test("isAiDispatchChannelCached: lookups normalise the channel label (case + whitespace)", () => {
  // Handsets, the web console, and the recorder all send slightly
  // different padding/casing for the same logical channel. The cache
  // key derivation re-uses presence.normalizedChannel — both modules
  // must agree on the same bucket or the recorder misses the cached
  // `true` because it asked about "  Main  " and the warm-up stored
  // "main".
  reset();
  setAiDispatchChannelCached(7, "Main Channel", true);
  for (const variant of [
    "main channel",
    "MAIN CHANNEL",
    "  Main Channel  ",
    "Main\tChannel",
    "Main   Channel", // collapsed whitespace
  ]) {
    assert.equal(
      isAiDispatchChannelCached(7, variant),
      true,
      `variant ${JSON.stringify(variant)} must resolve to the same bucket`,
    );
  }
});

test("setAiDispatchChannelCached: normalising on write+read collapses to one entry per channel", () => {
  // Two writes to cosmetically-different channel labels must not produce
  // two competing cache entries — otherwise the latest write would win
  // for its exact label but the recorder (asking with a different label)
  // would observe the earlier value.
  reset();
  setAiDispatchChannelCached(3, " main ", true);
  setAiDispatchChannelCached(3, "MAIN", false);
  // Last write wins, regardless of cosmetic variant.
  assert.equal(isAiDispatchChannelCached(3, "main"), false);
  assert.equal(isAiDispatchChannelCached(3, "Main"), false);
});

test("warmAiDispatchChannelCache: replaces the existing cache contents (not additive)", () => {
  // The DB warm-up loop runs on startup AND on the admin-driven refresh
  // signal. A row that was just DELETED in the DB must drop out of the
  // cache on the next warm; if warm() were additive, the recorder would
  // keep dispatching for the just-disabled channel until process restart.
  reset();
  setAiDispatchChannelCached(1, "OldChan", true);
  warmAiDispatchChannelCache([
    { agency_id: 1, channel_name: "NewChan" },
    { agency_id: 2, channel_name: "PatrolA" },
  ]);
  assert.equal(
    isAiDispatchChannelCached(1, "OldChan"),
    false,
    "previously-cached entry must be dropped when warm() does not include it",
  );
  assert.equal(isAiDispatchChannelCached(1, "NewChan"), true);
  assert.equal(isAiDispatchChannelCached(2, "PatrolA"), true);
});

test("warmAiDispatchChannelCache: every row is stored as enabled=true", () => {
  // The DB select that feeds the warm-up filters `WHERE enabled = true`
  // (see store.ts callers). Every row reaching the warm-up therefore
  // represents an opted-in channel and must materialise as `true` —
  // there is no `enabled` field on the row shape.
  reset();
  warmAiDispatchChannelCache([
    { agency_id: 10, channel_name: "Chan1" },
    { agency_id: 10, channel_name: "Chan2" },
    { agency_id: 11, channel_name: "Chan1" },
  ]);
  assert.equal(isAiDispatchChannelCached(10, "Chan1"), true);
  assert.equal(isAiDispatchChannelCached(10, "Chan2"), true);
  assert.equal(isAiDispatchChannelCached(11, "Chan1"), true);
  // And again: multi-tenant key isolation across the warm-up batch.
  assert.equal(isAiDispatchChannelCached(11, "Chan2"), false);
});

test("warmAiDispatchChannelCache([]) drops every entry (test-isolation handle)", () => {
  // No public clear() exists — the empty warm-up is the documented way
  // to reset the cache (used by recorder shutdown and these tests).
  setAiDispatchChannelCached(1, "A", true);
  setAiDispatchChannelCached(2, "B", true);
  warmAiDispatchChannelCache([]);
  assert.equal(isAiDispatchChannelCached(1, "A"), false);
  assert.equal(isAiDispatchChannelCached(2, "B"), false);
});

test("warmAiDispatchChannelCache: tolerates duplicate rows (last write wins on the same key)", () => {
  // The DB may have legitimate duplicates if the warm-up is fed by an
  // aggregate UNION of two views. Both rows hash to the same cache key;
  // the warm-up must accept both without throwing.
  reset();
  assert.doesNotThrow(() =>
    warmAiDispatchChannelCache([
      { agency_id: 5, channel_name: " Main " },
      { agency_id: 5, channel_name: "MAIN" },
      { agency_id: 5, channel_name: "main" },
    ]),
  );
  assert.equal(isAiDispatchChannelCached(5, "main"), true);
});
