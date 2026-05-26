/**
 * Regression tests for `resolveTtsProfile` in `server/src/aiDispatch/tts.ts`.
 *
 * The TTS profile chooser decides which ElevenLabs model (fast vs
 * expressive) renders a given dispatcher reply. This is where AI
 * dispatch latency and bill meet:
 *
 *   - `expressive` (Eleven v3) produces the higher-quality, slightly
 *     warmer voice but is slower per character and ~5x the cost of fast
 *     models on the same text. Long callouts and emergency speech use
 *     it to keep the on-air tone calm and intelligible.
 *
 *   - `fast` (Eleven Turbo / Flash) is the cheap, low-latency path for
 *     the shortest "Copy", "10-4", "Standby" acks. Routing one of those
 *     onto expressive is wasted budget; routing a 200-char callout onto
 *     fast can clip or rush the audio.
 *
 * The function is the single point where this routing lives, so a one-
 * line regression here changes the cost / latency / on-air tone profile
 * of every AI dispatcher reply in the fleet — and there is no other
 * automated check on the routing today.
 *
 * Tests pin the documented rules:
 *
 *   1. Speech kinds tied to high-stakes voice (plate_readback,
 *      info_lookup, callout, emergency, radio_ack) ALWAYS return
 *      expressive, regardless of text length — these are the rules the
 *      hand-coded dispatch pipeline relies on for tone consistency.
 *   2. `auto` short text routes to expressive by default (because the
 *      Flash escape hatch is opt-in via env). Tests therefore lock the
 *      Flash override off so the default behavior is the one assert.
 *   3. `auto` long text (> 140 chars, the documented `DEFAULT_FAST_MAX_CHARS`)
 *      routes to expressive regardless of speech kind.
 *   4. `auto` text with 2+ terminal punctuation AND > 80 chars routes to
 *      expressive — multi-sentence callouts read better on the
 *      expressive model even if they're under the length threshold.
 *   5. `auto` short text WITH a flash override env set routes to fast —
 *      the only path that can demote a reply onto the cheap model today.
 *
 * The function reads `process.env.ELEVENLABS_FAST_MAX_CHARS` and
 * `process.env.ELEVENLABS_FAST_MODEL_ID` on every call (no caching).
 * Each test snapshots+restores the relevant env keys so they don't leak
 * into sibling tests in the same `node:test` worker.
 */

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { resolveTtsProfile, type TtsSpeechKind } from "../../../src/aiDispatch/tts.js";

const ENV_KEYS = [
  "ELEVENLABS_FAST_MODEL_ID",
  "ELEVENLABS_FAST_MAX_CHARS",
  "ELEVENLABS_LONG_MODEL_ID",
  "ELEVENLABS_MODEL_ID",
  "ELEVENLABS_FAST_STABILITY",
  "ELEVENLABS_STABILITY",
];

