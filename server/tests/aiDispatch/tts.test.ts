/**
 * Tests for `server/src/aiDispatch/tts.ts` — specifically `resolveTtsProfile`,
 * the pure helper that picks fast vs expressive ElevenLabs model selection
 * for the AI dispatcher.
 *
 * This decision drives both cost and latency on every single AI-dispatcher
 * utterance:
 *
 *   - `expressive` (v3) costs more and is slower, but is required for plate
 *     readbacks, info-lookup answers, callouts, and emergency tones — the
 *     long, multi-sentence lines where Flash sounds robotic and where
 *     dispatchers need to actually hear the content.
 *
 *   - `fast` (Flash) is only safe for short, single-line acks ("Copy 040,
 *     10-8.") AND only when the operator has explicitly opted into a Flash
 *     model via `ELEVENLABS_FAST_MODEL_ID=eleven_flash_*`. Without that
 *     opt-in, the resolver MUST stay on expressive — otherwise we'd be
 *     silently downgrading every short ack to v2.5 turbo, which sounds
 *     noticeably different from the rest of the dispatcher.
 *
 * Regressions caught here:
 *
 *   - A regression that drops the "kind ∈ {plate_readback, info_lookup,
 *     callout, emergency}" gate would send long plate readbacks and 911
 *     callouts through Flash — wrong voice, occasionally garbled numbers.
 *
 *   - A regression that drops the "radio_ack ⇒ expressive" rule would
 *     silently downgrade the AI's hot-path 10-codes to Flash, even though
 *     the precache pre-renders these on the expressive profile (cache
 *     misses for every "Copy 151").
 *
 *   - A regression that flips the default branch from `expressive` to
 *     `fast` would silently shift the entire fleet to the cheaper model
 *     even on agencies that never set ELEVENLABS_FAST_MODEL_ID.
 *
 *   - A regression that ignores ELEVENLABS_FAST_MAX_CHARS would either
 *     send too much content to Flash (clipped / robotic) or keep
 *     everything on expressive even when an operator deliberately raised
 *     the threshold to bias toward cost savings.
 *
 *   - A regression that swaps the "sentences >= 2 AND length > 80" gate
 *     for an OR would force most one-sentence short acks to expressive,
 *     defeating the point of the cost-saving Flash path entirely.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveTtsProfile, type TtsSpeechKind } from "../../src/aiDispatch/tts.js";

// Helpers --------------------------------------------------------------

/**
 * `resolveTtsProfile` reads `process.env` at CALL time (not import time), so
 * we save/restore around each test instead of mutating global state.
 */
function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  const keys = Object.keys(overrides);
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    const v = overrides[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev[k];
      }
    }
  }
}

// --- "force expressive" speech kinds ----------------------------------

test("resolveTtsProfile: plate_readback / info_lookup / callout / emergency always pick expressive", () => {
  // Short, single-line text — would otherwise be eligible for Flash. The
  // speech-kind gate must dominate so plate readbacks etc. never get
  // downgraded.
  const kinds: TtsSpeechKind[] = ["plate_readback", "info_lookup", "callout", "emergency"];
  for (const kind of kinds) {
    withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
      assert.equal(resolveTtsProfile("Copy.", kind), "expressive", `kind=${kind}`);
    });
  }
});

test("resolveTtsProfile: radio_ack pins expressive even on short text (matches precache profile)", () => {
  // The TTS precache renders radio acks on the expressive profile. If
  // `radio_ack` ever resolved to `fast`, every "Copy 040" would miss the
  // precache because the model_id between writer and reader would no
  // longer match, and we'd re-bill ElevenLabs for thousands of phrases.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy 040, 10-8.", "radio_ack"), "expressive");
  });
});

// --- length-based gating ---------------------------------------------

test("resolveTtsProfile: text longer than ELEVENLABS_FAST_MAX_CHARS picks expressive", () => {
  withEnv(
    { ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: undefined },
    () => {
      // Default ceiling is 140 chars. 145 chars (single sentence) → expressive.
      const text = "a".repeat(145);
      assert.equal(resolveTtsProfile(text, "auto"), "expressive");
    },
  );
});

test("resolveTtsProfile: text trims whitespace before length check (leading/trailing don't bias)", () => {
  // Body inside is 100 chars; trailing whitespace would push the raw
  // string past 140 but `prepared = text.trim()` brings it back. Stays
  // eligible for Flash when a flash model is configured.
  const body = "a".repeat(100);
  const padded = `   ${body}` + " ".repeat(60);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(padded, "auto"), "fast");
  });
});

test("resolveTtsProfile: ELEVENLABS_FAST_MAX_CHARS override is honored", () => {
  withEnv(
    { ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "30" },
    () => {
      // 25 chars → still under the override → fast.
      assert.equal(resolveTtsProfile("a".repeat(25), "auto"), "fast");
      // 35 chars → over the override → expressive.
      assert.equal(resolveTtsProfile("a".repeat(35), "auto"), "expressive");
    },
  );
});

