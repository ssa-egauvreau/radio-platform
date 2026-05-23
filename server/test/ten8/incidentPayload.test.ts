import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExternalLocationSearchQuery,
  buildSsaPropertyLocnotes,
  clampTen8Priority,
  finalizeTen8NewIncidentBody,
  formatLocationForTen8,
  normalizeAddressForTen8,
  parseUsAddressLine,
} from "../../src/ten8/incidentPayload.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

/**
 * The Google geocoder that 10-8 calls fails on "1586 N. Batavia St" but resolves
 * "1586 N Batavia St". `normalizeAddressForTen8` is the regression guard for that
 * fix (commit dc631d1). If this test ever turns red, dispatched calls will land
 * with Coordinates: UNAVAILABLE in CAD.
 */
test("normalizeAddressForTen8 strips period after directionals", () => {
  assert.equal(
    normalizeAddressForTen8("1586 N. Batavia St"),
    "1586 N Batavia St",
  );
  assert.equal(
    normalizeAddressForTen8("1586 S. Batavia St"),
    "1586 S Batavia St",
  );
  assert.equal(
    normalizeAddressForTen8("100 E. First Ave"),
    "100 E First Ave",
  );
  assert.equal(
    normalizeAddressForTen8("200 W. Highland Pkwy"),
    "200 W Highland Pkwy",
  );
});

test("normalizeAddressForTen8 strips period after common street type abbreviations", () => {
  assert.equal(
    normalizeAddressForTen8("100 Main St. Anaheim CA"),
    "100 Main St Anaheim CA",
  );
  assert.equal(
    normalizeAddressForTen8("200 Sunset Blvd."),
    "200 Sunset Blvd",
  );
  assert.equal(
    normalizeAddressForTen8("400 Highland Pkwy., Suite 5"),
    "400 Highland Pkwy, Suite 5",
  );
});

test("normalizeAddressForTen8 leaves non-street abbreviations alone", () => {
  // "Mt." (Mount) is not a street-type abbreviation; the period must survive.
  assert.equal(
    normalizeAddressForTen8("999 Mt. Olive Dr"),
    "999 Mt. Olive Dr",
  );
  // "Dept." (Department) is not in the allow-list either.
  assert.equal(
    normalizeAddressForTen8("Police Dept. 100 Civic Way"),
    "Police Dept. 100 Civic Way",
  );
});

test("normalizeAddressForTen8 collapses internal whitespace and handles empty", () => {
  assert.equal(normalizeAddressForTen8("  100   Main   St  "), "100 Main St");
  assert.equal(normalizeAddressForTen8(""), "");
  assert.equal(normalizeAddressForTen8(null), "");
  assert.equal(normalizeAddressForTen8(undefined), "");
});

test("formatLocationForTen8 builds a Google-friendly single-line location", () => {
  const loc = formatLocationForTen8({
    street: "1586 N. Batavia St",
    city: "Orange",
    state: "ca",
    zip: "92867",
  });
  assert.ok(loc);
  assert.equal(loc!.location, "1586 N Batavia St, Orange, CA 92867");
  assert.equal(loc!.streetAddress, "1586 N Batavia St");
  assert.equal(loc!.city, "Orange");
  assert.equal(loc!.state, "CA");
  assert.equal(loc!.zip, "92867");
  // California defaults to Orange County when no county is supplied.
  assert.equal(loc!.county, "Orange County");
});

test("formatLocationForTen8 returns null when nothing useful is supplied", () => {
  assert.equal(formatLocationForTen8({ street: "", city: "" }), null);
  assert.equal(formatLocationForTen8({}), null);
});

test("formatLocationForTen8 enforces 5-digit zip and 2-letter state", () => {
  const loc = formatLocationForTen8({
    street: "100 Main St",
    city: "Orange",
    state: "California",
    zip: "92867-1234",
  });
  assert.ok(loc);
  assert.equal(loc!.state, "CA");
  assert.equal(loc!.zip, "92867");
});

test("formatLocationForTen8 keeps non-CA county only when caller provides one", () => {
  const fromCaller = formatLocationForTen8({
    street: "100 Main",
    city: "Dallas",
    state: "TX",
    county: "Dallas County",
  });
  assert.equal(fromCaller?.county, "Dallas County");

  // Non-CA with no county => no county field added.
  const none = formatLocationForTen8({
    street: "100 Main",
    city: "Dallas",
    state: "TX",
  });
  assert.equal(none?.county, undefined);
});

test("parseUsAddressLine splits 3-part US address", () => {
  const loc = parseUsAddressLine("123 Main St, Anaheim, CA 92805");
  assert.ok(loc);
  assert.equal(loc!.streetAddress, "123 Main St");
  assert.equal(loc!.city, "Anaheim");
  assert.equal(loc!.state, "CA");
  assert.equal(loc!.zip, "92805");
  assert.equal(loc!.location, "123 Main St, Anaheim, CA 92805");
});

