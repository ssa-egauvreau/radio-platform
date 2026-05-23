/**
 * Tests for dry-run send-for-real write gating.
 *
 * The AI test endpoint can preview parsing when AI dispatch is disabled, but it
 * must never write real 10-8 side-effects unless both the platform and channel
 * gates are enabled.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveDryRunWritePolicy } from "../../src/aiDispatch/dryRun.js";

test("does not allow writes when send-for-real was not requested", () => {
  const policy = resolveDryRunWritePolicy({
    requestedSendForReal: false,
    platformEnabled: true,
    channelAiDispatchEnabled: true,
  });
  assert.equal(policy.allowWrites, false);
  assert.deepEqual(policy.blockedReasons, []);
});

test("allows writes only when both platform and channel are enabled", () => {
  const policy = resolveDryRunWritePolicy({
    requestedSendForReal: true,
    platformEnabled: true,
    channelAiDispatchEnabled: true,
  });
  assert.equal(policy.allowWrites, true);
  assert.deepEqual(policy.blockedReasons, []);
});

test("blocks writes when the platform kill switch is off", () => {
  const policy = resolveDryRunWritePolicy({
    requestedSendForReal: true,
    platformEnabled: false,
    channelAiDispatchEnabled: true,
  });
  assert.equal(policy.allowWrites, false);
  assert.deepEqual(policy.blockedReasons, [
    "SEND FOR REAL blocked: AI dispatch platform is OFF (AI_DISPATCH_ENABLED).",
  ]);
});

test("blocks writes when channel AI dispatch is disabled", () => {
  const policy = resolveDryRunWritePolicy({
    requestedSendForReal: true,
    platformEnabled: true,
    channelAiDispatchEnabled: false,
  });
  assert.equal(policy.allowWrites, false);
  assert.deepEqual(policy.blockedReasons, [
    "SEND FOR REAL blocked: AI dispatch is OFF for this channel.",
  ]);
});

test("reports both blockers when platform and channel are disabled", () => {
  const policy = resolveDryRunWritePolicy({
    requestedSendForReal: true,
    platformEnabled: false,
    channelAiDispatchEnabled: false,
  });
  assert.equal(policy.allowWrites, false);
  assert.deepEqual(policy.blockedReasons, [
    "SEND FOR REAL blocked: AI dispatch platform is OFF (AI_DISPATCH_ENABLED).",
    "SEND FOR REAL blocked: AI dispatch is OFF for this channel.",
  ]);
});
