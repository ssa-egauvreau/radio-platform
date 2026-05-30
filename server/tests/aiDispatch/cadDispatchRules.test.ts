import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCadDispatchRules,
  extractCallLookupNumber,
} from "../../src/aiDispatch/cadDispatchRules.js";
import { buildCadPersonLinkFromSubject } from "../../src/aiDispatch/cadPersonHelpers.js";
import { normalizeCadTagName } from "../../src/ten8/cadRadioLookup.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

function parsed(over: Partial<AiDispatchParseResult> = {}): AiDispatchParseResult {
  return {
    actionable: true,
    intent: "unknown",
    unit: "27-040",
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
    cad_person_link: null,
    cad_tag: null,
    cad_tag_remove: null,
    ...over,
  };
}

test("extractCallLookupNumber finds incident numbers", () => {
  assert.equal(extractCallLookupNumber("pull incident 26-2223"), "26-2223");
  assert.equal(extractCallLookupNumber("look up call 25-0129 please"), "25-0129");
});

test("applyCadDispatchRules: 968 triggers cad_person_search with subject", () => {
  const out = applyCadDispatchRules(
    parsed(),
    "27-040, 968, John Smith",
  );
  assert.equal(out.intent, "request_info");
  assert.equal(out.code, "968");
  assert.equal(out.info_request?.type, "cad_person_search");
  assert.equal(out.info_request?.subject, "John Smith");
});

test("applyCadDispatchRules: plain English subject lookup", () => {
  const out = applyCadDispatchRules(
    parsed(),
    "352 can you run Maria Garcia in the system",
  );
  assert.equal(out.info_request?.type, "cad_person_search");
  assert.match(out.info_request?.subject ?? "", /Maria Garcia/i);
});

test("applyCadDispatchRules: incident lookup requires call number prompt", () => {
  const out = applyCadDispatchRules(parsed(), "352 look up a call for me");
  assert.equal(out.info_request?.type, "cad_incident_lookup");
  assert.equal(out.info_request?.subject, null);
  assert.match(out.dispatcher_response ?? "", /call number/i);
});

test("applyCadDispatchRules: incident lookup with number", () => {
  const out = applyCadDispatchRules(parsed(), "352 get incident 26-2223");
  assert.equal(out.info_request?.type, "cad_incident_lookup");
  assert.equal(out.info_request?.subject, "26-2223");
});

test("applyCadDispatchRules: assign Billable tag", () => {
  const out = applyCadDispatchRules(parsed(), "352 tag this call billable");
  assert.equal(out.cad_tag, "Billable");
});

test("applyCadDispatchRules: remove Parking Response tag", () => {
  const out = applyCadDispatchRules(parsed(), "352 remove the parking response tag");
  assert.equal(out.cad_tag_remove, "Parking Response");
});

test("applyCadDispatchRules: ask if call has Billable tag", () => {
  const out = applyCadDispatchRules(parsed(), "352 is this call billable");
  assert.equal(out.info_request?.type, "cad_call_tags");
  assert.equal(out.info_request?.subject, "Billable");
});

test("buildCadPersonLinkFromSubject parses name and DOB", () => {
  const link = buildCadPersonLinkFromSubject("John Smith DOB 01/15/1990");
  assert.equal(link?.first_name, "John");
  assert.equal(link?.last_name, "Smith");
  assert.equal(link?.dob, "01/15/1990");
});

test("normalizeCadTagName maps spoken tags", () => {
  assert.equal(normalizeCadTagName("billable"), "Billable");
  assert.equal(normalizeCadTagName("parking response"), "Parking Response");
});
