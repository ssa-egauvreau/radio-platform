/**
 * Tests for `server/src/sessionCache.ts`.
 *
 * The session cache short-circuits the per-request "is this user / agency
 * still active?" Postgres lookup on every authenticated API call (Android
 * handsets poll AIR every 250 ms — without the cache this is the hottest
 * path in the database).
 *
 * Two correctness properties matter:
 *
 *  1. **Forced revocation must not be deferred by the TTL.**
 *     `invalidateCachedAuth` is called after a fresh login bumps
 *     token_generation so the OLD device's next request hits Postgres and
 *     gets superseded immediately, rather than continuing to authenticate
 *     under a stale (still-true) cache entry for up to TTL_MS.
 *
 *  2. **Expired entries don't stay readable.**
 *     The cache must not return an entry once its `expiresAt` is past,
 *     otherwise an admin disabling an agency would have no upper bound on
 *     when handsets actually lose access.
 *
 * `clearAuthCache` is the test-isolation handle the rest of the project
 * uses; we exercise it too so any future regression that drops the export
 * (or that mutates other state) is caught here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clearAuthCache,
  getCachedAuth,
  invalidateCachedAuth,
  setCachedAuth,
} from "../src/sessionCache.js";

function withFakeNow<T>(start: number, fn: (advance: (ms: number) => void) => T): T {
  const realNow = Date.now;
  let now = start;
  Date.now = () => now;
  try {
    return fn((ms) => {
      now += ms;
    });
  } finally {
    Date.now = realNow;
  }
}

test("getCachedAuth: returns null for an uncached user", () => {
  clearAuthCache();
  assert.equal(getCachedAuth(123), null);
});

test("setCachedAuth + getCachedAuth: round-trip carries the same auth state", () => {
  clearAuthCache();
  setCachedAuth(42, {
    tokenGeneration: 7,
    userDisabled: false,
    agencyDisabled: false,
  });
  const got = getCachedAuth(42);
  assert.ok(got, "value just set should be readable");
  assert.equal(got.tokenGeneration, 7);
  assert.equal(got.userDisabled, false);
  assert.equal(got.agencyDisabled, false);
});

test("setCachedAuth: overwrites a prior entry for the same userId (last write wins)", () => {
  clearAuthCache();
  setCachedAuth(7, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  setCachedAuth(7, { tokenGeneration: 2, userDisabled: true, agencyDisabled: false });
  const got = getCachedAuth(7);
  assert.ok(got);
  assert.equal(got.tokenGeneration, 2, "second set must replace the first");
  assert.equal(got.userDisabled, true);
});

test("setCachedAuth: a lower token_generation cannot overwrite a fresher entry", () => {
  // Reproduces the login race: request A read generation=1, login bumps to 2,
  // then request A tries to write its stale auth snapshot into the cache.
  clearAuthCache();
  setCachedAuth(7, { tokenGeneration: 2, userDisabled: false, agencyDisabled: false });
  setCachedAuth(7, { tokenGeneration: 1, userDisabled: true, agencyDisabled: true });
  const got = getCachedAuth(7);
  assert.ok(got);
  assert.equal(got.tokenGeneration, 2, "stale generation must not replace a newer login generation");
  assert.equal(got.userDisabled, false);
  assert.equal(got.agencyDisabled, false);
});

test("setCachedAuth: equal token_generation still overwrites (refreshes disabled flags)", () => {
  // Background poll observed userDisabled=true in Postgres while gen was unchanged;
  // the cache MUST absorb the new flags or admin-disabled propagation breaks until
  // the next gen bump (i.e. forever for accounts that are never re-logged-in).
  // If a future refactor tightens the guard to `>=`, this test catches it.
  clearAuthCache();
  setCachedAuth(7, { tokenGeneration: 4, userDisabled: false, agencyDisabled: false });
  setCachedAuth(7, { tokenGeneration: 4, userDisabled: true, agencyDisabled: true });
  const got = getCachedAuth(7);
  assert.ok(got);
  assert.equal(got.tokenGeneration, 4);
  assert.equal(got.userDisabled, true, "equal-gen overwrite must propagate userDisabled");
  assert.equal(got.agencyDisabled, true, "equal-gen overwrite must propagate agencyDisabled");
});

test("setCachedAuth: a rejected stale write must NOT refresh the entry's TTL", () => {
  // The whole point of the generation guard is that a slow in-flight request cannot
  // affect the cache after a fresh login. That includes not silently sliding the
  // expiry window forward — otherwise the post-login entry would outlive its
  // intended TTL whenever a stale request happened to arrive late.
  clearAuthCache();
  withFakeNow(1_000_000, (advance) => {
    setCachedAuth(7, { tokenGeneration: 5, userDisabled: false, agencyDisabled: false });
    advance(10_000); // 10s into the 15s TTL
    // Stale write at gen=1 — must be a complete no-op.
    setCachedAuth(7, { tokenGeneration: 1, userDisabled: true, agencyDisabled: true });
    advance(5_001); // total 15_001ms since original write → original entry expired
    assert.equal(
      getCachedAuth(7),
      null,
      "stale write must not have extended the original TTL",
    );
  });
});

test("setCachedAuth: equal-gen overwrite refreshes the TTL window", () => {
  // Mirror of the above — the legitimate refresh path SHOULD slide the expiry
  // forward, otherwise the cache would prematurely thrash back to Postgres.
  clearAuthCache();
  withFakeNow(2_000_000, (advance) => {
    setCachedAuth(8, { tokenGeneration: 3, userDisabled: false, agencyDisabled: false });
    advance(10_000);
    setCachedAuth(8, { tokenGeneration: 3, userDisabled: false, agencyDisabled: false });
    advance(10_000); // 20s past the original write — but only 10s past the refresh
    const got = getCachedAuth(8);
    assert.ok(got, "equal-gen overwrite must reset expiresAt so the entry survives");
    assert.equal(got.tokenGeneration, 3);
  });
});

test("setCachedAuth: an expired higher-gen entry does NOT block a lower-gen write", () => {
  // After TTL expires the cached entry no longer represents authoritative state,
  // so the generation guard MUST stop applying — otherwise a user whose
  // generation appears to "rewind" (e.g. process restart loses bumpTokenGeneration
  // state in dev without a DB, or a downgrade rollback) would be permanently
  // uncacheable. The implementation handles this by `cache.delete`-ing the
  // expired entry before the generation check; this test pins that ordering.
  clearAuthCache();
  withFakeNow(3_000_000, (advance) => {
    setCachedAuth(9, { tokenGeneration: 10, userDisabled: false, agencyDisabled: false });
    advance(15_001); // past TTL
    setCachedAuth(9, { tokenGeneration: 1, userDisabled: true, agencyDisabled: false });
    const got = getCachedAuth(9);
    assert.ok(got, "expired entry must not protect a lower-gen write from landing");
    assert.equal(got.tokenGeneration, 1);
    assert.equal(got.userDisabled, true);
  });
});

test("getCachedAuth: an expired entry is evicted (TTL=15s)", () => {
  clearAuthCache();
  withFakeNow(1_000_000, (advance) => {
    setCachedAuth(11, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
    advance(14_999);
    assert.ok(getCachedAuth(11), "still inside TTL");
    advance(2); // total +15_001
    assert.equal(getCachedAuth(11), null, "must be evicted past 15s");
    // And the second call must also be null (eviction is sticky).
    assert.equal(getCachedAuth(11), null);
  });
});

test("invalidateCachedAuth: forces the NEXT read to miss even mid-TTL", () => {
  // This is the load-bearing semantic for "newest sign-in wins": the
  // freshly-logged-in client just bumped token_generation in Postgres, and
  // any stale cache entry for that user must be flushed so the OLD device's
  // next API call hits the database and is superseded immediately.
  clearAuthCache();
  setCachedAuth(99, { tokenGeneration: 5, userDisabled: false, agencyDisabled: false });
  assert.ok(getCachedAuth(99));
  invalidateCachedAuth(99);
  assert.equal(getCachedAuth(99), null);
});

test("invalidateCachedAuth: only touches the targeted user (no collateral eviction)", () => {
  clearAuthCache();
  setCachedAuth(1, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  setCachedAuth(2, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  invalidateCachedAuth(1);
  assert.equal(getCachedAuth(1), null);
  assert.ok(getCachedAuth(2), "user 2 must be untouched by invalidating user 1");
});

test("invalidateCachedAuth: invalidating an absent user is a safe no-op", () => {
  clearAuthCache();
  invalidateCachedAuth(404);
  assert.equal(getCachedAuth(404), null);
  // And it must not have somehow created a row by deleting nothing.
  setCachedAuth(404, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  assert.ok(getCachedAuth(404));
});

test("clearAuthCache: drops every entry (test-isolation handle)", () => {
  setCachedAuth(1, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  setCachedAuth(2, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  setCachedAuth(3, { tokenGeneration: 1, userDisabled: false, agencyDisabled: false });
  clearAuthCache();
  assert.equal(getCachedAuth(1), null);
  assert.equal(getCachedAuth(2), null);
  assert.equal(getCachedAuth(3), null);
});
