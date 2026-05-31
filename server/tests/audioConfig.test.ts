/**
 * Tests for `server/src/audioConfig.ts`.
 *
 * `deriveDeviceAudioConfig` is the mapping that every handset (Android, iOS)
 * and the web voice client hit on `GET /v1/audio/config` to learn what
 * mic-processing chain the agency wants in effect. A silent regression here
 * ships a misconfigured mic chain to the whole fleet without any visible
 * server error.
 *
 * The bug we're guarding against most aggressively is the PR-131 follow-up
 * (commit 8967253): an admin who combined `bypassMicProcessing=true` with a
 * leftover `agcEnabled=true` from an earlier "Maximum boost" preset was
 * shipped a 3× software gain on top of the "no processing" claim, because
 * the gainMultiplier mapping ignored the bypass flag. The fix forces
 * `gainMultiplier=1.0` whenever `bypassMicProcessing` is on, regardless of
 * `agcEnabled` or `agcMaxGain`. That contract is what the tests below pin.
 *
 * Post-decode shaping is force-disabled fleet-wide: `deriveDeviceAudioConfig`
 * always returns `postDecode: null` so every client plays raw decoded IMBE at
 * the legacy sample-duplicate path (the original voicing from before the Audio
 * Lab post-decode chain landed). The shaping derivation itself is preserved and
 * still fully exercised below via the standalone `derivePostDecodeBlock`, so
 * re-enabling agency-pushed shaping is a one-line change in audioConfig.ts that
 * these tests would immediately catch.
 *
 * Other regressions to watch for:
 *
 *  - `agcEnabled=false` failing to force `gainMultiplier=1.0` → handsets
 *    that disabled AGC silently still get a gain boost.
 *  - The `noiseSuppression` OR'ing only one of the two upstream flags →
 *    Android handsets engage NoiseSuppressor for the wrong subset of presets.
 *  - The clamp on `agcMaxGain` losing its floor of 1.0 → a negative or zero
 *    gain configures a negative multiplier and silently mutes the channel.
 *  - The 2-decimal rounding drifting → JSON payload churns between deploys
 *    on identical config inputs, defeating the handset's
 *    "updatedAt + config-hash" change detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveDeviceAudioConfig, derivePostDecodeBlock } from "../src/audioConfig.js";

/**
 * Adapter for the shaping tests. `deriveDeviceAudioConfig` no longer surfaces a
 * shaped `postDecode` (it's force-disabled fleet-wide — see the force-off pins
 * below), so the chain-derivation tests call the preserved `derivePostDecodeBlock`
 * directly. This wrapper keeps their `.postDecode` assertions intact by mapping a
 * full lab config to the same `{ postDecode }` shape `derivePostDecodeBlock` feeds.
 */
function shapeFromConfig(cfg: { postDecode?: Record<string, unknown> }): {
  postDecode: ReturnType<typeof derivePostDecodeBlock>;
} {
  return { postDecode: derivePostDecodeBlock(cfg.postDecode) };
}

test("deriveDeviceAudioConfig: null input → safe all-off defaults (gain=1.0)", () => {
  // A handset connecting before an admin has ever pushed a config still
  // needs a well-formed response so its capture chain initialises in the
  // "do nothing" state rather than crashing on undefined fields.
  const out = deriveDeviceAudioConfig(null);
  assert.deepEqual(out, {
    agcEnabled: false,
    noiseSuppression: false,
    gainMultiplier: 1.0,
    bypassMicProcessing: false,
    postDecode: null,  });
});

test("deriveDeviceAudioConfig: empty object → same safe defaults", () => {
  // A bare {} (no preImbe) is what the JSON validation in the PUT route lets
  // through for a partially-populated config — must not crash, must produce
  // the same safe defaults as a null input.
  assert.deepEqual(deriveDeviceAudioConfig({}), {
    agcEnabled: false,
    noiseSuppression: false,
    gainMultiplier: 1.0,
    bypassMicProcessing: false,
    postDecode: null,  });
});

