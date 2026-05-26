/**
 * Regression tests for `server/src/aiDispatch/channelCache.ts`.
 *
 * Why this module matters
 * -----------------------
 * `channelCache` is the in-memory mirror of the `channel_ai_dispatch` table
 * that the voice relay and the recorder consult on every audio frame to
 * decide whether the AI dispatcher should sit on this channel and answer
 * voice traffic. It runs in the hot path — once per IMBE frame at 20 ms
 * cadence — so the production code path never goes back to Postgres for
 * this lookup. That makes its correctness load-bearing in two ways:
 *
 *   1. If a write to the cache key-normalises a channel differently than
 *      the read does, an admin who enables AI dispatch on "Green 1" via
 *      the web console would see the database flip but the live voice
 *      relay would still answer false because it was looking under
 *      "green 1" (or vice-versa). Symptom: "I clicked enable but nothing
 *      happens until I restart the server."
 *
 *   2. If two agencies that share a channel display name ("Main",
 *      "Dispatch") collided in the cache, tenant A enabling AI dispatch
 *      would silently turn it on for tenant B as well. The composite key
 *      `${agencyId}:${normalizedChannel(channelName)}` is the only thing
 *      keeping tenants separated in this cache.
 *
 * Both regressions are silent at the API layer (the DB row is correct in
 * either case) and only surface when a dispatcher notices the AI either
 * stopped responding on a real channel or started responding on someone
 * else's. Worth pinning explicitly.
 *
 * Also exercised:
 *
 *   - `warmAiDispatchChannelCache` clears the cache before re-seeding (so
 *     a row deleted from Postgres actually disappears at the next boot
 *     warmup), and seeds with `enabled=true` for every supplied row (the
 *     DB query that feeds it filters on `enabled=TRUE`).
 *
 *   - `setAiDispatchChannelCached(..., false)` reads back as false, not
 *     `undefined` — the production code uses `=== true` so this is
 *     equivalent today, but a regression that started returning the raw
 *     map value would surface here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchChannelCached,
  setAiDispatchChannelCached,
  warmAiDispatchChannelCache,
} from "../../src/aiDispatch/channelCache.js";

/**
 * The cache is process-global; tests use unique agency IDs so they stay
 * independent without needing a `clear()` export. `warmAiDispatchChannelCache`
 * is the only function that resets state, and it does so across every key
 * (which we exercise in its own test).
 */
let nextAgency = 4_300_000;
function uniqueAgency(): number {
  return nextAgency++;
}

test("isAiDispatchChannelCached: returns false for a channel that was never set", () => {
  const ag = uniqueAgency();
  assert.equal(isAiDispatchChannelCached(ag, "unseen channel"), false);
});

test("setAiDispatchChannelCached: round-trips an enabled flag for the same agency + channel", () => {
  const ag = uniqueAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
});

test("setAiDispatchChannelCached: an explicit `false` reads back as false (not the raw stored value)", () => {
  // The caller uses `=== true` to gate AI dispatch, so a regression that
  // returned the raw map value (e.g. `false`) would still behave correctly
  // — but pin the contract anyway so a future refactor that started
  // returning `undefined | boolean` directly is caught.
  const ag = uniqueAgency();
  setAiDispatchChannelCached(ag, "Green 1", false);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), false);
});

test("cache key folds case + collapses internal whitespace before storing or reading", () => {
  // The recorder receives channel labels from a mix of clients (Android,
  // iOS, web console, bridges) that pad and case them slightly differently
  // — they must all hit the same cache bucket or AI dispatch flips on/off
  // per-client by accident.
  const ag = uniqueAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);

  for (const variant of [
    "Green 1",
    "green 1",
    "GREEN 1",
    " green 1 ",
    "green\t1",
    "green  1",
    "  Green   1   ",
  ]) {
    assert.equal(
      isAiDispatchChannelCached(ag, variant),
      true,
      `must match "${variant}" (case/whitespace tolerant)`,
    );
  }
});

