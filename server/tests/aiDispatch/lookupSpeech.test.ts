import { test } from "node:test";
import assert from "node:assert/strict";

import {
  callsignPrefixForRadio,
  plateLookupFailureLine,
  vinLookupFailureLine,
  webSearchFailureLine,
  webSearchNotConfiguredLine,
} from "../../src/aiDispatch/lookupSpeech.js";

test("callsignPrefixForRadio shortens patrol units", () => {
  assert.equal(callsignPrefixForRadio("27-352"), "352, ");
  assert.equal(callsignPrefixForRadio("27-030"), "27-030, ");
});

test("plateLookupFailureLine: no record and system down", () => {
  assert.match(
    plateLookupFailureLine("205, ", { reason: "no_record" }),
    /no return comes back to that license plate/i,
  );
  assert.match(
    plateLookupFailureLine("205, ", { reason: "network_error" }),
    /license plate system is down/i,
  );
});

test("vinLookupFailureLine: invalid vin vs system down", () => {
  assert.match(vinLookupFailureLine("205, ", { reason: "invalid_vin" }), /10-9/i);
  assert.match(vinLookupFailureLine("205, ", { reason: "api_error" }), /license plate system is down/i);
});

test("webSearchFailureLine maps timeout and not configured", () => {
  assert.match(
    webSearchNotConfiguredLine("352, "),
    /can't search that information/i,
  );
  assert.match(
    webSearchFailureLine("352, ", { ok: false, reason: "timeout" }),
    /internet is not working right now/i,
  );
  assert.match(
    webSearchFailureLine("352, ", { ok: false, reason: "not_found" }),
    /can't find that information/i,
  );
});
