/**
 * Tests for `server/src/aiDispatch/channelCache.ts`.
 *
 * The AI-dispatch channel cache is an in-memory mirror of the
 * `channel_ai_dispatch` table — the recorder and voice relay consult it
 * on the hot path of every transmission to decide whether to invoke the
 * LLM dispatcher. A regression here either:
 *
 *   - Silently disables AI dispatch on a channel the agency turned ON
 *     (cache says "off" because the lookup key drifted from the write
 *     key), so the on-air dispatcher stops responding without any error.
 *
 *   - Silently enables AI dispatch on the wrong channel — worst case,
 *     bleeds the wrong tenant's traffic into another tenant's LLM
 *     account / system prompt / 10-8 CAD.
 *
 * Tests pinned here:
 *
 *   1. set + get round-trips for the same agency + channel.
 *   2. Channel name is normalised (case + whitespace folded) on BOTH
 *      sides so admins entering "Main" and recorder asking "main" hit
 *      the same cache bucket. Sharing `normalizedChannel` with the
 *      presence module is what guarantees the recorder and the admin
 *      UI agree about which channel is in scope.
 *   3. Multi-tenant isolation: agency A's enabled channel must not
 *      appear enabled for agency B.
 *   4. `setAiDispatchChannelCached(..., false)` turns the channel OFF
 *      so an admin disabling AI dispatch takes effect immediately,
 *      without waiting for cache eviction.
 *   5. `warmAiDispatchChannelCache` clears any prior state before
 *      loading the row set — this is what keeps the cache from
 *      accumulating dead "enabled" entries across DB-refresh cycles
 *      (e.g. a channel deleted by the admin would still read as
 *      enabled if the warm path only added, never cleared).
 *   6. Unknown channels (never set, never warmed) read as NOT enabled,
 *      not undefined-as-truthy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchChannelCached,
  setAiDispatchChannelCached,
  warmAiDispatchChannelCache,
} from "../../src/aiDispatch/channelCache.js";

// Use a different agency id namespace per test so the process-global cache
// state from earlier tests can't influence later ones (the cache is a
// singleton by design — it lives on the recorder hot path).
let NEXT_AGENCY = 8_200_000;
function agencyId(): number {
  return NEXT_AGENCY++;
}

test("setAiDispatchChannelCached + isAiDispatchChannelCached: simple round-trip", () => {
  const ag = agencyId();
  assert.equal(isAiDispatchChannelCached(ag, "Main"), false, "unknown channel reads as off");

  setAiDispatchChannelCached(ag, "Main", true);
  assert.equal(isAiDispatchChannelCached(ag, "Main"), true);

  setAiDispatchChannelCached(ag, "Main", false);
  assert.equal(
    isAiDispatchChannelCached(ag, "Main"),
    false,
    "disabling must take effect immediately — admin turning AI off can't wait for TTL",
  );
});

test("channelCache: channel name is normalised on both sides ('Main' ≡ 'main' ≡ '  MAIN  ')", () => {
  // If the cache key didn't normalise, an admin turning AI on with
  // channel name "Main" wouldn't be visible to the recorder asking with
  // "main" (the actual stored channel label) — the dispatcher would go
  // silently off-air on every transmission. Pin the contract that the
  // cache shares the same normaliser as `presence.normalizedChannel`.
  const ag = agencyId();
  setAiDispatchChannelCached(ag, "Main", true);

  for (const variant of ["main", "MAIN", "  Main  ", "Main\t", "  main   "]) {
    assert.equal(
      isAiDispatchChannelCached(ag, variant),
      true,
      `variant ${JSON.stringify(variant)} must hit the same cache bucket as 'Main'`,
    );
  }
});

test("channelCache: collapses multi-space channel names to a single space ('Ops 1' ≡ 'Ops   1')", () => {
  // `normalizedChannel` collapses any run of whitespace to a single
  // ASCII space, so the recorder sending a tab/space-separated label
  // and the admin typing the same thing in the UI agree.
  const ag = agencyId();
  setAiDispatchChannelCached(ag, "Ops 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Ops   1"), true);
  assert.equal(isAiDispatchChannelCached(ag, "ops\t1"), true);
});

test("channelCache: enables are isolated per agency (tenant A's 'main' ≠ tenant B's 'main')", () => {
  // Multi-tenant isolation — the cache key prefixes by agency id so two
  // tenants with a channel literally called "main" don't cross-pollinate.
  // A bug here would either silently leak AI dispatch on/off state across
  // tenants or, worse, route an LLM call against the wrong agency's
  // system prompt and integrations.
  const a = agencyId();
  const b = agencyId();
  setAiDispatchChannelCached(a, "main", true);

  assert.equal(isAiDispatchChannelCached(a, "main"), true);
  assert.equal(
    isAiDispatchChannelCached(b, "main"),
    false,
    "tenant B must NOT inherit tenant A's enabled state for the same channel name",
  );

  // And again with the casing variant — to make sure the agency prefix
  // composes correctly with the channel normaliser.
  setAiDispatchChannelCached(b, "MAIN", true);
  assert.equal(isAiDispatchChannelCached(b, "main"), true);
});

test("channelCache: warmAiDispatchChannelCache replaces (clears) prior state, not merges", () => {
  // The warm path is called at boot and any time the recorder noticed the
  // DB drifted. It MUST clear before re-populating — otherwise a channel
  // an admin deleted in the DB would forever read as enabled in the
  // cache. Pin the clear-on-warm contract.
  const a = agencyId();
  const b = agencyId();

  // Seed something the warm path is NOT going to include.
  setAiDispatchChannelCached(a, "deleted_channel", true);
  setAiDispatchChannelCached(b, "other_tenant_channel", true);

  // Now warm with a fresh row set that includes neither of the above.
  warmAiDispatchChannelCache([
    { agency_id: a, channel_name: "Main" },
    { agency_id: a, channel_name: "Ops 1" },
  ]);

  assert.equal(
    isAiDispatchChannelCached(a, "deleted_channel"),
    false,
    "warm must clear stale entries that aren't in the row set",
  );
  assert.equal(
    isAiDispatchChannelCached(b, "other_tenant_channel"),
    false,
    "warm clears across tenants too — it's a global cache reset",
  );
  assert.equal(isAiDispatchChannelCached(a, "Main"), true);
  assert.equal(isAiDispatchChannelCached(a, "Ops 1"), true);
});

test("channelCache: warmAiDispatchChannelCache treats every row as enabled=true (no per-row flag)", () => {
  // The warm path only loads rows the DB query returned as enabled — the
  // helper trusts the caller's filter. So every row passed in must be
  // reflected as enabled, regardless of any hypothetical "enabled"
  // field on the row. Pin that contract so the SELECT in the caller
  // remains the single source of truth.
  const ag = agencyId();
  warmAiDispatchChannelCache([
    { agency_id: ag, channel_name: "alpha" },
    { agency_id: ag, channel_name: "bravo" },
  ]);
  assert.equal(isAiDispatchChannelCached(ag, "alpha"), true);
  assert.equal(isAiDispatchChannelCached(ag, "bravo"), true);
});

test("channelCache: warm with an empty row set fully empties the cache", () => {
  // After an admin disables AI dispatch on every channel in an agency,
  // the warm path must be able to flush the cache by passing []. This
  // also covers the "no agencies have AI enabled" boot case.
  const ag = agencyId();
  setAiDispatchChannelCached(ag, "main", true);
  setAiDispatchChannelCached(ag, "ops 1", true);

  warmAiDispatchChannelCache([]);

  assert.equal(isAiDispatchChannelCached(ag, "main"), false);
  assert.equal(isAiDispatchChannelCached(ag, "ops 1"), false);
});

test("channelCache: isAiDispatchChannelCached uses strict === true semantics (any non-true is off)", () => {
  // The implementation does `.get(key) === true`, so a future refactor
  // that put a truthy non-boolean in there (e.g. "1" or 1) would NOT
  // count as enabled. Pin the strict-boolean contract so a regression
  // that switched to a Map<string, unknown> can't accidentally start
  // treating non-true values as enabled.
  const ag = agencyId();
  // Setting to true → true
  setAiDispatchChannelCached(ag, "main", true);
  assert.equal(isAiDispatchChannelCached(ag, "main"), true);
  // Setting to false → false (not "still truthy because not deleted")
  setAiDispatchChannelCached(ag, "main", false);
  assert.equal(isAiDispatchChannelCached(ag, "main"), false);
});