test("deriveDeviceAudioConfig: array input is rejected → defaults", () => {
  // typeof [] === "object" in JS — guard explicitly so a corrupted DB row
  // doesn't get a phantom preImbe lookup.
  assert.deepEqual(deriveDeviceAudioConfig([]), {
    agcEnabled: false,
    noiseSuppression: false,
    gainMultiplier: 1.0,
    bypassMicProcessing: false,
    postDecode: null,  });
});

test("deriveDeviceAudioConfig: agcEnabled=false forces gainMultiplier=1.0 regardless of agcMaxGain", () => {
  // Even with the slider pinned at the top, AGC-off means no make-up gain.
  const out = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: false, agcMaxGain: 12 },
  });
  assert.equal(out.agcEnabled, false);
  assert.equal(out.gainMultiplier, 1.0);
});

test("deriveDeviceAudioConfig: agcEnabled=true with default agcMaxGain (6) → 2.0×", () => {
  // 1.0 + (6/12)*2 = 2.0 exactly.
  const out = deriveDeviceAudioConfig({ preImbe: { agcEnabled: true } });
  assert.equal(out.agcEnabled, true);
  assert.equal(out.gainMultiplier, 2.0);
});

test("deriveDeviceAudioConfig: agcMaxGain endpoints map to 1.0× and 3.0×", () => {
  // The published contract is "agcMaxGain 1–12 maps into [1.0, 3.0]"; clients
  // depend on the endpoints being exact, not approximate.
  const min = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 0 },
  });
  // 1 + (0/12)*2 = 1.0 (already at the clamp floor).
  assert.equal(min.gainMultiplier, 1.0);

  const max = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 12 },
  });
  assert.equal(max.gainMultiplier, 3.0);
});

test("deriveDeviceAudioConfig: agcMaxGain is clamped to [1.0, 3.0] for out-of-band slider values", () => {
  // A stale config from a different schema version (or a manual DB poke)
  // must not be able to push the device gain past 3.0× or below 1.0×.
  const huge = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 99 },
  });
  assert.equal(huge.gainMultiplier, 3.0, "agcMaxGain=99 must clamp to 3.0×");

  const negative = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: -50 },
  });
  assert.equal(
    negative.gainMultiplier,
    1.0,
    "negative agcMaxGain must clamp to 1.0× (never mute)",
  );
});

test("deriveDeviceAudioConfig: bypassMicProcessing=true forces gainMultiplier=1.0 even with agcEnabled=true at max", () => {
  // This is the PR-131 follow-up regression (commit 8967253). The whole
  // point of "Bridge-style minimal" is no post-capture gain — a leftover
  // agcEnabled=true from an earlier preset must NOT sneak a 3× gain past
  // the bypass flag.
  const out = deriveDeviceAudioConfig({
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 12,
      bypassMicProcessing: true,
      postDecode: null,    },
  });
  assert.equal(out.bypassMicProcessing, true);
  assert.equal(out.agcEnabled, true, "agcEnabled passes through unchanged");
  assert.equal(
    out.gainMultiplier,
    1.0,
    "bypass must hard-floor gain to 1.0× regardless of AGC state",
  );
});

test("deriveDeviceAudioConfig: noiseSuppression is the OR of windGateEnabled and windHpfEnabled", () => {
  // Android only exposes a single NoiseSuppressor toggle, so the route OR's
  // the two upstream controls. Each branch must independently enable it.
  const neither = deriveDeviceAudioConfig({ preImbe: {} });
  assert.equal(neither.noiseSuppression, false);

  const gateOnly = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: true },
  });
  assert.equal(gateOnly.noiseSuppression, true);

  const hpfOnly = deriveDeviceAudioConfig({
    preImbe: { windHpfEnabled: true },
  });
  assert.equal(hpfOnly.noiseSuppression, true);

  const both = deriveDeviceAudioConfig({
    preImbe: { windGateEnabled: true, windHpfEnabled: true },
  });
  assert.equal(both.noiseSuppression, true);
});

test("deriveDeviceAudioConfig: gainMultiplier is rounded to 2 decimals", () => {
  // The handset's change-detection compares the JSON payload across pulls;
  // unstable trailing digits would force a needless config re-apply on every
  // poll even when nothing changed.
  const out = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 1 },
  });
  // 1 + (1/12)*2 = 1.16666... → 1.17 to 2 decimals.
  assert.equal(out.gainMultiplier, 1.17);

  const out2 = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 5 },
  });
  // 1 + (5/12)*2 = 1.8333... → 1.83.
  assert.equal(out2.gainMultiplier, 1.83);
});

