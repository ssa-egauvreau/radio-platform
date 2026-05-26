/**
 * Tests for `server/src/sessionCache.ts`.
 *
 * The session cache is the auth fast-path that every authenticated
 * REST + WS handler hits before the per-request middleware in
 * `apiRoutes.ts` decides whether to run the disabled-account /
 * session-supersede SQL lookup. At Android's poll cadence (AIR 250 ms,
 * talk-activity 1.2 s, inbox 2 s, presence 12 s) a single online handset
 * is ~5 requests/sec, so a regression here either:
 *
 *  - Misses a cache hit → every authenticated request hammers Postgres
 *    and burns the connection pool (the exact reason this cache exists).
 *  - Serves a stale entry past its TTL → a freshly-disabled account
 *    keeps working for an unbounded window instead of the documented
 *    ≤15 s lag.
 *  - Forgets to evict on `invalidateCachedAuth` → the "newest sign-in
 *    wins" semantic breaks; an attacker stealing an old token can hold
 *    a session open for up to TTL_MS after the legitimate user logs in.
 *  - Leaks one user's row to another userId → catastrophic
 *    cross-account leak. Pinned with explicit per-user assertions.
 *
 * State isolation: the cache is a module-level Map with no exported
 * reset besides `clearAuthCache`. Each test below either uses a
 * monotonically-bumped userId or calls `clearAuthCache` in setup so
 * concurrent / sequential tests can never collide on the same entry.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clearAuthCache,
  getCachedAuth,
  invalidateCachedAuth,
  setCachedAuth,
} from "../src/sessionCache.js";

// Bump per test so module-level Map state cannot leak across cases
// even if a test forgets to clean up after itself.
let NEXT_USER = 9_000_000;
function uniqueUser(): number {
  return NEXT_USER++;
}

test("setCachedAuth + getCachedAuth: round-trips the documented fields", () => {
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 7,
    userDisabled: false,
    agencyDisabled: false,
  });
  const got = getCachedAuth(userId);
  assert.notEqual(got, null);
  assert.equal(got?.tokenGeneration, 7);
  assert.equal(got?.userDisabled, false);
  assert.equal(got?.agencyDisabled, false);
});

test("getCachedAuth: returns null for an unknown user (no false-positive hit)", () => {
  // A cold cache MUST return null so the middleware falls through to
  // the SQL lookup. A regression that returned a zeroed-out object
  // would silently grant access to a user that was never validated.
  const userId = uniqueUser();
  assert.equal(getCachedAuth(userId), null);
});

test("setCachedAuth: overwrites an existing entry rather than merging", () => {
  // Login bumps `tokenGeneration` and re-warms the cache. The new
  // entry must replace the old one — a merge would let a stale
  // `userDisabled=false` survive across a disable → re-enable flap.
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 1,
    userDisabled: true,
    agencyDisabled: true,
  });
  setCachedAuth(userId, {
    tokenGeneration: 2,
    userDisabled: false,
    agencyDisabled: false,
  });
  const got = getCachedAuth(userId);
  assert.equal(got?.tokenGeneration, 2);
  assert.equal(got?.userDisabled, false);
  assert.equal(got?.agencyDisabled, false);
});

test("setCachedAuth: each userId is isolated (no cross-account leak)", () => {
  // The Map is keyed by userId; if a refactor ever introduced a
  // shared bucket (e.g. agencyId or a hash collision), one user's
  // cached auth would surface for another user's request.
  const userA = uniqueUser();
  const userB = uniqueUser();
  setCachedAuth(userA, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  setCachedAuth(userB, {
    tokenGeneration: 99,
    userDisabled: true,
    agencyDisabled: true,
  });
  assert.equal(getCachedAuth(userA)?.tokenGeneration, 1);
  assert.equal(getCachedAuth(userA)?.userDisabled, false);
  assert.equal(getCachedAuth(userB)?.tokenGeneration, 99);
  assert.equal(getCachedAuth(userB)?.userDisabled, true);
});

test("invalidateCachedAuth: drops the entry so the next read re-fetches the truth", () => {
  // Called after a fresh login bumps token_generation so the
  // "session superseded" check fires immediately on the old device's
  // next request instead of waiting up to TTL_MS.
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  assert.notEqual(getCachedAuth(userId), null);
  invalidateCachedAuth(userId);
  assert.equal(getCachedAuth(userId), null);
});

test("invalidateCachedAuth: is a no-op for users who were never cached (no throw)", () => {
  // Login flow always invalidates whether or not the user had a
  // cached entry — must not throw on a cold cache.
  assert.doesNotThrow(() => invalidateCachedAuth(uniqueUser()));
});

test("invalidateCachedAuth: only drops the targeted user, leaves others intact", () => {
  // A regression that called `.clear()` instead of `.delete(userId)`
  // would log every other user out of cache on every login. Costly
  // but invisible — pin it explicitly.
  const userA = uniqueUser();
  const userB = uniqueUser();
  setCachedAuth(userA, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  setCachedAuth(userB, {
    tokenGeneration: 2,
    userDisabled: false,
    agencyDisabled: false,
  });
  invalidateCachedAuth(userA);
  assert.equal(getCachedAuth(userA), null);
  assert.notEqual(getCachedAuth(userB), null);
  assert.equal(getCachedAuth(userB)?.tokenGeneration, 2);
});

test("clearAuthCache: drops every entry and is idempotent", () => {
  const userA = uniqueUser();
  const userB = uniqueUser();
  setCachedAuth(userA, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  setCachedAuth(userB, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  clearAuthCache();
  assert.equal(getCachedAuth(userA), null);
  assert.equal(getCachedAuth(userB), null);
  // Calling it again on an already-empty cache must not throw.
  assert.doesNotThrow(() => clearAuthCache());
});

test("getCachedAuth: returns the cached entry within the 15s TTL window", async (t) => {
  // The TTL is 15s; mocking Date lets us prove the boundary without
  // making the test wall-clock-sensitive (and without making CI
  // pause for 15 seconds on every run).
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 5,
    userDisabled: false,
    agencyDisabled: false,
  });
  t.mock.timers.tick(14_000); // 14s — still inside TTL
  const got = getCachedAuth(userId);
  assert.notEqual(got, null);
  assert.equal(got?.tokenGeneration, 5);
});

test("getCachedAuth: returns null and evicts once the 15s TTL elapses", async (t) => {
  // After TTL the cache MUST report null so the middleware re-checks
  // the SQL truth. A regression that kept serving stale rows would
  // let a disabled user keep working for an unbounded window.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 5,
    userDisabled: false,
    agencyDisabled: false,
  });
  t.mock.timers.tick(16_000); // 16s — past TTL
  assert.equal(getCachedAuth(userId), null);
  // Hitting it again should still be null (entry already evicted on
  // the previous read; a second read must not resurrect it).
  assert.equal(getCachedAuth(userId), null);
});

test("setCachedAuth: refreshes the TTL window so a re-warmed entry survives past the original deadline", async (t) => {
  // Each setCachedAuth re-stamps `expiresAt = Date.now() + TTL_MS`,
  // so a re-warmed cache (after a SQL re-check at the boundary) must
  // stay alive for a fresh full window — not get pruned because the
  // first warm-up landed in the distant past.
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  t.mock.timers.tick(10_000);
  setCachedAuth(userId, {
    tokenGeneration: 1,
    userDisabled: false,
    agencyDisabled: false,
  });
  t.mock.timers.tick(10_000); // 20s total, but only 10s since refresh
  assert.notEqual(
    getCachedAuth(userId),
    null,
    "refreshed entry should survive past the original 15s deadline",
  );
});

test("getCachedAuth: exposes the three documented fields callers read", () => {
  // The exported TypeScript type is `Omit<CachedAuth, "expiresAt">` so
  // callers (the middleware in `apiRoutes.ts`) can only see
  // `tokenGeneration`, `userDisabled`, `agencyDisabled` at the type
  // layer. The runtime object today happens to also carry `expiresAt`
  // (the implementation just hands back the stored entry), but the
  // contract callers depend on is the three documented fields — this
  // assertion is a tripwire for those three names changing shape.
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 3,
    userDisabled: false,
    agencyDisabled: false,
  });
  const got = getCachedAuth(userId);
  assert.notEqual(got, null);
  for (const key of ["tokenGeneration", "userDisabled", "agencyDisabled"] as const) {
    assert.ok(key in (got as object), `cached entry must expose '${key}'`);
  }
});

test("setCachedAuth: preserves truthy/falsy `userDisabled` / `agencyDisabled` flags exactly", () => {
  // The middleware short-circuits on these booleans; a regression
  // that flipped one of them (e.g. ?? defaulting `userDisabled` to
  // `false`) would silently un-disable a banned account on every
  // cache hit.
  const userId = uniqueUser();
  setCachedAuth(userId, {
    tokenGeneration: 1,
    userDisabled: true,
    agencyDisabled: true,
  });
  const got = getCachedAuth(userId);
  assert.equal(got?.userDisabled, true);
  assert.equal(got?.agencyDisabled, true);
});
