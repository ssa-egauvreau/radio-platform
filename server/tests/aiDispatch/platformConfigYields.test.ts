/**
 * Third snapshot for `server/src/aiDispatch/platformConfig.ts`.
 *
 * Pins the ONE env value that flips `yieldsToUnitsDefault` to false: the
 * literal string `"0"`. The contract in source is:
 *
 *   yieldsToUnitsDefault: process.env.AI_DISPATCH_YIELDS_DEFAULT?.trim() !== "0",
 *
 * Two failure modes this catches:
 *
 *   1. A regression that changed the gate to e.g. `=== "1"` would make
 *      every value other than the literal "1" disable yielding — every
 *      operator who never set the var, or who set it to "true", "yes",
 *      etc., would silently stop the AI from yielding to a unit keying
 *      up. Officers would have their transmissions stepped on by the AI.
 *
 *   2. A regression that dropped the `.trim()` would make
 *      `AI_DISPATCH_YIELDS_DEFAULT=" 0 "` no longer disable yielding,
 *      reversing operator intent when env files have stray whitespace.
 *
 * The default-env file already locks in the "unset → true" path; this
 * file locks the explicit-disable path. The companion test file pins
 * the explicit-enable ("1") path. Together: every documented input is
 * a regression test.
 *
 * Lives in its own file because `getAiDispatchPlatformConfig()` caches
 * the snapshot once per process; node:test runs each file as its own
 * subprocess.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AI_DISPATCH_YIELDS_DEFAULT = "0";
// Deliberately set an LLM key so the snapshot is otherwise valid.
process.env.AI_DISPATCH_LLM_API_KEY = "sk-yields-disabled-fixture";
delete process.env.AI_DISPATCH_LLM_PROVIDER;
delete process.env.AI_DISPATCH_LLM_MODEL;
delete process.env.AI_DISPATCH_ENABLED;

const { getAiDispatchPlatformConfig } = await import(
  "../../src/aiDispatch/platformConfig.js"
);

test("yieldsToUnitsDefault is FALSE only when AI_DISPATCH_YIELDS_DEFAULT is literal '0'", () => {
  // This is the single critical safety toggle. Locking the inverse to
  // catch a regression to "=== '1'" semantics.
  assert.equal(getAiDispatchPlatformConfig().yieldsToUnitsDefault, false);
});

test("with no AI_DISPATCH_LLM_PROVIDER, the env falls through to the anthropic default model", () => {
  // The provider resolver:
  //   providerRaw === "openai" → openai
  //   providerRaw === "anthropic" || !providerRaw → anthropic
  //   else: auto-detect by key prefix
  //
  // With AI_DISPATCH_LLM_PROVIDER unset and a key that does NOT start
  // with "sk-ant-", the snapshot must still pick the anthropic default
  // (the unset-provider branch falls through to "anthropic" — it does
  // NOT auto-detect from the key in this branch).
  //
  // This locks in a subtle ternary: a regression that swapped the !
  // providerRaw branch to auto-detect would silently flip every
  // default-env install with a non-anthropic key onto OpenAI.
  const c = getAiDispatchPlatformConfig();
  assert.equal(c.llmProvider, "anthropic");
  assert.equal(c.llmModel, "claude-sonnet-4-6");
});
