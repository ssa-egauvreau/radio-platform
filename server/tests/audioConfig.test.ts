/**
 * Tests for `server/src/audioConfig.ts`.
 *
 * `deriveDeviceAudioConfig` is the pure mapping that GET /v1/audio/config
 * serves to every Android, iOS, and web client. A regression here either
 *
 *  (a) silently re-introduces a post-capture gain on top of the
 *      "Bridge-style minimal / bypassMicProcessing=true" claim — exactly the
 *      bug PR #131 / commit 8967253 fixed — so handsets ship 3× hot audio
 *      while the admin UI says "no processing", or
 *
 *  (b) flips the Android NoiseSuppressor toggle out of sync with what the
 *      lab actually has running on the server (wind gate / steep HPF).
 *
 * Both failure modes are silent — only an audio engineer A/B-ing on real
 * handsets would notice. These tests lock the contract in place.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveDeviceAudioConfig,
  type PersistedAudioLabConfig,
} from "../src/audioConfig.js";

test("deriveDeviceAudioConfig: null/undefined config -> safe defaults", () => {
  for (const empty of [null, undefined, {} as PersistedAudioLabConfig, { preImbe: {} }]) {
    const got = deriveDeviceAudioConfig(empty);
    assert.deepEqual(got, {
      agcEnabled: false,
      noiseSuppression: false,
      gainMultiplier: 1.0,
      bypassMicProcessing: false,
    });
  }
});

test("deriveDeviceAudioConfig: agcMaxGain=4 -> ~1.67× (smallest simple-UI preset still boosts)", () => {
  // The "A little" preset uses agcMaxGain=4. The mapping must stay above 1.0
  // there so the preset is audibly different from "off" on real handsets.
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 4 },
  });
  // 1 + (4/12)*2 = 1.6666… -> rounded to two decimals.
  assert.equal(got.gainMultiplier, 1.67);
  assert.equal(got.agcEnabled, true);
});

test("deriveDeviceAudioConfig: agcMaxGain=12 -> 3.0× (top of the curve)", () => {
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 12 },
  });
  assert.equal(got.gainMultiplier, 3.0);
});

test("deriveDeviceAudioConfig: agcMaxGain above 12 is clamped to 3.0× (no run-away gain)", () => {
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 999 },
  });
  assert.equal(got.gainMultiplier, 3.0);
});

test("deriveDeviceAudioConfig: negative agcMaxGain is clamped to 1.0× (devices never get sub-unity gain)", () => {
  // A negative value would otherwise map to a fractional multiplier (e.g.
  // -6 -> 0×). The Math.max(1.0, …) floor protects handsets from being told
  // to attenuate post-capture.
  for (const gain of [-1, -6, -999]) {
    const got = deriveDeviceAudioConfig({
      preImbe: { agcEnabled: true, agcMaxGain: gain },
    });
    assert.equal(
      got.gainMultiplier,
      1.0,
      `agcMaxGain=${gain} must clamp to 1.0`,
    );
  }
});

test("deriveDeviceAudioConfig: agcMaxGain=0 with AGC on stays at 1.0× (curve bottom matches off)", () => {
  // 1 + (0/12)*2 = 1.0 exactly; this anchors the "AGC on but minimum gain"
  // edge against silent regressions if the curve formula is ever tweaked.
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 0 },
  });
  assert.equal(got.gainMultiplier, 1.0);
});

test("deriveDeviceAudioConfig: agcEnabled=false forces gainMultiplier=1.0 even with a large agcMaxGain", () => {
  // The lab can leave an old agcMaxGain value behind after the admin disables
  // AGC — that residue must never sneak through as a post-capture boost.
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: false, agcMaxGain: 12 },
  });
  assert.equal(got.gainMultiplier, 1.0);
  assert.equal(got.agcEnabled, false);
});

test("deriveDeviceAudioConfig: bypassMicProcessing=true forces gainMultiplier=1.0 even with agcEnabled=true (regression: PR #131 / 8967253)", () => {
  // This is the exact bug-fix scenario: a stale agcEnabled=true (e.g. from a
  // previous "Maximum boost" preset) combined with bypass=true must NOT
  // ship 3× software gain on top of the "no processing" claim. Pre-fix this
  // returned 3.0 — that would be a silent regression on handsets.
  const got = deriveDeviceAudioConfig({
    preImbe: {
      bypassMicProcessing: true,
      agcEnabled: true,
      agcMaxGain: 12,
    },
  });
  assert.equal(got.gainMultiplier, 1.0);
  assert.equal(got.bypassMicProcessing, true);
  // agcEnabled is reported faithfully so the device UI / debug logs match the
  // server config; only the gain output is suppressed.
  assert.equal(got.agcEnabled, true);
});

test("deriveDeviceAudioConfig: noiseSuppression is the OR of windGate and windHpf (Android only has one toggle)", () => {
  const onlyGate = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: true, windHpfEnabled: false },
  });
  assert.equal(onlyGate.noiseSuppression, true);

  const onlyHpf = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: false, windHpfEnabled: true },
  });
  assert.equal(onlyHpf.noiseSuppression, true);

  const both = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: true, windHpfEnabled: true },
  });
  assert.equal(both.noiseSuppression, true);

  const neither = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: false, windHpfEnabled: false },
  });
  assert.equal(neither.noiseSuppression, false);
});

test("deriveDeviceAudioConfig: gainMultiplier is rounded to two decimals (no float noise on the wire)", () => {
  // Any agcMaxGain that produces an irrational-looking decimal must come
  // back rounded — clients persist this value to SharedPreferences and we
  // don't want spurious "config changed" events from float drift.
  const got = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 7 },
  });
  // 1 + (7/12)*2 = 2.16666… -> 2.17.
  assert.equal(got.gainMultiplier, 2.17);
  // No more than 2 fractional digits.
  const str = got.gainMultiplier.toString();
  const dot = str.indexOf(".");
  if (dot >= 0) {
    assert.ok(
      str.length - dot - 1 <= 2,
      `gainMultiplier=${str} must have <=2 decimal places`,
    );
  }
});

test("deriveDeviceAudioConfig: pure — same input twice produces equal output", () => {
  const input: PersistedAudioLabConfig = {
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 8,
      windGateEnabled: true,
      windHpfEnabled: false,
      bypassMicProcessing: false,
    },
  };
  assert.deepEqual(deriveDeviceAudioConfig(input), deriveDeviceAudioConfig(input));
});