test("deriveDeviceAudioConfig: preserves the bypassMicProcessing flag verbatim on the way to the device", () => {
  // The handset uses this flag for more than just the gain decision — it
  // also drives whether the browser/OS EC/NS/AGC are disabled and whether
  // the TX conditioner skips its expander stage. So even when the gain
  // result happens to coincide, the flag itself must round-trip honestly.
  assert.equal(
    deriveDeviceAudioConfig({ preImbe: { bypassMicProcessing: true } })
      .bypassMicProcessing,
    true,
  );
  assert.equal(
    deriveDeviceAudioConfig({ preImbe: { bypassMicProcessing: false } })
      .bypassMicProcessing,
    false,
  );
  // Missing flag → false (matches the pre-PR-131 default fleet behaviour).
  assert.equal(
    deriveDeviceAudioConfig({ preImbe: {} }).bypassMicProcessing,
    false,
  );
});

test("deriveDeviceAudioConfig: ignores top-level keys outside preImbe (postDecode / vocoder)", () => {
  // The full AudioLabConfig stored in the DB has `postDecode` and `vocoder`
  // siblings; this device-facing summary must not accidentally pull from
  // them or change shape if a future Audio Lab adds more top-level sections.
  const out = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 6 },
    postDecode: { something: true },
    vocoder: { something: true },
  });
  assert.deepEqual(out, {
    agcEnabled: true,
    noiseSuppression: false,
    gainMultiplier: 2.0,
    bypassMicProcessing: false,
    postDecode: null,  });
});

test("deriveDeviceAudioConfig: every field type matches the device-side contract", () => {
  // Android / iOS deserialise into a struct with these exact JS types. If
  // the helper ever started returning e.g. `gainMultiplier: "2.0"` (string)
  // the clients would parse it as NaN and silently fall back to 1.0.
  const out = deriveDeviceAudioConfig({
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 8,
      windGateEnabled: true,
      bypassMicProcessing: false,
      postDecode: null,    },
  });
  assert.equal(typeof out.agcEnabled, "boolean");
  assert.equal(typeof out.noiseSuppression, "boolean");
  assert.equal(typeof out.gainMultiplier, "number");
  assert.equal(typeof out.bypassMicProcessing, "boolean");
  assert.equal(Number.isFinite(out.gainMultiplier), true);
});

// --- Post-decode shaping force-off (fleet-wide) -----------------------------
// deriveDeviceAudioConfig must NEVER surface a shaped postDecode block, no
// matter what an admin has saved. This restores the original raw-IMBE voicing
// from before the Audio Lab post-decode chain existed. The shaping math is
// still derived and tested below via derivePostDecodeBlock; only the wiring
// into the device payload is severed.

test("deriveDeviceAudioConfig: postDecode is force-disabled even when a heavy shaping config is pushed", () => {
  const out = deriveDeviceAudioConfig({
    preImbe: { agcEnabled: true, agcMaxGain: 6 },
    postDecode: {
      upsampleMode: "polyphase",
      dmrCharacter: 100,
      compressorEnabled: true,
      compressorRatio: 8,
      rogerBeepEnabled: true,
      squelchTailEnabled: true,
      presenceEnabled: true,
      saturationAmount: 0.5,
    },
    vocoder: {},
  });
  assert.equal(
    out.postDecode,
    null,
    "no agency-pushed shaping may reach the device — postDecode is always null",
  );
});

test("deriveDeviceAudioConfig: postDecode stays null across a representative spread of saved configs", () => {
  const configs: unknown[] = [
    { postDecode: { upsampleMode: "polyphase" } },
    { postDecode: { hpfEnabled: true, hpfHz: 300 } },
    { postDecode: { wideband: true, dmrCharacter: 50 } },
    { postDecode: { rogerBeepEnabled: true } },
    { preImbe: { agcEnabled: true }, postDecode: { saturationAmount: 0.3 } },
  ];
  for (const cfg of configs) {
    assert.equal(deriveDeviceAudioConfig(cfg).postDecode, null);
  }
});

