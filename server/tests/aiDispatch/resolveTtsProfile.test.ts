/**
 * Regression tests for `resolveTtsProfile` in `server/src/aiDispatch/tts.ts`.
 *
 * `resolveTtsProfile` decides whether each AI-dispatch utterance is sent to
 * ElevenLabs via the FAST model (cheap, lower-quality) or the EXPRESSIVE
 * v3 model (richer, costs more credits per character). It is called for
 * every spoken line on every channel — a regression here is silently
 * expensive (always-expressive shipped) or silently low-quality
 * (always-fast shipped) for the entire fleet.
 *
 * The rules under test, taken from the function body:
 *
 *  1. Any kind of "important" speech (plate_readback / info_lookup /
 *     callout / emergency) is ALWAYS expressive — these are the lines the
 *     officer needs to hear correctly the first time, regardless of length.
 *  2. radio_ack is also expressive — short acknowledgements ("Copy 351,
 *     10-4") still go through the v3 path so they sound like the rest of
 *     the dispatcher.
 *  3. Otherwise (kind="auto" or unspecified):
 *       - Text longer than ELEVENLABS_FAST_MAX_CHARS (default 140) is
 *         expressive. Default-only override: env var.
 *       - Multi-sentence input (≥ 2 sentence terminators) longer than 80
 *         chars is expressive — the fast model fumbles prosody on these.
 *       - When ELEVENLABS_FAST_MODEL_ID is explicitly set to a "flash"
 *         model, short single-sentence text routes fast.
 *       - All other cases default to expressive (legacy v3 fallback).
 *
 * Each test isolates the env vars it touches and restores them after.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveTtsProfile } from "../../src/aiDispatch/tts.js";

/**
 * Snapshot+restore the two env vars the function reads. Each test sets
 * exactly the override it needs and clears it on the way out so subsequent
 * tests don't see leftover state.
 */
function withEnv(
  overrides: { ELEVENLABS_FAST_MAX_CHARS?: string; ELEVENLABS_FAST_MODEL_ID?: string },
  body: () => void,
): void {
  const prev = {
    ELEVENLABS_FAST_MAX_CHARS: process.env.ELEVENLABS_FAST_MAX_CHARS,
    ELEVENLABS_FAST_MODEL_ID: process.env.ELEVENLABS_FAST_MODEL_ID,
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    body();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

test("resolveTtsProfile: plate_readback is always expressive", () => {
  // Plate read-backs need the v3 voice so officers hear letters/numbers
  // distinctly. A regression that cheap-routed these would silently
  // degrade a primary safety signal.
  assert.equal(resolveTtsProfile("ABC123", "plate_readback"), "expressive");
  assert.equal(resolveTtsProfile("", "plate_readback"), "expressive");
  assert.equal(resolveTtsProfile("a".repeat(2000), "plate_readback"), "expressive");
});

test("resolveTtsProfile: info_lookup / callout / emergency stay expressive regardless of length", () => {
  for (const kind of ["info_lookup", "callout", "emergency"] as const) {
    assert.equal(resolveTtsProfile("short", kind), "expressive");
    assert.equal(resolveTtsProfile("a".repeat(2000), kind), "expressive");
  }
});

test("resolveTtsProfile: radio_ack is expressive (short acks still use v3 voice)", () => {
  // The fleet's "Copy 351, 10-4" acks are precached for the v3 voice;
  // routing them to fast would defeat the precache and pay double.
  assert.equal(resolveTtsProfile("Copy 351, 10-4", "radio_ack"), "expressive");
  assert.equal(resolveTtsProfile("Standby.", "radio_ack"), "expressive");
});

test("resolveTtsProfile: kind=auto with text past the FAST_MAX_CHARS cap is expressive", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    // 141 chars > default cap of 140
    const longLine = "a".repeat(141);
    assert.equal(resolveTtsProfile(longLine), "expressive");
    assert.equal(resolveTtsProfile(longLine, "auto"), "expressive");
  });
});