test("cache key includes the agency id so two tenants on a shared channel name stay isolated", () => {
  // Multi-tenant safety: agency A enabling AI on "Main" must not flip it on
  // for agency B's identically-named "Main" — these are independent channels
  // in two independent dispatch domains.
  const ag1 = uniqueAgency();
  const ag2 = uniqueAgency();
  setAiDispatchChannelCached(ag1, "Main", true);
  assert.equal(isAiDispatchChannelCached(ag1, "Main"), true);
  assert.equal(
    isAiDispatchChannelCached(ag2, "Main"),
    false,
    "tenant B must not see tenant A's enable",
  );

  // And the reverse: agency B can enable independently and agency A is
  // unaffected by the second write.
  setAiDispatchChannelCached(ag2, "Main", true);
  setAiDispatchChannelCached(ag1, "Main", false);
  assert.equal(isAiDispatchChannelCached(ag1, "Main"), false);
  assert.equal(isAiDispatchChannelCached(ag2, "Main"), true);
});

test("toggling a channel flips the cached value (last write wins)", () => {
  // The admin UI lets a dispatcher disable AI dispatch on a channel and
  // re-enable it later. The mid-call cache reads must reflect the most
  // recent toggle, not whatever was there at boot.
  const ag = uniqueAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
  setAiDispatchChannelCached(ag, "Green 1", false);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), false);
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
});

test("warmAiDispatchChannelCache: re-seeds the cache from DB rows with enabled=true", () => {
  // Boot-time warm path: every row returned from listChannelAiDispatchEnabled
  // (filtered on enabled=TRUE upstream) is seeded as true.
  warmAiDispatchChannelCache([
    { agency_id: 5_500_001, channel_name: "Channel One" },
    { agency_id: 5_500_001, channel_name: "Channel Two" },
    { agency_id: 5_500_002, channel_name: "Channel One" },
  ]);

  assert.equal(isAiDispatchChannelCached(5_500_001, "Channel One"), true);
  assert.equal(isAiDispatchChannelCached(5_500_001, "Channel Two"), true);
  assert.equal(isAiDispatchChannelCached(5_500_002, "Channel One"), true);
  // Same string, different agency that wasn't in the warm set → still false.
  assert.equal(isAiDispatchChannelCached(5_500_003, "Channel One"), false);
});

test("warmAiDispatchChannelCache: CLEARS prior entries so admin-deleted channels disappear at next warmup", () => {
  // A regression that warmed *additively* would never drop a channel that
  // had been disabled in the DB — the cache would only ever grow. Pin the
  // clear-before-seed contract: a key set before warmup is gone after a
  // warmup that doesn't include it.
  const persistedAgency = 5_600_001;
  const persistedChannel = "Persisted";
  const transientAgency = 5_600_002;
  const transientChannel = "Will Be Cleared";

  setAiDispatchChannelCached(transientAgency, transientChannel, true);
  assert.equal(isAiDispatchChannelCached(transientAgency, transientChannel), true);

  warmAiDispatchChannelCache([
    { agency_id: persistedAgency, channel_name: persistedChannel },
  ]);

  assert.equal(
    isAiDispatchChannelCached(persistedAgency, persistedChannel),
    true,
    "the row included in the warm set must read true",
  );
  assert.equal(
    isAiDispatchChannelCached(transientAgency, transientChannel),
    false,
    "a key NOT included in the warm set must be cleared",
  );
});

test("warmAiDispatchChannelCache: an empty seed list wipes the cache", () => {
  // Boot scenario: an admin disables AI dispatch on every channel; the
  // upstream query returns zero rows; the next warmup must produce an
  // empty cache, not retain the prior entries.
  setAiDispatchChannelCached(5_700_001, "A", true);
  setAiDispatchChannelCached(5_700_002, "B", true);
  setAiDispatchChannelCached(5_700_003, "C", true);

  warmAiDispatchChannelCache([]);

  assert.equal(isAiDispatchChannelCached(5_700_001, "A"), false);
  assert.equal(isAiDispatchChannelCached(5_700_002, "B"), false);
  assert.equal(isAiDispatchChannelCached(5_700_003, "C"), false);
});

test("warmAiDispatchChannelCache: also folds case + whitespace when seeding from DB rows", () => {
  // DB rows store the channel name as the admin typed it ("Green 1"), but
  // the relay queries by whatever string the client sent on the wire. Both
  // sides must go through normalizedChannel — pin it on the warm path too.
  warmAiDispatchChannelCache([
    { agency_id: 5_800_001, channel_name: " Green  1 " },
  ]);
  assert.equal(isAiDispatchChannelCached(5_800_001, "green 1"), true);
  assert.equal(isAiDispatchChannelCached(5_800_001, "GREEN\t1"), true);
});
