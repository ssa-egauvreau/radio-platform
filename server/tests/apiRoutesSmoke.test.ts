/**
 * Smoke test for `server/src/apiRoutes.ts`.
 *
 * Why this exists
 * ---------------
 * `apiRoutes.ts` is the entire HTTP surface of the server — it's 2900+
 * lines of Express route handlers and is imported transitively by
 * `src/index.ts` on boot. If it fails to even *parse* (syntax error) or
 * fails to *import* (duplicate symbol, circular import, etc.), the server
 * does not start and no other test in this suite catches it — every
 * server unit test today imports a single helper module in isolation
 * (`auth.js`, `audioConfigDerive.js`, etc.) and none of them transitively
 * pull in `apiRoutes.js`.
 *
 * History this test guards against
 * --------------------------------
 * PR #142 was merged with a botched conflict resolution in the
 * `GET /v1/audio/config` handler that left two `res.json({…})` calls
 * stacked on top of each other and a duplicate `import { deriveDeviceAudioConfig }`
 * from two different files. `tsc --noEmit` failed with five syntax errors
 * and `tsx` refused to load the module at all. The npm test suite passed
 * anyway (no unit test imported the file) and the broken state shipped to
 * `main` — the next production deploy would have failed to come up.
 *
 * This test would have caught that the moment it ran.
 *
 * What is asserted
 * ----------------
 *  1. `apiRoutes.js` can be dynamically imported (parses + resolves all
 *     of its transitive imports + has no top-level throws).
 *  2. `createApiRouter` is exported and is a function.
 *  3. Calling `createApiRouter()` returns an Express Router (i.e. a
 *     function with a `.stack` array) and has registered a non-trivial
 *     number of routes. The exact count is not asserted because that
 *     would be brittle — the assertion is just "at least the order of
 *     magnitude we expect", which catches an empty/broken build but
 *     ignores normal route churn.
 *
 * The test deliberately does NOT exercise any individual route — that
 * would require mocking the Postgres pool and is outside this file's
 * "did the module load at all?" scope. Per-route behaviour is covered by
 * the focused module tests next to each helper file (`auth.test.ts`,
 * `audioConfigDerive.test.ts`, `clientType.test.ts`, etc.).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// auth.ts reads JWT_SECRET at import time; set a deterministic one so the
// random-secret warning is suppressed and the production-mode fatal exit
// (NODE_ENV=production with no JWT_SECRET) cannot fire under any test
// runner environment.
process.env.JWT_SECRET ??= "smoke-test-secret";

test("apiRoutes.js: module loads, exports createApiRouter, builds a non-empty Router", async () => {
  const mod = await import("../src/apiRoutes.js");
  assert.equal(
    typeof mod.createApiRouter,
    "function",
    "createApiRouter must be exported as a function",
  );

  const router = mod.createApiRouter();
  assert.equal(typeof router, "function", "Express routers are callable middleware");

  // Express attaches the registered routes to router.stack. Use a loose
  // floor that flags an empty or truncated router but won't churn as
  // handlers are added or removed during normal feature work.
  const stack = (router as unknown as { stack: unknown[] }).stack;
  assert.ok(Array.isArray(stack), "router.stack must be an array");
  assert.ok(
    stack.length >= 20,
    `expected the API router to register at least 20 routes, got ${stack.length}`,
  );
});
