import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMERGENCY_CHANNEL_NAME_SQL_REGEX,
  isEmergencyChannelName,
} from "../src/emergencyChannels.js";

test("isEmergencyChannelName: accepts canonical emergency prefixes", () => {
  assert.equal(isEmergencyChannelName("EMERGENCY 12:30"), true);
  assert.equal(isEmergencyChannelName(" emergency"), true);
  assert.equal(isEmergencyChannelName("Emergency-Alpha"), true);
});

test("isEmergencyChannelName: rejects lookalikes and non-prefix names", () => {
  assert.equal(isEmergencyChannelName("EMERGENCYOPS"), false);
  assert.equal(isEmergencyChannelName("Operations EMERGENCY"), false);
  assert.equal(isEmergencyChannelName("green-1"), false);
});

test("EMERGENCY_CHANNEL_NAME_SQL_REGEX: stays aligned with API delete guard", () => {
  assert.equal(EMERGENCY_CHANNEL_NAME_SQL_REGEX, "^emergency(\\y|$)");
});