test("resolveTtsProfile: ELEVENLABS_FAST_MAX_CHARS=0 or negative falls back to default 140", () => {
  // Non-finite or <= 0 should NOT lower the ceiling to 0 (which would push
  // every utterance to expressive and silently disable the Flash path).
  withEnv(
    { ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "0" },
    () => {
      assert.equal(resolveTtsProfile("Copy.", "auto"), "fast", "0 ⇒ default ceiling, short text stays fast");
    },
  );
  withEnv(
    { ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "-5" },
    () => {
      assert.equal(resolveTtsProfile("Copy.", "auto"), "fast", "-5 ⇒ default ceiling, short text stays fast");
    },
  );
  withEnv(
    { ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "not-a-number" },
    () => {
      assert.equal(
        resolveTtsProfile("Copy.", "auto"),
        "fast",
        "non-numeric ⇒ default ceiling, short text stays fast",
      );
    },
  );
});

// --- multi-sentence escape hatch -------------------------------------

test("resolveTtsProfile: short text with 2+ sentences AND >80 chars escapes to expressive", () => {
  // Both halves of the conjunction must hold. Two sentences but under 80
  // chars stays on fast; one sentence over 80 chars stays on fast; only
  // 2+ sentences AND >80 chars goes expressive.
  const twoSentLong =
    "Subject is a male wearing a red jacket. He is walking eastbound on Main Street now.";
  // Sanity-check the fixture so a typo doesn't silently shorten it under the
  // 80-char gate and let the test pass for the wrong reason.
  assert.ok(twoSentLong.length > 80, `fixture must be >80 chars (got ${twoSentLong.length})`);
  assert.equal(twoSentLong.match(/[.?!]/g)?.length ?? 0, 2);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(twoSentLong, "auto"), "expressive");
  });
});

test("resolveTtsProfile: 2+ sentences but under 80 chars stays on fast (length leg of the gate)", () => {
  // Don't let "Copy 040. 10-8." (two sentences but tiny) accidentally
  // upgrade to expressive — that would defeat the cost-saving path on
  // multi-sentence acks.
  const twoSentShort = "Copy 040. 10-8.";
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(twoSentShort, "auto"), "fast");
  });
});

test("resolveTtsProfile: 1-sentence text over 80 chars but under 140 stays on fast (sentence leg of the gate)", () => {
  // 90 chars, single sentence → still on the fast path because the
  // sentence-count gate requires >=2.
  const oneSentLong = "a".repeat(90);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(oneSentLong, "auto"), "fast");
  });
});

test("resolveTtsProfile: question marks and exclamation points count as sentence terminators", () => {
  // The regex is `/[.?!]/g`. A line like "Repeat? Where? Over." would
  // count as 3 sentences. Lock in that ? and ! match — a regression that
  // narrowed the regex to "." only would keep talkative questions on the
  // fast path with the wrong voice.
  const questionsLong = "Repeat the location? What was the unit? Confirm callsign please okay.";
  // 69 chars, 3 sentences → NOT yet over 80 → stays fast. Pad to >80:
  const padded = questionsLong + " " + "x".repeat(80 - questionsLong.length + 5);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(padded, "auto"), "expressive");
  });
});

// --- default branch ---------------------------------------------------

test("resolveTtsProfile: default-everything (no flash model) always picks expressive", () => {
  // Without an explicit Flash model in env, the resolver MUST keep every
  // utterance on expressive. A regression to "default = fast" would
  // silently downgrade the whole fleet to v2.5 turbo and ship a different
  // voice on every short ack across all operators that haven't opted in.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: undefined }, () => {
    assert.equal(resolveTtsProfile("Copy.", "auto"), "expressive");
    assert.equal(resolveTtsProfile("Copy 040, 10-8.", "auto"), "expressive");
  });
});

test("resolveTtsProfile: blank/whitespace ELEVENLABS_FAST_MODEL_ID is treated as unset (stays expressive)", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "   " }, () => {
    // Trimmed → empty → treated as not opted in → expressive default.
    assert.equal(resolveTtsProfile("Copy.", "auto"), "expressive");
  });
});

test("resolveTtsProfile: ELEVENLABS_FAST_MODEL_ID without 'flash' substring stays expressive", () => {
  // Only models whose id contains 'flash' qualify the resolver to pick
  // 'fast'. A custom model id like 'eleven_turbo_v2_5' must not silently
  // re-enable the fast path.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_turbo_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy.", "auto"), "expressive");
  });
});

test("resolveTtsProfile: 'flash' substring match is case-sensitive (matches source contract)", () => {
  // `flashModel.includes("flash")` is case-sensitive. Document this — a
  // regression that called toLowerCase() first would silently broaden the
  // gate.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "Eleven_FLASH_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy.", "auto"), "expressive");
  });
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy.", "auto"), "fast");
  });
});

test("resolveTtsProfile: explicit 'auto' kind is the default and behaves identically to no kind arg", () => {
  // The function signature defaults kind to 'auto'. Lock that in — a
  // regression that changed the default to 'radio_ack' would force every
  // unspecified-kind call onto expressive even when an operator's Flash
  // path was correctly configured.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy."), resolveTtsProfile("Copy.", "auto"));
    assert.equal(resolveTtsProfile("Copy."), "fast");
  });
});
