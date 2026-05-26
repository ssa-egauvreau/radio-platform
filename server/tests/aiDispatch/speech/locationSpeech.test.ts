/**
 * Tests for `server/src/aiDispatch/speech/locationSpeech.ts` and the
 * supporting `expandUSStatesForSpeech` in `stateSpeech.ts`.
 *
 * `prepareLocationForTts` is the composed entry point that callers in
 * `infoRequest.ts` (address lookups), `unitLocation.ts` (10-20 responses),
 * and `dispatchAck.ts` (location_name read-back) all go through. It
 * sequences:
 *
 *   1. `expandUSStatesForSpeech` — turn ", CA" into ", California" BEFORE
 *      `spokenizeAddress` gets a chance to run, because spokenizeAddress
 *      otherwise strips ", CA" as a trailing-state token and the address
 *      loses the state entirely on the air.
 *   2. `spokenizeAddress` — number cadence, street-type expansion, zip
 *      stripping, direction-letter expansion.
 *
 * A regression that reorders, swallows nulls, or accidentally short-
 * circuits the empty-string case is audible on the air. The tests
 * pin the actual on-air strings and document the deliberate quirks
 * (whitespace-only passes through, unknown-state abbreviations stay
 * intact, lowercase state tokens are NOT expanded).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { prepareLocationForTts } from "../../../src/aiDispatch/speech/locationSpeech.js";
import {
  expandUSStatesForSpeech,
  US_STATE_SPOKEN,
} from "../../../src/aiDispatch/speech/stateSpeech.js";

// ---------- prepareLocationForTts: guard cases --------------------------

test("prepareLocationForTts: null / undefined return empty string", () => {
  assert.equal(prepareLocationForTts(null), "");
  assert.equal(prepareLocationForTts(undefined), "");
});

test("prepareLocationForTts: empty string returns empty string", () => {
  assert.equal(prepareLocationForTts(""), "");
});

test("prepareLocationForTts: whitespace-only input passes through unchanged (no crash, no over-trim)", () => {
  // Documents the existing short-circuit: the helper only runs the speech
  // pipeline when `location.trim()` is truthy. Callers that pass blanks
  // expect to get blanks back, not the trimmed empty string — locking in
  // the existing contract so a later "tidy-up" change doesn't surprise
  // downstream concatenation code that depends on the exact length.
  assert.equal(prepareLocationForTts("   "), "   ");
});

// ---------- prepareLocationForTts: end-to-end composition ---------------

test("prepareLocationForTts: state must be expanded BEFORE the address spokenizer runs (', CA' survives)", () => {
  // If spokenizeAddress saw the literal ", CA" first, its trailing-state
  // regex would silently strip it. The composition order in
  // `prepareLocationForTts` is what guarantees the on-air "California"
  // suffix actually makes it through. Locks the order in.
  assert.equal(
    prepareLocationForTts("1234 Main St, Anaheim, CA"),
    "twelve thirty-four Main Street, Anaheim, California",
  );
});

test("prepareLocationForTts: state expansion + zip removal + number cadence all chain through", () => {
  // Full address with zip+state — should drop the zip, expand the state,
  // and convert the house number to radio cadence. End-to-end happy path.
  assert.equal(
    prepareLocationForTts("1805 Main St, Anaheim, CA 92614"),
    "eighteen oh five Main Street, Anaheim, California",
  );
});

test("prepareLocationForTts: out-of-state addresses still expand correctly (NY → 'New York')", () => {
  assert.equal(
    prepareLocationForTts("1234 Main St, NY"),
    "twelve thirty-four Main Street, New York",
  );
});

test("prepareLocationForTts: unknown 2-letter state code stays as-is (no fabricated expansion)", () => {
  // A regression that defaulted unknown abbreviations to a wrong state
  // (or to "USA") would mis-speak addresses in territories or future
  // states. Hold the line at "leave it alone unless we have a mapping".
  assert.equal(
    prepareLocationForTts("1234 Main St, XX"),
    "twelve thirty-four Main Street, XX",
  );
});

test("prepareLocationForTts: leading/trailing whitespace is trimmed before the pipeline", () => {
  // Trim before expansion — otherwise ", CA   " wouldn't match the
  // ", CA$" anchor in expandUSStatesForSpeech.
  assert.equal(
    prepareLocationForTts("   1234 Main St, CA   "),
    "twelve thirty-four Main Street, California",
  );
});

// ---------- expandUSStatesForSpeech: unit-level coverage ---------------

test("expandUSStatesForSpeech: only matches ', XX' (comma-then-uppercase-2-letter)", () => {
  // The regex requires a comma — mid-text "CA Boulevard" must NOT be
  // expanded to "California Boulevard". Lock that in to prevent
  // ambiguous street names from being mangled.
  assert.equal(expandUSStatesForSpeech("Main and CA Boulevard"), "Main and CA Boulevard");
});

test("expandUSStatesForSpeech: lowercase state abbreviations are NOT expanded", () => {
  // Lowercase "ca" / "ny" might appear in arbitrary text and must not
  // trigger an expansion. The state abbreviation table is uppercase-keyed
  // on purpose. A regression that case-folded would translate words like
  // ", ca" (Spanish "case", abbreviations, etc.) on the air.
  assert.equal(expandUSStatesForSpeech("1234 ca"), "1234 ca");
});

test("expandUSStatesForSpeech: empty / falsy input passes through unchanged", () => {
  assert.equal(expandUSStatesForSpeech(""), "");
});

test("expandUSStatesForSpeech: handles multiple state tokens in a single string", () => {
  // Cross-state route description — both occurrences must expand so the
  // dispatcher reads the full names. Single-pass replace with /g keeps
  // this working; a regression that dropped the /g flag would only
  // expand the first.
  assert.equal(
    expandUSStatesForSpeech("from 1 Main, CA to 99 Other, NV"),
    "from 1 Main, California to 99 Other, Nevada",
  );
});

test("expandUSStatesForSpeech: every state in US_STATE_SPOKEN round-trips correctly", () => {
  // Defends against a typo in the table — every entry is exercised end-
  // to-end through expandUSStatesForSpeech so a future edit that changes
  // the key casing or shape is caught by at least one assertion. The
  // table itself is the public surface for state expansion; nothing
  // outside this file knows the keys, so testing the helper covers it.
  for (const [abbr, spoken] of Object.entries(US_STATE_SPOKEN)) {
    const out = expandUSStatesForSpeech(`Address, ${abbr}`);
    assert.equal(out, `Address, ${spoken}`, `state ${abbr} → ${spoken}`);
  }
});
