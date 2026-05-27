/**
 * Sibling test file to providerDetect.test.ts — same scenario, but with
 * a non-Anthropic-shaped API key. With a typo'd provider env AND a
 * key that does NOT start with "sk-ant-", the resolver must fall
 * through to "openai". This is the other half of the key-prefix
 * heuristic — the one that prevents an OpenAI key from being routed
 * to Anthropic.
 *
 * The model fallback when provider lands on openai is "gpt-4o-mini"
 * per the documented default — pinned here so a refactor that
 * accidentally swapped the default model trips this test before it
 * ships.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.AI_DISPATCH_LLM_PROVIDER = "azure-openai"; // not in the {openai, anthropic} set
process.env.AI_DISPATCH_LLM_API_KEY = "sk-not-an-anthropic-key";
delete process.env.AI_DISPATCH_LLM_MODEL;

const { getAiDispatchPlatformConfig } = await import(
  "../../../src/aiDispatch/platformConfig.js"
);

test("provider detect: unknown providerRaw + non-Anthropic key resolves to 'openai'", () => {
  assert.equal(getAiDispatchPlatformConfig().llmProvider, "openai");
});

test("provider detect: when the resolver lands on openai, llmModel defaults to gpt-4o-mini", () => {
  // Documented OpenAI-side default. The two model defaults
  // ("claude-sonnet-4-6" vs "gpt-4o-mini") are the only place the
  // resolver branches on provider for a downstream value — locking
  // both branches separately keeps a refactor honest.
  assert.equal(getAiDispatchPlatformConfig().llmModel, "gpt-4o-mini");
});
