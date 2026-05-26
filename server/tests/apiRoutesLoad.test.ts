/**
 * Regression — `createApiRouter()` must load cleanly, and the GET
 * `/v1/audio/config` route must be wired through the full-config
 * `deriveDeviceAudioConfig` from `audioConfig.ts` (not the `preImbe`-only
 * variant from `audioConfigDevice.ts`).
 *
 * Context: a botched merge between PR #148 and PR #150 left two competing
 * imports of `deriveDeviceAudioConfig` plus a half-open `res.json({`
 * followed by an unrelated comment in the GET audio-config handler. The
 * file didn't parse at all; `tsc --noEmit` failed with 6+ errors and the
 * server would crash on startup the moment Node tried to evaluate the
 * module. There is no existing route-level test in this repo, so the only
 * thing that would have caught it before production was a type check —
 * which Cloud Agents in this branch were silently skipping.
 *
 * What this catches that the per-helper suites do not:
 *  - `createApiRouter()` actually evaluates — any future merge artifact in
 *    apiRoutes.ts will throw on import here and fail this test instantly.
 *  - The router exposes a GET /audio/config handler (so renaming or
 *    deleting the route accidentally also fails).
 *  - `deriveDeviceAudioConfig` from `audioConfig.ts` (the variant the
 *    route imports) accepts a full AudioLabConfig shape — `{ preImbe: { … } }`
 *    — not just the inner `preImbe` slice. Swapping to the slice-only
 *    variant from `audioConfigDevice.ts` while still passing `row.config`
 *    silently ships `agcEnabled=false, gainMultiplier=1` to every handset
 *    even when the admin had AGC turned on. That is the wire contract
 *    PR #151 was trying to defend.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createApiRouter } from "../src/apiRoutes.js";
import { deriveDeviceAudioConfig } from "../src/audioConfig.js";

test("apiRoutes: createApiRouter() loads + exports a usable Express Router", () => {
  // If this import or call throws, the module didn't parse / didn't wire up
  // cleanly. That alone is the regression we're guarding against.
  const router = createApiRouter();
  assert.ok(router, "createApiRouter must return a value");
  assert.equal(typeof router, "function", "Express routers are callable middleware");
  // The stack is an internal Express implementation detail, but it's the
  // cheapest way to assert the audio-config route is actually registered
  // without spinning up an HTTP server. Walk it and look for the path.
  const stack = (router as unknown as { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> }).stack ?? [];
  const audioConfigGet = stack.find(
    (layer) =>
      layer.route?.path === "/audio/config" && layer.route?.methods?.get === true,
  );
  assert.ok(audioConfigGet, "GET /audio/config must be registered on the router");
});

test("audioConfig.deriveDeviceAudioConfig: accepts the FULL row.config shape (not just preImbe)", () => {
  // The route passes the entire stored AudioLabConfig blob (`row.config`)
  // straight into `deriveDeviceAudioConfig`. The function MUST read the
  // nested `preImbe.*` keys itself. If a future refactor swaps the import
  // to `audioConfigDevice.ts` (which expects only the inner preImbe slice),
  // this test fails immediately because `agcMaxGain=10` would be ignored.
  const fullConfig = {
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 10,
      windGateEnabled: true,
      windHpfEnabled: false,
      bypassMicProcessing: false,
    },
    // Other AudioLabConfig sections (codec, post-IMBE, …) are ignored on
    // purpose — the helper must not throw on extra keys.
    codec: { bitrate: 4400 },
    postImbe: { someFutureField: true },
  };
  const summary = deriveDeviceAudioConfig(fullConfig);
  assert.equal(summary.agcEnabled, true, "AGC flag must reflect preImbe.agcEnabled");
  assert.equal(summary.noiseSuppression, true, "windGate→NS must be honored");
  assert.equal(summary.bypassMicProcessing, false);
  // gain curve: 1.0 + (10/12)*2.0 = 2.6666… → 2.67 after 2dp rounding
  assert.equal(summary.gainMultiplier, 2.67, "agcMaxGain must drive the curve");
});

test("audioConfig.deriveDeviceAudioConfig: bypass forces gainMultiplier=1.0 even with stale AGC", () => {
  // Production bug PR #132 fixed: an admin who picked "Bridge-style
  // minimal" but still had agcEnabled=true from a prior "Maximum boost"
  // preset shipped a 3× software gain on top of the "no processing" claim.
  // The route guarantees this can't happen — pin the contract.
  const summary = deriveDeviceAudioConfig({
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 12,
      bypassMicProcessing: true,
    },
  });
  assert.equal(summary.bypassMicProcessing, true);
  assert.equal(summary.gainMultiplier, 1.0, "bypass MUST collapse the gain curve to unity");
});

test("audioConfig.deriveDeviceAudioConfig: null/undefined/non-object inputs return safe defaults", () => {
  // The route hits this path with `row.config` whose type is `unknown`
  // (it's a JSONB column). A malformed row must not crash the route — it
  // must degrade to the conservative "off" defaults so the handset just
  // ignores server config and falls back to its own.
  for (const input of [null, undefined, "string", 42, [] as unknown]) {
    const summary = deriveDeviceAudioConfig(input);
    assert.equal(summary.agcEnabled, false);
    assert.equal(summary.noiseSuppression, false);
    assert.equal(summary.bypassMicProcessing, false);
    assert.equal(summary.gainMultiplier, 1.0, "no gain by default on garbage input");
  }
});