/** Snapshot every env key the module reads and restore them on teardown. */
function withCleanEnv(t: TestContext): void {
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  t.after(() => {
    for (const key of ENV_KEYS) {
      const val = original[key];
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });
}

test("speech kinds tied to on-air voice always pick expressive", (t: TestContext) => {
  // No matter how short the text is, the dispatcher's plate readbacks,
  // info-lookup answers, callouts, and emergency speech must use the
  // expressive model — the tone consistency for these is non-negotiable.
  withCleanEnv(t);
  // Even with the Flash override set (which is the *only* path that
  // can normally demote to fast), these kinds still pin expressive.
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";

  const text = "Copy"; // 4 chars — well under any threshold
  const kinds: TtsSpeechKind[] = [
    "plate_readback",
    "info_lookup",
    "callout",
    "emergency",
    "radio_ack",
  ];
  for (const kind of kinds) {
    assert.equal(
      resolveTtsProfile(text, kind),
      "expressive",
      `kind=${kind} must always return expressive`,
    );
  }
});

test("auto: short text returns expressive by default (no Flash override)", (t: TestContext) => {
  // The default is expressive — fast is opt-in via env. A regression
  // that flipped the default would silently push every short ack onto
  // the cheap model (saving cost, but breaking the documented tone).
  withCleanEnv(t);
  assert.equal(resolveTtsProfile("Copy", "auto"), "expressive");
  assert.equal(resolveTtsProfile("10-4", "auto"), "expressive");
  // Edge: empty string still returns expressive (no special-case branch).
  assert.equal(resolveTtsProfile("", "auto"), "expressive");
});

test("auto: short text WITH Flash override picks fast (the only path that demotes)", (t: TestContext) => {
  // This is the documented escape hatch: setting an env model id that
  // contains "flash" tells the resolver "the cheap model is configured,
  // it's safe to send short acks to it". The substring match is
  // intentional so any "eleven_flash_*" id flips the bit.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";
  assert.equal(resolveTtsProfile("Copy", "auto"), "fast");
  // A short text just under the length threshold also picks fast.
  const justUnder = "x".repeat(140);
  assert.equal(resolveTtsProfile(justUnder, "auto"), "fast");
});

test("auto: a non-flash Fast model id does NOT enable the fast path", (t: TestContext) => {
  // The check is `flashModel?.includes("flash")` — a fast model id that
  // doesn't mention "flash" must NOT demote (e.g. somebody setting
  // ELEVENLABS_FAST_MODEL_ID="eleven_turbo_v2_5" should still get
  // expressive on short text, because the resolver is conservative).
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_turbo_v2_5";
  assert.equal(resolveTtsProfile("Copy", "auto"), "expressive");
});

test("auto: text longer than DEFAULT_FAST_MAX_CHARS (140) forces expressive even with Flash override", (t: TestContext) => {
  // Length threshold beats Flash: a 141-char text routes to expressive
  // even when the override is on. Protects against trimming a long
  // callout onto the cheaper model.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";
  const justOver = "x".repeat(141);
  assert.equal(resolveTtsProfile(justOver, "auto"), "expressive");
});

test("auto: ELEVENLABS_FAST_MAX_CHARS overrides the length threshold", (t: TestContext) => {
  // The env override lets operators tune the routing. A regression
  // that ignored the env value would silently lock the threshold at
  // 140 chars even for an agency that explicitly opted into a tighter
  // (or looser) routing.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";
  process.env.ELEVENLABS_FAST_MAX_CHARS = "50";
  // 51 chars — over the new threshold, so expressive.
  assert.equal(resolveTtsProfile("x".repeat(51), "auto"), "expressive");
  // 50 chars — exactly at the threshold; the resolver uses `>` so this
  // still routes through the multi-sentence / fast checks (fast in this case).
  assert.equal(resolveTtsProfile("x".repeat(50), "auto"), "fast");
});

test("auto: invalid ELEVENLABS_FAST_MAX_CHARS falls back to the documented 140", (t: TestContext) => {
  // NaN / negative env values must not silently shrink the threshold
  // to 0 (which would route every single ack to expressive). The
  // resolver clamps invalid input back to the default.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";
  process.env.ELEVENLABS_FAST_MAX_CHARS = "not-a-number";
  // 140 chars — exactly the default threshold; resolver uses `>` so
  // this is still fast.
  assert.equal(resolveTtsProfile("x".repeat(140), "auto"), "fast");
  // 141 chars — over the default threshold, so expressive.
  assert.equal(resolveTtsProfile("x".repeat(141), "auto"), "expressive");

  // Same protection for negative numbers.
  process.env.ELEVENLABS_FAST_MAX_CHARS = "-10";
  assert.equal(resolveTtsProfile("x".repeat(140), "auto"), "fast");
});

test("auto: 2+ sentences and > 80 chars forces expressive (multi-sentence callout)", (t: TestContext) => {
  // Multi-sentence replies sound noticeably better on expressive even
  // when they fit in the length budget — the per-sentence pause is
  // truer-to-life. A regression that dropped this check would send
  // every 2-line ack onto the cheap model.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";

  // Two terminal punctuation marks, length > 80. Built deterministically
  // so the assertion can't drift with rewording.
  const half = "a".repeat(45);
  const twoSentences = `${half}. ${half}.`; // 45 + 2 + 45 + 1 = 93
  assert.ok(twoSentences.length > 80, "fixture must be > 80 chars to exercise the branch");
  assert.equal(resolveTtsProfile(twoSentences, "auto"), "expressive");

  // Two sentences but exactly 80 chars — the condition is strictly
  // `> 80`, so this branch should NOT fire. With the Flash override
  // configured, the fallback path picks fast.
  const shorterHalf = "a".repeat(38);
  const eightyChars = `${shorterHalf}. ${shorterHalf}.`; // 38 + 2 + 38 + 1 = 79
  const padded = `${eightyChars}x`; // 80
  assert.equal(padded.length, 80);
  assert.equal(resolveTtsProfile(padded, "auto"), "fast");

  // 81 chars and 2+ sentences DOES fire the multi-sentence branch.
  const eightyOne = `${shorterHalf}. ${shorterHalf}.xx`; // 81
  assert.equal(eightyOne.length, 81);
  assert.equal(resolveTtsProfile(eightyOne, "auto"), "expressive");
});

test("auto: a single long sentence (no terminal punctuation) under length stays fast with Flash override", (t: TestContext) => {
  // The multi-sentence branch requires 2+ terminal marks (`.?!`). A
  // single-sentence line under the length threshold therefore picks
  // fast (when the Flash override is set). Guards against a regression
  // that started counting commas or colons as sentence boundaries.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";

  const noTerminal = "Copy that 27-040 you are clear to proceed to the next intersection";
  assert.ok(noTerminal.length > 50 && noTerminal.length <= 140);
  assert.equal(resolveTtsProfile(noTerminal, "auto"), "fast");

  const onlyCommas = "Copy, 27-040, on scene, standby";
  assert.equal(resolveTtsProfile(onlyCommas, "auto"), "fast");
});

test("auto: whitespace-only / leading whitespace are trimmed before the length check", (t: TestContext) => {
  // The resolver uses `.trim()` before measuring length. A regression
  // that dropped the trim would route a "    Copy    " ack onto
  // expressive based on the raw length, even with Flash configured.
  withCleanEnv(t);
  process.env.ELEVENLABS_FAST_MODEL_ID = "eleven_flash_v2_5";

  const padded = `${" ".repeat(200)}Copy${" ".repeat(200)}`;
  assert.equal(resolveTtsProfile(padded, "auto"), "fast");
});