// --- DMR character dial -----------------------------------------------------
// These exercise the preserved shaping derivation directly (derivePostDecodeBlock).
// deriveDeviceAudioConfig force-disables the chain, so these confirm the math
// is intact for the day shaping is re-enabled — and document its contract.

test("derivePostDecodeBlock: dmrCharacter=0 (off) leaves admin postDecode fields untouched", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "polyphase",
      hpfEnabled: false,
      lpfEnabled: false,
      saturationAmount: 0.1,
      dmrCharacter: 0,
    },
  });
  // Saturation passes through untouched; HPF/LPF stay disabled.
  assert.equal(out.postDecode?.saturationAmount, 0.1);
  assert.equal(out.postDecode?.hpfEnabled, false);
  assert.equal(out.postDecode?.lpfEnabled, false);
  assert.equal(out.postDecode?.dmrCharacter, undefined);
});

test("derivePostDecodeBlock: dmrCharacter=50 overrides HPF/LPF/saturation/presence with mid preset", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "polyphase",
      hpfEnabled: false, // should be force-overridden
      saturationAmount: 0,
      dmrCharacter: 50,
    },
  });
  const pd = out.postDecode!;
  assert.equal(pd.dmrCharacter, 50);
  // 250 + 200 * 0.5 = 350 Hz
  assert.equal(pd.hpfEnabled, true);
  assert.equal(pd.hpfHz, 350);
  // 4000 - 1300 * 0.5 = 3350 Hz
  assert.equal(pd.lpfEnabled, true);
  assert.equal(pd.lpfHz, 3350);
  // 0.5 * 0.5 = 0.25
  assert.equal(pd.saturationAmount, 0.25);
  // 6 dB * 0.5 = 3 dB
  assert.equal(pd.presenceEnabled, true);
  assert.equal(pd.presenceHz, 2200);
  assert.equal(pd.presenceDb, 3.0);
});

test("derivePostDecodeBlock: dmrCharacter=100 maxes out the radio aesthetic", () => {
  const out = shapeFromConfig({
    postDecode: { upsampleMode: "polyphase", dmrCharacter: 100 },
  });
  const pd = out.postDecode!;
  assert.equal(pd.hpfHz, 450);
  assert.equal(pd.lpfHz, 2700);
  assert.equal(pd.saturationAmount, 0.5);
  assert.equal(pd.presenceDb, 6.0);
});

test("derivePostDecodeBlock: non-numeric dmrCharacter falls back to 0 (untouched)", () => {
  for (const bad of ["loud", null, NaN, Infinity, undefined]) {
    const out = shapeFromConfig({
      postDecode: {
        upsampleMode: "polyphase",
        hpfEnabled: false,
        dmrCharacter: bad,
      },
    });
    // dmrCharacter coerced to 0 → admin's HPF=false stays.
    assert.equal(out.postDecode?.hpfEnabled, false, `bad=${String(bad)}`);
    assert.equal(out.postDecode?.dmrCharacter, undefined, `bad=${String(bad)}`);
  }
});

test("derivePostDecodeBlock: numeric dmrCharacter outside 0..100 clamps into range", () => {
  // An admin pushing 200 (e.g. via API or a buggy slider step) should land
  // on the heavy end of the dial rather than being silently rejected; -50
  // clamps to 0 (chain off).
  const high = shapeFromConfig({
    postDecode: { upsampleMode: "polyphase", dmrCharacter: 200 },
  });
  assert.equal(high.postDecode?.dmrCharacter, 100);
  assert.equal(high.postDecode?.lpfHz, 2700);

  const negative = shapeFromConfig({
    postDecode: {
      upsampleMode: "polyphase",
      hpfEnabled: false,
      dmrCharacter: -50,
    },
  });
  assert.equal(negative.postDecode?.dmrCharacter, undefined);
  assert.equal(negative.postDecode?.hpfEnabled, false);
});

test("derivePostDecodeBlock: dmrCharacter=1 enables the chain even with duplicate upsample (no longer no-op)", () => {
  // Without dmrCharacter, this config would short-circuit to postDecode=null
  // (the no-shaping fast path). With the dial engaged at all, the chain
  // engages so the radio character is audible.
  const out = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", dmrCharacter: 1 },
  });
  assert.notEqual(out.postDecode, null);
  assert.equal(out.postDecode?.hpfEnabled, true);
});