test("resolveTtsProfile: ELEVENLABS_FAST_MAX_CHARS env override is honoured", () => {
  withEnv(
    { ELEVENLABS_FAST_MAX_CHARS: "20", ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" },
    () => {
      // 21 chars > 20 cap
      const longLine = "a".repeat(21);
      assert.equal(resolveTtsProfile(longLine), "expressive");
      assert.equal(resolveTtsProfile("a".repeat(20)), "fast");
    },
  );
});

test("resolveTtsProfile: invalid FAST_MAX_CHARS env falls back to the 140 default", () => {
  // Operators sometimes set "0", "auto", or paste garbage; make sure that
  // doesn't accidentally route 5-char lines to expressive (or worse, NaN
  // through the comparison and silently take the false branch).
  for (const bad of ["0", "-50", "abc", ""]) {
    withEnv(
      { ELEVENLABS_FAST_MAX_CHARS: bad, ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" },
      () => {
        // 50 chars < 140 default: should land in fast path with flash set
        assert.equal(
          resolveTtsProfile("a".repeat(50)),
          "fast",
          `bad=${JSON.stringify(bad)} should fall back to default 140 cap`,
        );
        // 200 chars > 140 default: still expressive
        assert.equal(resolveTtsProfile("a".repeat(200)), "expressive");
      },
    );
  }
});

test("resolveTtsProfile: multi-sentence text past 80 chars is expressive even under cap", () => {
  // Two sentence terminators + > 80 chars triggers the expressive path
  // regardless of whether we're under FAST_MAX_CHARS — fast model's
  // prosody on short paragraphs is poor.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    const twoSentences = "This is the first sentence with extra padding. This is the second sentence that closes it.";
    assert.ok(twoSentences.length > 80, `expected > 80, got ${twoSentences.length}`);
    assert.equal(resolveTtsProfile(twoSentences), "expressive");
  });
});

test("resolveTtsProfile: multi-sentence text under 80 chars routes fast (boundary holds)", () => {
  // Two sentences but <= 80 chars: fast path with flash override.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    // 4 sentences, well under 80 chars
    const tiny = "Yes. No. Maybe. Stop.";
    assert.ok(tiny.length <= 80);
    assert.equal(resolveTtsProfile(tiny), "fast");
  });
});

test("resolveTtsProfile: single sentence under cap routes fast when flash model is configured", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy 351."), "fast");
    assert.equal(resolveTtsProfile("Standby."), "fast");
  });
});

test("resolveTtsProfile: without a flash model in env, short text still defaults to expressive", () => {
  // The default-on-expressive fallback protects the fleet from a
  // mis-precache configuration: if no fast model is wired up, every line
  // goes through v3 (slower but correct).
  withEnv({ ELEVENLABS_FAST_MODEL_ID: undefined }, () => {
    assert.equal(resolveTtsProfile("Copy 351."), "expressive");
  });
});

test("resolveTtsProfile: a non-flash FAST_MODEL_ID does NOT route fast", () => {
  // The function explicitly checks for "flash" in the model id — any
  // other override (e.g. an experimental turbo or v3 set as 'fast') still
  // falls through to expressive so we never use the wrong voice settings.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_turbo_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy 351."), "expressive");
  });
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_v3" }, () => {
    assert.equal(resolveTtsProfile("Copy 351."), "expressive");
  });
});

test("resolveTtsProfile: text with leading/trailing whitespace is trimmed before length check", () => {
  withEnv(
    { ELEVENLABS_FAST_MAX_CHARS: "10", ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" },
    () => {
      // 6 visible chars after trim; whitespace padding shouldn't push it
      // over the 10-char cap.
      assert.equal(resolveTtsProfile("        Copy.        "), "fast");
    },
  );
});

test("resolveTtsProfile: '?' and '!' count as sentence terminators for the multi-sentence rule", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    // 2 terminators + > 80 chars → expressive (regression guard: the
    // rule must catch '?' and '!', not just '.').
    const padded =
      "Officer are you available to take this call right now? Please stand by, copy that one!";
    assert.ok(padded.length > 80, `expected > 80, got ${padded.length}`);
    assert.equal(resolveTtsProfile(padded), "expressive");
  });
});
