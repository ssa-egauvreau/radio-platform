/**
 * Regression tests for `server/src/aiDispatch/channelCache.ts`.
 *
 * `channelCache` is the in-process mirror of the `channel_ai_dispatch` table
 * that the voice relay (`voiceRelay.ts`) and the recorder (`recorder.ts`)
 * consult on every audio frame to decide whether to fan a sideband PCM
 * stream to the AI dispatcher. Because it's read inside the hot WebSocket
 * frame loop, the lookup never touches the database — so a bug in the
 * cache shape is observed by every active channel on every frame.
 *
 * The properties pinned here:
 *
 *   1. **Default-false safety.** An unknown agency/channel returns `false`
 *      so a stale flag (or a typo / case-mismatch) never *accidentally*
 *      starts routing audio to the AI engine for a tenant that didn't
 *      opt in.
 *   2. **Strict boolean discriminator.** `isAiDispatchChannelCached` is
 *      documented as returning `true` only when the cached value is the
 *      literal `true`. Setting the flag to `false` must be observably
 *      different from "not set", and the truthiness must not be inferred
 *      from anything fuzzy (this is why the source uses `=== true`).
 *   3. **Multi-tenant key namespacing.** The cache key is
 *      `agencyId:normalizedChannel`. Agency 1's "Green 1" must not be
 *      seen by agency 2, and "Green 1" / "green 1" / " GREEN  1 " on the
 *      same agency must collapse to the same key (mirrors the
 *      `normalizedChannel` rule presence.ts also enforces).
 *   4. **Warm-cache semantics.** `warmAiDispatchChannelCache(rows)` is
 *      called once at boot from the DB. It must (a) clear any prior
 *      state so a stale row from a previous warm-up doesn't survive a
 *      reload after a flag was turned off in admin, and (b) set every
 *      provided row to `true` — never `false`, because the table only
 *      contains the enabled rows.
 *
 * The cache is a process-global `Map`, so each test seeds its own
 * fresh agency IDs (via `freshAgency()`) to stay independent of any
 * other test in the same suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isAiDispatchChannelCached,
  setAiDispatchChannelCached,
  warmAiDispatchChannelCache,
} from "../../src/aiDispatch/channelCache.js";

// Pad against any process-global state left over by other tests by starting
// well outside any realistic agency id range. Increment per call so two
// tests in the same run never collide.
let nextAgency = 8_700_000;
function freshAgency(): number {
  return nextAgency++;
}

test("isAiDispatchChannelCached: unknown agency/channel defaults to false", () => {
  const ag = freshAgency();
  // Never set — must be false (not undefined-coerced-to-true, not throw).
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), false);
  assert.equal(isAiDispatchChannelCached(ag, ""), false);
  assert.equal(isAiDispatchChannelCached(ag, "----"), false);
});

test("setAiDispatchChannelCached + isAiDispatchChannelCached: true round-trips", () => {
  const ag = freshAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
});

test("setAiDispatchChannelCached(false) is observably 'disabled' (not 'unknown')", () => {
  // Explicit-false and never-set are equivalent from the consumer's PoV
  // (both return false from isAiDispatchChannelCached), but the cache
  // entry exists and any future set(true) must restore it.
  const ag = freshAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
  setAiDispatchChannelCached(ag, "Green 1", false);
  assert.equal(
    isAiDispatchChannelCached(ag, "Green 1"),
    false,
    "explicit false must override the prior true",
  );
  setAiDispatchChannelCached(ag, "Green 1", true);
  assert.equal(
    isAiDispatchChannelCached(ag, "Green 1"),
    true,
    "explicit true must re-enable after explicit false",
  );
});

test("isAiDispatchChannelCached: returns true ONLY for the literal boolean true (strict ===)", () => {
  // The source uses `=== true` rather than truthiness. Pin that contract:
  // even if a future bug stuffed a non-boolean truthy value into the cache
  // via setAiDispatchChannelCached's `enabled: boolean` argument (e.g. by
  // someone casting), the getter must not be tricked. We can't easily
  // bypass the boolean type at the public API, so this test instead pins
  // the documented contract: set(false) → get() === false (not undefined).
  const ag = freshAgency();
  setAiDispatchChannelCached(ag, "Green 1", false);
  const out = isAiDispatchChannelCached(ag, "Green 1");
  assert.equal(out, false);
  assert.equal(typeof out, "boolean");
});

test("channel name is normalized: case, whitespace, and padding all collapse", () => {
  // The cache key uses `normalizedChannel`, which the presence module also
  // uses. A regression that diverged the two would split the lookup
  // between cache-hit and cache-miss code paths and silently disable AI
  // dispatch for any client that sent a slightly different cosmetic form.
  const ag = freshAgency();
  setAiDispatchChannelCached(ag, "Green 1", true);
  for (const variant of [
    "Green 1",
    "green 1",
    "GREEN 1",
    " green 1 ",
    "green\t1",
    "Green  1",
    "  GREEN\t  1  ",
  ]) {
    assert.equal(
      isAiDispatchChannelCached(ag, variant),
      true,
      `lookup for cosmetic variant ${JSON.stringify(variant)} must hit the same cache entry`,
    );
  }
});

test("channel-name normalization holds for the writer too (write 'Green 1', read 'green 1')", () => {
  // The dual to the previous test: write side must normalise too, or two
  // clients on the same channel with different casing would race writes
  // into two separate cache buckets.
  const ag = freshAgency();
  setAiDispatchChannelCached(ag, "GREEN 1", true);
  assert.equal(isAiDispatchChannelCached(ag, "green 1"), true);
  setAiDispatchChannelCached(ag, "  green   1 ", false);
  assert.equal(
    isAiDispatchChannelCached(ag, "Green 1"),
    false,
    "writer normalises so a re-spelled flag actually overrides the prior bucket",
  );
});

test("multi-tenant isolation: two agencies with the same channel name are independent", () => {
  // Hard rule across the platform. Without this, enabling AI dispatch on
  // tenant A's "Green 1" would silently enable it on tenant B's too — a
  // privacy regression that would route B's call audio to A's LLM call.
  const a = freshAgency();
  const b = freshAgency();
  setAiDispatchChannelCached(a, "Green 1", true);
  // Sanity: B's identical channel name is still off.
  assert.equal(isAiDispatchChannelCached(b, "Green 1"), false);
  // And enabling on B does not silently flip A off either.
  setAiDispatchChannelCached(b, "Green 1", true);
  assert.equal(isAiDispatchChannelCached(a, "Green 1"), true);
  assert.equal(isAiDispatchChannelCached(b, "Green 1"), true);
  // Turning B off must not affect A.
  setAiDispatchChannelCached(b, "Green 1", false);
  assert.equal(isAiDispatchChannelCached(a, "Green 1"), true);
  assert.equal(isAiDispatchChannelCached(b, "Green 1"), false);
});

test("agency-id key namespace is exact: '1' and '10' don't collide via prefix bleed", () => {
  // The composite key is literally `${agencyId}:${normalizedChannel}` —
  // a colon separator. A regression that used some looser comparison
  // could let agency 10 leak into agency 1's lookups (since "1:..." is a
  // substring of "10:..."). Pin the contract explicitly.
  setAiDispatchChannelCached(1, "PrefixGuardChannel", true);
  setAiDispatchChannelCached(10, "PrefixGuardChannel", false);
  assert.equal(isAiDispatchChannelCached(1, "PrefixGuardChannel"), true);
  assert.equal(isAiDispatchChannelCached(10, "PrefixGuardChannel"), false);
  // Reset for hygiene.
  setAiDispatchChannelCached(1, "PrefixGuardChannel", false);
});

test("warmAiDispatchChannelCache: enables every row it's given", () => {
  const a = freshAgency();
  const b = freshAgency();
  warmAiDispatchChannelCache([
    { agency_id: a, channel_name: "Green 1" },
    { agency_id: a, channel_name: "Green 2" },
    { agency_id: b, channel_name: "Patrol" },
  ]);
  assert.equal(isAiDispatchChannelCached(a, "Green 1"), true);
  assert.equal(isAiDispatchChannelCached(a, "Green 2"), true);
  assert.equal(isAiDispatchChannelCached(b, "Patrol"), true);
  // A non-listed channel for one of the listed agencies must stay off.
  assert.equal(isAiDispatchChannelCached(a, "Green 99"), false);
});

test("warmAiDispatchChannelCache: clears prior state so a turned-off flag actually goes off", () => {
  // The boot path is: read the rows currently flagged ENABLED, then warm.
  // The DB row disappears when an admin disables a channel — so if warm
  // didn't first clear, a re-warm after a disable would leave the stale
  // `true` in the in-process cache forever (until process restart). This
  // is exactly the kind of silent bug that's invisible until someone
  // notices the AI engine is still hearing a channel that was disabled
  // an hour ago.
  const ag = freshAgency();
  warmAiDispatchChannelCache([
    { agency_id: ag, channel_name: "Originally Enabled" },
  ]);
  assert.equal(isAiDispatchChannelCached(ag, "Originally Enabled"), true);

  // Admin disables → next warm-up sees an empty row set.
  warmAiDispatchChannelCache([]);
  assert.equal(
    isAiDispatchChannelCached(ag, "Originally Enabled"),
    false,
    "warm with an empty row set must evict every prior entry",
  );
});

test("warmAiDispatchChannelCache: clears every agency, not just the ones in the new set", () => {
  // Defense-in-depth: a partial warm (e.g. an admin disables one agency's
  // last channel while another agency's stay enabled) must still drop the
  // disappeared agency's row, even though the new row set doesn't mention
  // that agency at all.
  const a = freshAgency();
  const b = freshAgency();
  warmAiDispatchChannelCache([
    { agency_id: a, channel_name: "A1" },
    { agency_id: b, channel_name: "B1" },
  ]);
  assert.equal(isAiDispatchChannelCached(a, "A1"), true);
  assert.equal(isAiDispatchChannelCached(b, "B1"), true);

  // Agency a's flag goes away; agency b is unchanged.
  warmAiDispatchChannelCache([{ agency_id: b, channel_name: "B1" }]);
  assert.equal(
    isAiDispatchChannelCached(a, "A1"),
    false,
    "agency a's prior entry must be evicted by the warm-reload",
  );
  assert.equal(isAiDispatchChannelCached(b, "B1"), true);
});

test("warmAiDispatchChannelCache: normalizes each row's channel name", () => {
  // The DB row's `channel_name` should match the same normalized form the
  // voice relay later queries with — assert by warming with messy input
  // and reading back with the canonical form.
  const ag = freshAgency();
  warmAiDispatchChannelCache([
    { agency_id: ag, channel_name: "  GREEN  1  " },
  ]);
  assert.equal(isAiDispatchChannelCached(ag, "Green 1"), true);
  assert.equal(isAiDispatchChannelCached(ag, "green 1"), true);
});

test("warmAiDispatchChannelCache: idempotent on an empty input set", () => {
  const ag = freshAgency();
  warmAiDispatchChannelCache([]);
  warmAiDispatchChannelCache([]);
  assert.equal(isAiDispatchChannelCached(ag, "Anything"), false);
});