// --- Radio Voice Character: wideband / compressor / roger beep / squelch tail

test("derivePostDecodeBlock: wideband:true ALONE stays a no-op (postDecode=null)", () => {
  // wideband only unlocks the Opus post-decode entry point — it shapes
  // nothing on its own. With no other shaping it MUST still collapse to null
  // so default-off behaviour is byte-identical to today.
  const out = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true },
  });
  assert.equal(out.postDecode, null);
});

test("derivePostDecodeBlock: wideband rides along when some other stage is enabled", () => {
  // Once any real shaping is on, the block is emitted and wideband passes
  // through verbatim so the client can route Opus through the chain.
  const out = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true, hpfEnabled: true, hpfHz: 200 },
  });
  assert.notEqual(out.postDecode, null);
  assert.equal(out.postDecode?.wideband, true);
  assert.equal(out.postDecode?.hpfEnabled, true);
});

test("derivePostDecodeBlock: compressorEnabled flips the block non-null and passes fields verbatim", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "duplicate",
      compressorEnabled: true,
      compressorThresholdDb: -18,
      compressorRatio: 4,
      compressorAttackMs: 8,
      compressorReleaseMs: 120,
      compressorMakeupDb: 3,
    },
  });
  assert.notEqual(out.postDecode, null);
  const pd = out.postDecode!;
  assert.equal(pd.compressorEnabled, true);
  assert.equal(pd.compressorThresholdDb, -18);
  assert.equal(pd.compressorRatio, 4);
  assert.equal(pd.compressorAttackMs, 8);
  assert.equal(pd.compressorReleaseMs, 120);
  assert.equal(pd.compressorMakeupDb, 3);
});

test("derivePostDecodeBlock: compressor fields are clamped only when the compressor is enabled", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "duplicate",
      compressorEnabled: true,
      compressorRatio: 99, // > 20 -> 20
      compressorAttackMs: -5, // < 1 -> 1
      compressorReleaseMs: 99999, // > 2000 -> 2000
      compressorThresholdDb: 5, // > 0 -> 0
      compressorMakeupDb: 99, // > 24 -> 24
    },
  });
  const pd = out.postDecode!;
  assert.equal(pd.compressorRatio, 20);
  assert.equal(pd.compressorAttackMs, 1);
  assert.equal(pd.compressorReleaseMs, 2000);
  assert.equal(pd.compressorThresholdDb, 0);
  assert.equal(pd.compressorMakeupDb, 24);
});

test("derivePostDecodeBlock: compressor fields are left untouched (and the block stays null) when the compressor is disabled", () => {
  // A stray out-of-range field with the feature off must NOT clamp (the field
  // is simply not in effect) AND must not, by itself, defeat the no-op
  // short-circuit — only the enable flags do that.
  const out = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", compressorRatio: 99 },
  });
  assert.equal(out.postDecode, null);
});

test("derivePostDecodeBlock: rogerBeepEnabled flips the block non-null, clamps hz/ms", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "duplicate",
      rogerBeepEnabled: true,
      rogerBeepHz: 99, // < 300 -> 300
      rogerBeepMs: 9999, // > 500 -> 500
    },
  });
  assert.notEqual(out.postDecode, null);
  const pd = out.postDecode!;
  assert.equal(pd.rogerBeepEnabled, true);
  assert.equal(pd.rogerBeepHz, 300);
  assert.equal(pd.rogerBeepMs, 500);
});

test("derivePostDecodeBlock: squelchTailEnabled flips the block non-null, clamps ms/level", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "duplicate",
      squelchTailEnabled: true,
      squelchTailMs: 5, // < 20 -> 20
      squelchTailLevel: 2, // > 0.5 -> 0.5
    },
  });
  assert.notEqual(out.postDecode, null);
  const pd = out.postDecode!;
  assert.equal(pd.squelchTailEnabled, true);
  assert.equal(pd.squelchTailMs, 20);
  assert.equal(pd.squelchTailLevel, 0.5);
});

