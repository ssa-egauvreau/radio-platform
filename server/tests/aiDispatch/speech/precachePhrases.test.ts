/**
 * Regression tests for `server/src/aiDispatch/speech/precachePhrases.ts`.
 *
 * The TTS pre-cache is the lookup that lets the AI dispatcher answer the
 * shortest, hottest radio acknowledgements ("10-4", "Copy 151, 10-8",
 * "Standby") with a pre-generated ElevenLabs MP3 instead of paying the
 * 800–1500 ms round-trip to ElevenLabs every time. If the cache key
 * (`normalizeForTtsPrecache`) drifts from how the dispatcher composes its
 * acks, every "Copy 151" lands on the slow path even though we
 * pre-rendered the audio at boot — and we then re-bill ElevenLabs for
 * thousands of phrases we already paid for.
 *
 * The phrase list itself (`buildPrecachePhraseList`) is what we hand the
 * ElevenLabs precache job at startup. If a phrase the dispatcher actually
 * produces is missing, the cache permanently misses on it; if a phrase is
 * duplicated, we burn ElevenLabs credits and warm-up time on it twice.
 *
 * Tests pinned here:
 *
 *   - `normalizeForTtsPrecache` strips surrounding whitespace, collapses
 *     internal whitespace runs, drops trailing terminal punctuation, and
 *     lower-cases — so the dispatcher's "Copy 151 ." and the precache
 *     job's "copy 151" key into the same bucket. This is the load-bearing
 *     property: the cache reader (`getTtsPrecacheHit`) keys on the
 *     normalized output and the dispatcher's runtime ack passes through
 *     the same function before lookup.
 *   - The normaliser accepts non-string inputs without throwing — the
 *     dispatcher pipeline may hand it whatever the LLM returned, and a
 *     thrown TypeError would 500 a perfectly answerable transmission.
 *   - `buildPrecachePhraseList` returns a non-empty, de-duplicated list
 *     so the worker pool doesn't re-render "Copy" twenty times in a row.
 *   - The list covers the small "I copied that" set the deterministic
 *     dispatch-ack builder emits for every radio unit and for every
 *     status code (10-7 / 10-8 / 10-19 / 10-23 / 10-97 / 10-98 /
 *     code 4) — these are the phrases that ship in dispatcher_response
 *     for 80%+ of acknowledged radio traffic.
 *   - The list is normalisation-stable: pushing each entry through
 *     `normalizeForTtsPrecache` produces unique keys, so the precache
 *     cache map ends with one entry per phrase (no shadowing).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPrecachePhraseList,
  normalizeForTtsPrecache,
} from "../../../src/aiDispatch/speech/precachePhrases.js";

test("normalizeForTtsPrecache: trims, lowercases, and collapses internal whitespace", () => {
  assert.equal(normalizeForTtsPrecache("Copy"), "copy");
  assert.equal(normalizeForTtsPrecache("  Copy 151  "), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy   151"), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy\t151"), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy\n151"), "copy 151");
});

test("normalizeForTtsPrecache: strips a trailing run of terminal punctuation only", () => {
  // The deterministic ack builder emits "Copy 151." (trailing period) for
  // most variants but never "Copy. 151" or "Copy ! foo". The cache key
  // must therefore drop the trailing period — but NOT internal
  // punctuation that's part of the phrase ("Copy 151, 10-8").
  assert.equal(normalizeForTtsPrecache("Copy 151."), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy 151!"), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy 151?"), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy 151..."), "copy 151");
  assert.equal(normalizeForTtsPrecache("Copy 151!?!"), "copy 151");
  // Internal punctuation (comma between unit and status) must NOT be stripped.
  assert.equal(normalizeForTtsPrecache("Copy 151, 10-8."), "copy 151, 10-8");
  // Hyphens are part of the radio code, not terminal punctuation.
  assert.equal(normalizeForTtsPrecache("10-4."), "10-4");
});

test("normalizeForTtsPrecache: an empty / whitespace-only input collapses to ''", () => {
  // Important for the cache reader's null-vs-hit path — an empty key must
  // never resolve to a real cache entry, even one that was somehow keyed
  // by an empty string at write time.
  assert.equal(normalizeForTtsPrecache(""), "");
  assert.equal(normalizeForTtsPrecache("   "), "");
  assert.equal(normalizeForTtsPrecache("\t\n"), "");
});

test("normalizeForTtsPrecache: coerces non-string input without throwing", () => {
  // The dispatcher pipeline currently always passes strings, but the
  // typing is `string` only by convention — if a future caller hands it
  // null or a number, throwing here would crash an in-progress AI reply.
  assert.equal(normalizeForTtsPrecache(null as unknown as string), "null");
  assert.equal(normalizeForTtsPrecache(undefined as unknown as string), "undefined");
  assert.equal(normalizeForTtsPrecache(151 as unknown as string), "151");
  // And the coerced value still goes through the trim/lower pipeline.
  assert.equal(normalizeForTtsPrecache("  151  " as string), "151");
});

test("buildPrecachePhraseList: returns a non-empty, deduplicated list", () => {
  const phrases = buildPrecachePhraseList();
  assert.ok(phrases.length > 0, "precache list must not be empty");
  // Each phrase is a non-empty string (no nulls / empties slipped in).
  for (const phrase of phrases) {
    assert.equal(typeof phrase, "string", `non-string phrase: ${phrase}`);
    assert.ok(phrase.length > 0, "empty phrase would burn an ElevenLabs call for nothing");
  }
  // De-duped — building once with a Set inside means a single phrase
  // never appears twice. A regression to push-based building would burn
  // credits at warm-up.
  const unique = new Set(phrases);
  assert.equal(
    unique.size,
    phrases.length,
    "phrases must be unique — duplicates re-bill ElevenLabs on warmup",
  );
});

test("buildPrecachePhraseList: includes the core ack vocabulary the dispatcher emits", () => {
  // These are the phrases the deterministic dispatch-ack builder + the
  // hand-coded chitchat responder emit verbatim. If any of them stops
  // being precached, dispatchers hear an audible delay on the most common
  // replies.
  const phrases = new Set(buildPrecachePhraseList());
  for (const expected of [
    "Copy",
    "10-4",
    "Standby",
    "Negative",
    "Affirm",
    "Roger",
    "Received",
    "Copy. Standby.",
  ]) {
    assert.ok(
      phrases.has(expected),
      `precache list must include "${expected}" (a high-frequency dispatch ack)`,
    );
  }
});

test("buildPrecachePhraseList: covers Copy <unit>, 10-<status> for every radio unit + status", () => {
  // The deterministic ack builder produces these by template — if the
  // precache list goes out of sync with that template, every unit's
  // "Copy 151, 10-8" routes through the slow path.
  const phrases = new Set(buildPrecachePhraseList());
  const RADIO_UNITS = ["151", "231", "334", "351", "352", "401", "402", "403"];
  const STATUSES = ["10-8", "10-7", "10-23", "10-97", "10-98", "10-19", "code 4"];
  for (const unit of RADIO_UNITS) {
    for (const status of STATUSES) {
      const phrase = `Copy ${unit}, ${status}`;
      assert.ok(
        phrases.has(phrase),
        `precache list must include "${phrase}" (deterministic ack template output)`,
      );
    }
  }
});

test("buildPrecachePhraseList: includes per-unit standby for both radio AND command units", () => {
  // Command units have a different format ("27-010, copy. Standby.") and
  // can legitimately request standby too; the precache list must cover
  // both fleets or one fleet pays the slow-path tax.
  const phrases = new Set(buildPrecachePhraseList());
  for (const u of ["151", "231"]) {
    assert.ok(phrases.has(`${u}, copy. Standby.`));
  }
  for (const u of ["27-000", "27-010", "27-020", "27-030"]) {
    assert.ok(
      phrases.has(`${u}, copy. Standby.`),
      `precache list must include the command-unit standby ack for ${u}`,
    );
  }
});

test("phrases are normalisation-stable: each entry produces a unique cache key", () => {
  // The precache writer keys the in-memory map by `normalizeForTtsPrecache(phrase)`.
  // If two phrases collapse to the same key (e.g. case-only differences),
  // the second overwrites the first — we then permanently miss the
  // overwritten variant's audio at runtime.
  const phrases = buildPrecachePhraseList();
  const keys = new Set<string>();
  for (const phrase of phrases) {
    const key = normalizeForTtsPrecache(phrase);
    assert.ok(
      !keys.has(key),
      `two precache phrases normalize to the same cache key: ${JSON.stringify(key)}`,
    );
    keys.add(key);
  }
  assert.equal(keys.size, phrases.length);
});

test("normalised cache key matches the dispatcher's runtime ack lookup", () => {
  // The precache writer normalises the phrase. The runtime reader
  // (`getTtsPrecacheHit`) re-normalises the dispatcher's actual ack text
  // before looking it up. They must produce the same key.
  //
  // Pin a few representative dispatcher outputs against the entries they
  // SHOULD hit in the precache map.
  const phrases = new Set(buildPrecachePhraseList().map(normalizeForTtsPrecache));
  // Deterministic ack builder emits e.g. "Copy 151." for a unit asking
  // for 10-2 with no location. The cache must hit even with the trailing
  // period the builder appends.
  assert.ok(phrases.has(normalizeForTtsPrecache("Copy 151")));
  // ElevenLabs sometimes returns slightly differently capitalised text;
  // the reader-side normalise should fold those into the same key.
  assert.ok(phrases.has(normalizeForTtsPrecache("COPY 151")));
  assert.ok(phrases.has(normalizeForTtsPrecache("copy 151")));
});
