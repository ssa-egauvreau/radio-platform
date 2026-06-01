import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCadPersonLinkBody,
  buildCadPersonSearchParams,
  buildCadVehicleSearchParams,
  formatCadIncidentLookupRadioLine,
  formatIncidentWhenForRadio,
  humanIncidentTypeForRadio,
  mapTen8ApiIncident,
  pickIncidentSummaryForRadio,
} from "../../src/ten8/cadRadioLookup.js";

test("buildCadPersonSearchParams: fuzzy q plus optional DOB", () => {
  const p = buildCadPersonSearchParams("John Smith DOB 01/15/1990");
  assert.equal(p.q, "John Smith");
  assert.equal(p.dob, "01/15/1990");
  assert.equal(p.limit, 5);
});

test("buildCadVehicleSearchParams: extracts license plate", () => {
  const p = buildCadVehicleSearchParams("run CA plate 8ABC123");
  assert.equal(p.license, "8ABC123");
  assert.equal(p.state, "CA");
});

test("buildCadVehicleSearchParams: extracts VIN when present", () => {
  const p = buildCadVehicleSearchParams("VIN 1HGBH41JXMN109186");
  assert.equal(p.vin, "1HGBH41JXMN109186");
});

test("mapTen8ApiIncident: maps API incident to radio list shape", () => {
  const mapped = mapTen8ApiIncident({
    id: 99,
    incident_id: "26-2223",
    type: "415 - Disturbing the Peace",
    status: "open",
    location: "123 Main St, Anaheim, CA 92805",
    comments: [{ comment: "RP reports loud party" }],
    units: [{ unit: "352" }],
  });
  assert.equal(mapped.call_id, "26-2223");
  assert.equal(mapped.incident_type, "415 - Disturbing the Peace");
  assert.equal(mapped.status, "open");
  assert.ok(mapped.location?.includes("Anaheim"));
});

test("formatCadIncidentLookupRadioLine: natural readback for cleared GOA/UTL call", () => {
  const line = formatCadIncidentLookupRadioLine({
    incident_id: "26-2355",
    type: "Test Call (Do not Dispatch)",
    status: "Cleared",
    isClosed: 1,
    date: "05/29/2026",
    time: "14:31:19",
    location: "401 W 1st St, Santa Ana, CA 92701, USA",
    comments: [
      { type: "system", comment: "Request acknowledged" },
      {
        type: "disposition",
        comment:
          "Incident closed: GOA (Gone on Arrival) / UTL (Unable to Locate) - GOA CODE 4",
      },
    ],
    dispositions: [{ disposition: "Call Cleared", notes: "" }],
  });
  assert.match(line, /^call 26-2355 was on May 29th, 2026 at 2:31 PM for a test call at 401 W 1st St, Santa Ana\./i);
  assert.match(line, /gone on arrival/i);
  assert.match(line, /unable to locate/i);
  assert.doesNotMatch(line, /comments:/i);
  assert.doesNotMatch(line, /units 351/i);
  assert.doesNotMatch(line, /UTL\/GOA/i);
});

test("humanIncidentTypeForRadio: 415 code uses spoken table", () => {
  assert.match(humanIncidentTypeForRadio("415 - Disturbing the Peace"), /four fifteen/i);
});

test("formatIncidentWhenForRadio: parses 10-8 date and time fields", () => {
  const when = formatIncidentWhenForRadio({ date: "05/29/2026", time: "14:31:19" });
  assert.match(when, /May 29th, 2026/);
  assert.match(when, /2:31 PM/);
});

test("pickIncidentSummaryForRadio: prefers disposition shorthand over system ack", () => {
  const s = pickIncidentSummaryForRadio({
    comments: [
      { type: "system", comment: "Request acknowledged" },
      { type: "disposition", comment: "UTL/GOA; CODE 4 UNABLE TO LOCATE" },
    ],
  });
  assert.ok(s);
  assert.match(s!, /unable to locate/i);
  assert.match(s!, /gone on arrival|code four/i);
});

test("buildCadPersonLinkBody: nests person fields for POST persons", () => {
  const body = buildCadPersonLinkBody({
    relation: "suspect",
    first_name: "John",
    last_name: "Smith",
    dob: "01/01/1990",
    notes: "M/W 6FT",
  });
  assert.equal(body.relation, "suspect");
  assert.deepEqual(body.person, {
    firstName: "John",
    lastName: "Smith",
    dob: "01/01/1990",
  });
  assert.equal(body.notes, "M/W 6FT");
});
