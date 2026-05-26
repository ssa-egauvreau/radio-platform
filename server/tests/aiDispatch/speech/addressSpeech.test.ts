/**
 * Tests for `server/src/aiDispatch/speech/addressSpeech.ts`.
 *
 * `spokenizeAddress` is one of the last stages before an address gets sent
 * to ElevenLabs. It exists to fix three specific classes of on-air mistake:
 *
 *   1. House numbers spoken as "one thousand eight hundred five" instead of
 *      "eighteen oh five" — wrong cadence, hard to copy.
 *   2. Street-type abbreviations ("St" / "Blvd" / "Pkwy") read literally as
 *      single letters instead of "Street" / "Boulevard" / "Parkway".
 *   3. Trailing `, CA 92614` or `, USA` noise reading as state-abbreviation
 *      gibberish or a long zip code recital.
 *
 * Helpers downstream of this (`prepareLocationForTts`, dispatcher TTS) trust
 * that the output is already "ready to speak" — a regression here is audible
 * on the air immediately and erodes officer trust in the system. The tests
 * pin the actual on-air strings rather than just shape so cosmetic-looking
 * refactors that change the cadence (e.g. "eighteen oh five" vs "eighteen
 * hundred five") are caught.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { spokenizeAddress } from "../../../src/aiDispatch/speech/addressSpeech.js";

// ---------- guard clauses -------------------------------------------------

test("spokenizeAddress: null / undefined / empty input returns empty string", () => {
  assert.equal(spokenizeAddress(null), "");
  assert.equal(spokenizeAddress(undefined), "");
  assert.equal(spokenizeAddress(""), "");
});

// ---------- house-number cadence -----------------------------------------

test("spokenizeAddress: 4-digit house number reads in radio cadence (1805 → 'eighteen oh five', not 'one thousand eight hundred five')", () => {
  // The whole point of this helper: 1805 must NOT read as "one thousand
  // eight hundred and five" — that's how a regression would slip in if
  // someone replaced the bespoke cadence with `numberToWords(n)` alone.
  assert.equal(spokenizeAddress("1805 Main St"), "eighteen oh five Main Street");
});

test("spokenizeAddress: 4-digit number with non-zero second half reads as two pairs (1234 → 'twelve thirty-four')", () => {
  assert.equal(spokenizeAddress("1234 Foo Rd"), "twelve thirty-four Foo Road");
});

test("spokenizeAddress: 4-digit number ending in ...00 collapses to 'hundred' (1000 → 'ten hundred')", () => {
  // Locks in the existing — slightly quirky — cadence ("ten hundred" rather
  // than "one thousand"). Officers are already trained on this; a refactor
  // that switched to "one thousand" would break that habit silently.
  assert.equal(spokenizeAddress("1000 Foo Rd"), "ten hundred Foo Road");
});

test("spokenizeAddress: 4-digit number with single-digit tail keeps 'oh' separator (8001 → 'eighty oh one')", () => {
  assert.equal(spokenizeAddress("8001 Foo Pkwy"), "eighty oh one Foo Parkway");
});

test("spokenizeAddress: 3-digit numbers — 100 → 'one hundred', 105 → 'one oh five', 123 → 'one twenty-three'", () => {
  assert.equal(spokenizeAddress("100 Foo Rd"), "one hundred Foo Road");
  assert.equal(spokenizeAddress("105 Foo Rd"), "one oh five Foo Road");
  assert.equal(spokenizeAddress("123 Foo Rd"), "one twenty-three Foo Road");
});

test("spokenizeAddress: 2-digit numbers use hyphenated tens form ('forty-two', 'sixty-one')", () => {
  assert.equal(spokenizeAddress("Address 42 Foo"), "Address forty-two Foo");
  assert.equal(spokenizeAddress("61 Foo Rd"), "sixty-one Foo Road");
});

test("spokenizeAddress: 1-digit standalone numbers expand to word ('10 Downing Street')", () => {
  assert.equal(spokenizeAddress("10 Downing Street"), "ten Downing Street");
});

test("spokenizeAddress: 5+-digit standalone numbers fall back to digit-by-digit ('92614' → 'nine two six one four')", () => {
  // 5-digit-only inputs hit the trailing-zip stripper and disappear, so
  // exercise the digit-by-digit branch with the number embedded mid-line.
  assert.equal(
    spokenizeAddress("Was at 92614 around the corner"),
    "Was at nine two six one four around the corner",
  );
});

// ---------- known-code paths (NOT changed) -------------------------------

test("spokenizeAddress: 3-digit info codes use the same 'X-teen' grouping ('913' → 'nine thirteen')", () => {
  // SPELL_CODES rules live in prepareTextForTts; here we verify that
  // spokenizeAddress doesn't mangle a bare radio code into "nine hundred
  // thirteen" before that stage gets a chance to see it.
  assert.equal(spokenizeAddress("Suspect at 913"), "Suspect at nine thirteen");
});

// ---------- street-type expansion ---------------------------------------

test("spokenizeAddress: common street-type abbreviations expand (St → Street, Blvd → Boulevard, etc.)", () => {
  assert.equal(
    spokenizeAddress("1234 SW Main Hwy, San Diego, CA 92101-1234"),
    "twelve thirty-four Southwest Main Highway, San Diego, California",
  );
});

test("spokenizeAddress: Ave / Pkwy / Apt / Ste / Bldg expand to long form", () => {
  assert.equal(spokenizeAddress("Apt 4B"), "Apartment 4B");
  // Mixed street types in one input.
  assert.equal(
    spokenizeAddress("1234 Main Ave & 5678 Other St"),
    "twelve thirty-four Main Avenue & fifty-six seventy-eight Other Street",
  );
});

test("spokenizeAddress: street-type expansion is case-insensitive ('main st' lowercased input)", () => {
  // The 'main' word stays as the talker wrote it, but 'st' must still
  // expand — the LLM occasionally emits all-lowercase addresses and the
  // helper has to handle them.
  assert.equal(spokenizeAddress("1234 main st"), "twelve thirty-four main Street");
});

test("spokenizeAddress: 'St.' with a trailing period still expands ('Main St.' → 'Main Street.')", () => {
  // The trailing period from the original abbreviation survives. We don't
  // want the helper to strip terminal punctuation — that's the caller's
  // job. Just verify the abbreviation expansion still fires through the
  // period.
  assert.equal(spokenizeAddress("1234 Main St."), "twelve thirty-four Main Street.");
});

// ---------- cardinal direction expansion --------------------------------

test("spokenizeAddress: single-letter cardinal directions expand ('N ' → 'North ', etc.)", () => {
  assert.equal(spokenizeAddress("1805 N Main Blvd"), "eighteen oh five North Main Boulevard");
});

test("spokenizeAddress: two-letter cardinal directions expand (NE/NW/SE/SW)", () => {
  assert.equal(spokenizeAddress("1234 NE Main Ave"), "twelve thirty-four Northeast Main Avenue");
});

test("spokenizeAddress: cardinal-letter followed by a period does NOT expand ('1234 N. Main' stays as-is)", () => {
  // The single-letter regex requires a space after the letter (\b([NSEW])\s),
  // so "N." doesn't match. We lock that in deliberately — expanding "N."
  // mid-token would mangle initials and last names that look like
  // cardinals. A regression that loosened the regex would speak names
  // like "N. Smith" as "North. Smith".
  assert.equal(spokenizeAddress("1234 N. Main"), "twelve thirty-four N. Main");
});

test("spokenizeAddress: full direction words pass through unchanged ('East Main' stays 'East Main')", () => {
  assert.equal(spokenizeAddress("1234 East Main"), "twelve thirty-four East Main");
});

// ---------- state / zip / USA cleanup -----------------------------------

test("spokenizeAddress: ', CA 92614' collapses to ', California' (drops zip, expands state)", () => {
  assert.equal(
    spokenizeAddress("1805 Main St, Anaheim, CA 92614"),
    "eighteen oh five Main Street, Anaheim, California",
  );
});

test("spokenizeAddress: trailing ', CA' (no zip) still expands to ', California'", () => {
  assert.equal(
    spokenizeAddress("1234 Main St, Anaheim, CA"),
    "twelve thirty-four Main Street, Anaheim, California",
  );
});

test("spokenizeAddress: trailing ', USA' is stripped (never read as 'United States of America')", () => {
  assert.equal(spokenizeAddress("1234 Main, USA"), "twelve thirty-four Main");
});

test("spokenizeAddress: pure 5-digit zip alone is stripped to empty (trailing-zip regex eats the whole string)", () => {
  // Standalone "92614" at end of input matches the trailing-zip regex and
  // is removed. Locks in the no-zip-on-the-radio behaviour.
  assert.equal(spokenizeAddress("92614"), "");
});

// ---------- whitespace / trailing-comma cleanup -------------------------

test("spokenizeAddress: collapses runs of whitespace and trims edges", () => {
  assert.equal(
    spokenizeAddress("  1234   Main   St  "),
    "twelve thirty-four Main Street",
  );
});

test("spokenizeAddress: strips trailing ', '", () => {
  assert.equal(spokenizeAddress("1234 Main, "), "twelve thirty-four Main");
});

// ---------- regression guards ------------------------------------------

test("spokenizeAddress: callsigns like '27-040' get their digits spokenized (not skipped)", () => {
  // The 27-XXX prefix-strip happens in dispatchAck / TTS prep — at this
  // layer we just verify that mid-text two-digit numbers around a hyphen
  // both get spokenized. Documents the current behaviour so a future
  // change that special-cased callsigns here is visible.
  assert.equal(
    spokenizeAddress("Officer 27-040 responding"),
    "Officer twenty-seven-forty responding",
  );
});

test("spokenizeAddress: ordinals like '1st' are NOT mistakenly digitized ('Main and 1st' stays)", () => {
  // The `\b(\d+)\b` digit regex requires word boundaries on BOTH sides, so
  // a digit glued to letters ("1st", "4B") is correctly skipped. A
  // regression that loosened that boundary would speak "1st Street" as
  // "one st Street" (which then expands to "one Street Street").
  assert.equal(spokenizeAddress("Main and 1st"), "Main and 1st");
});