test("parseUsAddressLine falls back to Orange/CA when only street is given", () => {
  const loc = parseUsAddressLine("123 Main St");
  assert.ok(loc);
  assert.equal(loc!.city, "Orange");
  assert.equal(loc!.state, "CA");
});

test("parseUsAddressLine returns null for empty input", () => {
  assert.equal(parseUsAddressLine(""), null);
  assert.equal(parseUsAddressLine("   "), null);
});

test("clampTen8Priority enforces 1..4 range with sane fallback", () => {
  assert.equal(clampTen8Priority(1), 1);
  assert.equal(clampTen8Priority(4), 4);
  assert.equal(clampTen8Priority(7), 4); // above range
  assert.equal(clampTen8Priority(0), 4); // 10-8 has no priority 0
  assert.equal(clampTen8Priority(-1), 4);
  assert.equal(clampTen8Priority("2"), 2);
  assert.equal(clampTen8Priority("not a number"), 4);
  assert.equal(clampTen8Priority(null), 4);
  assert.equal(clampTen8Priority(undefined), 4);
  assert.equal(clampTen8Priority(2.6), 3); // rounded
});

test("buildSsaPropertyLocnotes uses property number first, name second, no dashes", () => {
  assert.equal(
    buildSsaPropertyLocnotes("3208", { name: "Acme Plaza" }),
    "3208 Acme Plaza",
  );
  // Dashed account code is stripped to digits-only for locnotes.
  assert.equal(
    buildSsaPropertyLocnotes("32-08", { name: "Acme Plaza" }),
    "3208 Acme Plaza",
  );
  // Missing pieces gracefully degrade.
  assert.equal(buildSsaPropertyLocnotes("", { name: "Acme" }), "Acme");
  assert.equal(buildSsaPropertyLocnotes("3208", { name: "" }), "3208");
});

function makeParse(overrides: Partial<AiDispatchParseResult>): AiDispatchParseResult {
  return {
    actionable: true,
    intent: "dispatch",
    unit: "2009",
    summary: "",
    confidence: 0.9,
    dispatcher_response: null,
    trigger_emergency_tone: false,
    recommended_action: null,
    plate_request: null,
    code: null,
    location_code: null,
    location_name: null,
    info_request: null,
    comment_text: null,
    ...overrides,
  };
}

test("buildExternalLocationSearchQuery prefers a named place", () => {
  const q = buildExternalLocationSearchQuery(
    makeParse({ location_name: "Honda Center" }),
    "respond to Honda Center for a 415",
  );
  assert.equal(q, "Honda Center");
});

test("buildExternalLocationSearchQuery rejects bare SSA account codes", () => {
  // location_name is just the account number — don't try to Google "3208".
  const q = buildExternalLocationSearchQuery(
    makeParse({ location_name: "3208", summary: "respond to 3208" }),
  );
  assert.notEqual(q, "3208");
});

test('buildExternalLocationSearchQuery extracts "at X" from the summary', () => {
  const q = buildExternalLocationSearchQuery(
    makeParse({ summary: "Disturbance at the Honda Center; subjects fighting." }),
  );
  assert.equal(q, "the Honda Center");
});

test("buildExternalLocationSearchQuery falls back to transcript", () => {
  const q = buildExternalLocationSearchQuery(
    makeParse({ summary: "" }),
    "21 we have a problem at the corner of 5th and Main",
  );
  assert.equal(q, "the corner of 5th and Main");
});

test("buildExternalLocationSearchQuery returns null with nothing to go on", () => {
  const q = buildExternalLocationSearchQuery(makeParse({ summary: "" }));
  assert.equal(q, null);
});

test("finalizeTen8NewIncidentBody normalizes addresses and clamps priority", () => {
  const out = finalizeTen8NewIncidentBody({
    type: "  415 - Disturbing the Peace  ",
    summary: "noise complaint",
    priority: 9, // out of range, must clamp to 4
    location: "1586 N. Batavia St, Orange, CA 92867",
    streetAddress: "1586 N. Batavia St",
    city: "Orange",
    state: "CA",
  });
  assert.equal(out.priority, 4);
  assert.equal(out.type, "415 - Disturbing the Peace");
  assert.equal(out.location, "1586 N Batavia St, Orange, CA 92867");
  assert.equal(out.streetAddress, "1586 N Batavia St");
});

test("finalizeTen8NewIncidentBody rebuilds location when only streetAddress is present", () => {
  const out = finalizeTen8NewIncidentBody({
    type: "Patrol Check",
    summary: "check",
    priority: 4,
    streetAddress: "100 Main St.",
    city: "Anaheim",
    state: "CA",
    zip: "92805",
  });
  assert.equal(out.streetAddress, "100 Main St");
  assert.equal(out.location, "100 Main St, Anaheim, CA 92805");
});

test("finalizeTen8NewIncidentBody leaves zero priority replaced with default", () => {
  const out = finalizeTen8NewIncidentBody({
    type: "Patrol Check",
    summary: "check",
    priority: 0,
  });
  assert.equal(out.priority, 4);
});
