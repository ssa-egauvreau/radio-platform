import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAccountLocnotes,
  inferSpokenBusiness,
  parseBusinessAtAccountPhrase,
  spokenPlaceConflictsWithProperty,
} from "../../src/aiDispatch/locationResolve.js";
import type { AiDispatchParseResult } from "../../src/aiDispatch/parse.js";

function parseResult(over: Partial<AiDispatchParseResult> = {}): AiDispatchParseResult {
  return {
    actionable: true,
    intent: "dispatch",
    unit: "27-040",
    summary: "",
    confidence: 1,
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
    ...over,
  };
}

test("parseBusinessAtAccountPhrase extracts Ross and account 3123", () => {
  const got = parseBusinessAtAccountPhrase(
    "27-040 I'll be out with one at the Ross at 3123",
  );
  assert.deepEqual(got, { business: "Ross", accountCode: "3123" });
});

test("parseBusinessAtAccountPhrase handles dashed account codes", () => {
  const got = parseBusinessAtAccountPhrase("out with one at the target at 32-08");
  assert.equal(got?.accountCode, "32-08");
  assert.match(got?.business ?? "", /target/i);
});

test("spokenPlaceConflictsWithProperty flags Ross vs Riverview West", () => {
  assert.equal(spokenPlaceConflictsWithProperty("Ross", "Riverview West"), true);
  assert.equal(spokenPlaceConflictsWithProperty("Riverview", "Riverview West"), false);
});

test("inferSpokenBusiness prefers transcript business over SSA property name", () => {
  const biz = inferSpokenBusiness(
    parseResult({ location_code: "3123", location_name: "Riverview West" }),
    "27-040 out with one at the Ross at 3123",
    { name: "Riverview West", street: "1 Main", city: "Orange", state: "CA", zip: "92867", locnotes: "" },
  );
  assert.equal(biz, "Ross");
});

test("buildAccountLocnotes keeps account number and property name with extra hint", () => {
  assert.equal(
    buildAccountLocnotes("32-08", { name: "Anaheim Plaza", street: "", city: "", state: "CA", zip: "", locnotes: "" }, "Ross"),
    "3208 Anaheim Plaza — Ross",
  );
});