test("derivePostDecodeBlock: roger/squelch numeric fields pass through verbatim when in range", () => {
  const out = shapeFromConfig({
    postDecode: {
      upsampleMode: "duplicate",
      rogerBeepEnabled: true,
      rogerBeepHz: 1500,
      rogerBeepMs: 150,
      squelchTailEnabled: true,
      squelchTailMs: 110,
      squelchTailLevel: 0.08,
    },
  });
  const pd = out.postDecode!;
  assert.equal(pd.rogerBeepHz, 1500);
  assert.equal(pd.rogerBeepMs, 150);
  assert.equal(pd.squelchTailMs, 110);
  assert.equal(pd.squelchTailLevel, 0.08);
});

test("derivePostDecodeBlock: applyWidebandCharacter anchors at 0 / 50 / 100", () => {
  // 0 -> dial off, gentle Opus-clarity anchors don't apply (and wideband alone
  // is a no-op).
  const off = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true, dmrCharacter: 0 },
  });
  assert.equal(off.postDecode, null);

  // 50 -> midpoints of the gentle wideband anchors.
  const mid = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true, dmrCharacter: 50 },
  });
  const m = mid.postDecode!;
  assert.equal(m.dmrCharacter, 50);
  assert.equal(m.hpfEnabled, true);
  assert.equal(m.hpfHz, 200); // 150 + 100*0.5
  assert.equal(m.lpfEnabled, true);
  assert.equal(m.lpfHz, 6000); // 7000 - 2000*0.5
  assert.equal(m.saturationAmount, 0.13); // round(0.25*0.5*100)/100 = 0.13
  assert.equal(m.presenceEnabled, true);
  assert.equal(m.presenceHz, 2600);
  assert.equal(m.presenceDb, 1.5); // 3*0.5
  assert.equal(m.presenceQ, 0.9);

  // 100 -> full gentle wideband anchors.
  const full = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true, dmrCharacter: 100 },
  });
  const f = full.postDecode!;
  assert.equal(f.hpfHz, 250);
  assert.equal(f.lpfHz, 5000);
  assert.equal(f.saturationAmount, 0.25);
  assert.equal(f.presenceHz, 2600);
  assert.equal(f.presenceDb, 3.0);
  assert.equal(f.presenceQ, 0.9);
});

test("derivePostDecodeBlock: wideband dial uses GENTLER anchors than the 8 kHz dmr dial", () => {
  // Same dial value, different path: wideband keeps more bandwidth (higher LPF,
  // lower HPF) and less saturation than the heavy DMR voicing.
  const wb = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", wideband: true, dmrCharacter: 100 },
  }).postDecode!;
  const dmr = shapeFromConfig({
    postDecode: { upsampleMode: "duplicate", dmrCharacter: 100 },
  }).postDecode!;
  assert.ok(wb.lpfHz! > dmr.lpfHz!, "wideband LPF should be higher (wider band)");
  assert.ok(wb.hpfHz! < dmr.hpfHz!, "wideband HPF should be lower (wider band)");
  assert.ok(wb.saturationAmount! < dmr.saturationAmount!, "wideband saturation should be gentler");
});

test("derivePostDecodeBlock: presenceQ is floored to 0.1 when the bell is enabled (parity with mobile max(0.1,Q))", () => {
  // The mobile chains build the peak biquad with max(0.1, presenceQ); the
  // web/lab chains used Q raw, so a hand-pushed Q < 0.1 diverged (and Q=0 went
  // NaN on web). Clamp once server-side so every platform sees the same value.
  const low = shapeFromConfig({
    postDecode: { presenceEnabled: true, presenceHz: 2200, presenceDb: 6, presenceQ: 0.05 },
  }).postDecode!;
  assert.equal(low.presenceQ, 0.1);

  const zero = shapeFromConfig({
    postDecode: { presenceEnabled: true, presenceHz: 2200, presenceDb: 6, presenceQ: 0 },
  }).postDecode!;
  assert.equal(zero.presenceQ, 0.1);

  // A normal Q passes through untouched (floor-only, no ceiling — matches mobile).
  const ok = shapeFromConfig({
    postDecode: { presenceEnabled: true, presenceHz: 2200, presenceDb: 6, presenceQ: 2 },
  }).postDecode!;
  assert.equal(ok.presenceQ, 2);
});
