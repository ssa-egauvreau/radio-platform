/**
 * Regression tests for `resolveTtsProfile` in `server/src/aiDispatch/tts.ts`.
 *
 * Why this matters
 * ----------------
 * `resolveTtsProfile` picks the ElevenLabs model used to synthesize every
 * AI-dispatcher reply on the radio:
 *
 *   - "fast"       → opts into a low-latency Flash/Turbo model (~250-400 ms
 *                    quicker, but quality+prosody noticeably worse on
 *                    longer or emotive lines).
 *   - "expressive" → uses the v3/Turbo expressive voice (the default —
 *                    matches the fleet's preferred dispatcher voice).
 *
 * Two kinds of regression here are silent and only show up at the radio:
 *
 *   1. Quality regression — a refactor that started returning "fast" for
 *     `plate_readback` / `info_lookup` / `emergency` / `callout` /
 *     `radio_ack` would push every safety-critical readback through the
 *     Flash model, producing the lower-quality voice on the exact lines
 *     where intelligibility matters most (felony stops, 10-33 callouts,
 *     wants/warrants info, etc.).
 *
 *   2. Cost / latency regression — a refactor that started returning
 *     "expressive" universally even when the operator has explicitly
 *     opted into Flash via `ELEVENLABS_FAST_MODEL_ID=…flash…` would
 *     defeat the latency optimisation those operators paid for.
 *
 * The function also branches on text length (`fastMaxChars`, default 140)
 * and on sentence count — these are heuristics the production code uses
 * to keep multi-sentence dispatcher replies on the expressive model even
 * if they happen to fit under the character limit. Pin them so a tweak
 * to one doesn't accidentally invert the other.
 *
 * Mutating `process.env` is OK here because the helpers `fastModelId` /
 * `expressiveModelId` / `fastMaxChars` read env per call rather than
 * caching at import time (verified by reading the source). Each test
 * cleans up its own env keys in a `try/finally` so neighbour tests stay
 * deterministic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveTtsProfile } from "../../src/aiDispatch/tts.js";

function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(saved)) {
      const original = saved[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

// ===== safety-critical speech kinds always go expressive =================

test("resolveTtsProfile: plate_readback always uses expressive (felony-stop intelligibility)", () => {
  // A misclassified plate readback going through Flash would degrade the
  // exact moment a dispatcher needs every character clearly enunciated.
  // Hold this contract independent of env or text length.
  for (const text of ["Adam", "352, your plate of ABC123 comes back to a 2019 Honda Civic."]) {
    withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "9999" }, () => {
      assert.equal(resolveTtsProfile(text, "plate_readback"), "expressive");
    });
  }
});

test("resolveTtsProfile: info_lookup always uses expressive", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "9999" }, () => {
    assert.equal(resolveTtsProfile("Adam", "info_lookup"), "expressive");
  });
});

test("resolveTtsProfile: callout always uses expressive (matters for 10-33 callouts)", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "9999" }, () => {
    assert.equal(resolveTtsProfile("Adam", "callout"), "expressive");
  });
});

test("resolveTtsProfile: emergency always uses expressive", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "9999" }, () => {
    assert.equal(resolveTtsProfile("Adam", "emergency"), "expressive");
  });
});

test("resolveTtsProfile: radio_ack always uses expressive (short ack quality matters too)", () => {
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "9999" }, () => {
    assert.equal(resolveTtsProfile("352, copy.", "radio_ack"), "expressive");
  });
});

// ===== auto / unspecified kind: env-driven Flash opt-in ================

test("resolveTtsProfile: defaults to expressive when no Flash model is configured", () => {
  // Default deployment ships without ELEVENLABS_FAST_MODEL_ID. Short auto
  // text must stay on the expressive model — the Flash opt-in is the
  // only way to get the "fast" profile, by design.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: undefined }, () => {
    assert.equal(resolveTtsProfile("Affirm 352.", "auto"), "expressive");
    assert.equal(resolveTtsProfile("Affirm 352."), "expressive");
  });
});

test("resolveTtsProfile: short auto text + Flash model env returns fast", () => {
  // The operator-facing latency optimisation: set a *flash* model id to
  // route short acks through the lower-latency path.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy 352.", "auto"), "fast");
  });
});

test("resolveTtsProfile: Flash opt-in is keyed on the substring 'flash', not just any value", () => {
  // A non-Flash model name in the FAST slot must NOT trigger the fast
  // path — only models whose id literally contains "flash" qualify. A
  // regression that treated "any value" as Flash would push every
  // auto-kind reply through whatever happened to be configured.
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_turbo_v2_5" }, () => {
    assert.equal(resolveTtsProfile("Copy 352.", "auto"), "expressive");
  });
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_v3" }, () => {
    assert.equal(resolveTtsProfile("Copy 352.", "auto"), "expressive");
  });
});

// ===== length-based downgrade to expressive =============================

test("resolveTtsProfile: text exceeding fastMaxChars (default 140) returns expressive even with Flash set", () => {
  // The Flash model gets noticeably worse on long lines, so the function
  // intentionally bypasses Flash once the prepared text crosses the
  // length threshold. Default is 140 chars.
  const long = "A".repeat(141);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: undefined }, () => {
    assert.equal(resolveTtsProfile(long, "auto"), "expressive");
  });
});

test("resolveTtsProfile: fastMaxChars env override controls the length threshold", () => {
  // Raise the threshold past the input length → the same text now stays
  // on Flash. This is the operator-visible knob for trading off quality
  // vs latency on longer auto replies.
  const text = "A".repeat(160);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "200" }, () => {
    assert.equal(resolveTtsProfile(text, "auto"), "fast");
  });
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: "150" }, () => {
    assert.equal(resolveTtsProfile(text, "auto"), "expressive");
  });
});

test("resolveTtsProfile: invalid / non-positive fastMaxChars falls back to the documented 140", () => {
  // Bad env input must not break the heuristic — the function uses 140 as
  // its documented default. A regression that treated "0" or "abc" as the
  // threshold would push everything to expressive even with Flash on.
  for (const bad of ["abc", "0", "-1", "", "1.7976931348623157e+999"]) {
    const text = "A".repeat(120); // <140, would qualify for fast under default
    withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5", ELEVENLABS_FAST_MAX_CHARS: bad }, () => {
      assert.equal(
        resolveTtsProfile(text, "auto"),
        "fast",
        `bad fastMaxChars=${JSON.stringify(bad)} must fall back to default 140`,
      );
    });
  }
});

test("resolveTtsProfile: multi-sentence auto reply (>=2 sentences, >80 chars) returns expressive", () => {
  // Heuristic: even when the text length fits under fastMaxChars, a reply
  // with two or more sentence-terminating punctuation marks AND >80 chars
  // is treated as expressive — the Flash voice's prosody on a two-sentence
  // hand-off ("Copy 352. Stand by.") is noticeably flatter than the
  // expressive voice and reads as robotic on the radio.
  const text = "Affirm 352, copy your traffic. Suspect last seen heading northbound on State Road 60.";
  assert.ok(text.length > 80 && text.length < 140);
  assert.ok((text.match(/[.?!]/g) ?? []).length >= 2);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(text, "auto"), "expressive");
  });
});

test("resolveTtsProfile: short multi-sentence text (>=2 sentences, ≤80 chars) still uses fast", () => {
  // The 80-char floor on the sentence-count heuristic matters: a curt
  // two-sentence ack ("Copy 352. Stand by.") below the floor must NOT be
  // pushed to expressive when the operator wanted Flash. Pin the corner
  // so a tweak to one condition doesn't accidentally invert the other.
  const text = "Copy 352. Stand by.";
  assert.ok(text.length <= 80);
  assert.equal((text.match(/[.?!]/g) ?? []).length, 2);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(text, "auto"), "fast");
  });
});

test("resolveTtsProfile: counts only true sentence-terminating punctuation (. ? !) for the heuristic", () => {
  // A comma- or ellipsis-heavy single sentence over 80 chars must NOT be
  // misclassified as multi-sentence and pushed to expressive — only
  // [.?!] counts.
  const oneLongSentence =
    "Suspect last seen heading northbound on State Road 60 in a white Ford pickup, partial plate Adam Boy Charlie";
  assert.ok(oneLongSentence.length > 80 && oneLongSentence.length <= 140);
  assert.equal((oneLongSentence.match(/[.?!]/g) ?? []).length, 0);
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(oneLongSentence, "auto"), "fast");
  });
});

test("resolveTtsProfile: trims leading/trailing whitespace before measuring length", () => {
  // The trim happens before the >fastMaxChars check; a heavily-padded short
  // string would otherwise be misclassified as long. Build a payload whose
  // raw length is clearly over the 140-char threshold but whose trimmed
  // content fits underneath it.
  const padding = " ".repeat(60);
  const body = "A".repeat(120); // ≤140 after trim, would qualify for fast
  const padded = `${padding}${body}${padding}`;
  assert.ok(padded.length > 140, `expected padded length >140, got ${padded.length}`);
  assert.ok(
    padded.trim().length <= 140,
    `expected trimmed length ≤140, got ${padded.trim().length}`,
  );
  withEnv({ ELEVENLABS_FAST_MODEL_ID: "eleven_flash_v2_5" }, () => {
    assert.equal(resolveTtsProfile(padded, "auto"), "fast");
  });
});
