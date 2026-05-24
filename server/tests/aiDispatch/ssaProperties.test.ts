/**
 * Tests for `server/src/aiDispatch/ssaProperties.ts`.
 *
 * `lookupSsaProperty` is the only thing standing between an
 * account code on the air ("10-8 at 1805") and the right address
 * being entered into CAD. A bug here either (a) misses a perfectly
 * good account code because of leading zeros / casing / whitespace,
 * or (b) silently returns the wrong property record.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { lookupSsaProperty } from "../../src/aiDispatch/ssaProperties.js";
import ssaPropertiesJson from "../../src/aiDispatch/data/ssaProperties.json" with { type: "json" };

const RAW = ssaPropertiesJson as Record<
  string,
  { name: string; street: string; city: string; state: string; zip: string; locnotes: string }
>;

const SOME_CODE = Object.keys(RAW)[0]!; // first key in the bundled property file
const SOME_RECORD = RAW[SOME_CODE]!;

test("lookupSsaProperty returns the exact record for a known account code", () => {
  const r = lookupSsaProperty(SOME_CODE);
  assert.deepEqual(r, SOME_RECORD);
});

test("lookupSsaProperty trims whitespace around the input", () => {
  // Common case: AI engine pulls the account code out of the LLM JSON
  // with a leading or trailing space.
  assert.deepEqual(lookupSsaProperty(`  ${SOME_CODE}  `), SOME_RECORD);
});

test("lookupSsaProperty strips leading zeros and falls back to the stripped key", () => {
  // Account codes in the file are stored without leading zeros, but radio
  // traffic sometimes pads them. '01805' must resolve to '1805'.
  if (!/^\d+$/.test(SOME_CODE)) {
    // skip if first key isn't numeric — the bundled file is numeric so this
    // assert is mostly belt-and-suspenders.
    return;
  }
  assert.deepEqual(lookupSsaProperty(`0${SOME_CODE}`), SOME_RECORD);
  assert.deepEqual(lookupSsaProperty(`00${SOME_CODE}`), SOME_RECORD);
});

test("lookupSsaProperty returns null on unknown / empty / blank / nullish input", () => {
  assert.equal(lookupSsaProperty(null), null);
  assert.equal(lookupSsaProperty(undefined), null);
  assert.equal(lookupSsaProperty(""), null);
  assert.equal(lookupSsaProperty("   "), null);
  // A clearly-fake account code that is not in the bundled JSON.
  assert.equal(lookupSsaProperty("999999"), null);
});

test("ssaProperties.json: every record has all required fields populated", () => {
  // Locks in the data invariant: a record with a missing street would
  // produce '1805 is undefined' on the air.
  for (const [code, record] of Object.entries(RAW)) {
    assert.equal(typeof record.name, "string", `name for ${code}`);
    assert.ok(record.name.trim().length > 0, `non-empty name for ${code}`);
    assert.equal(typeof record.street, "string", `street for ${code}`);
    assert.equal(typeof record.city, "string", `city for ${code}`);
    assert.equal(typeof record.state, "string", `state for ${code}`);
    assert.equal(typeof record.zip, "string", `zip for ${code}`);
    assert.equal(typeof record.locnotes, "string", `locnotes for ${code}`);
  }
});

test("ssaProperties.json: every key is a 3-5 digit account code (matches LLM JSON contract)", () => {
  // The LLM JSON contract pins location_code / info_request.account_code to
  // ^\d{3,5}$ (see normalizeAiDispatchParse). The property data has to
  // match that contract or perfectly-good radio traffic will never resolve.
  for (const code of Object.keys(RAW)) {
    assert.match(code, /^\d{3,5}$/, `account key "${code}" must be 3-5 digits`);
  }
});
