/**
 * Tests the provider-detection edge cases of
 * `getAiDispatchPlatformConfig()` in `server/src/aiDispatch/platformConfig.ts`.
 *
 * The resolver in the module reads:
 *
 *   const providerRaw = process.env.AI_DISPATCH_LLM_PROVIDER?.trim().toLowerCase();
 *   const llmProvider =
 *     providerRaw === "openai"            ? "openai"
 *     : providerRaw === "anthropic" || !providerRaw ? "anthropic"
 *     : llmApiKey.startsWith("sk-ant-")   ? "anthropic"
 *                                         : "openai";
 *
 * That key-prefix fallback path is what protects an operator who set
 * `AI_DISPATCH_LLM_PROVIDER` to an unknown string by mistake — the
 * resolver still routes the request to the right provider as long as
 * the API key prefix gives it away. Without this safety net, a typo in
 * the provider env (e.g. "claude" or "anthropic-eu") would silently
 * route traffic to whichever branch the default landed in, hitting the
 * wrong API with the wrong auth shape and dead-on-arrival.
 *
 * Anthropic keys are shaped `sk-ant-...` (the official "Anthropic key"
 * prefix). OpenAI keys are `sk-...` without the `ant-`. The
 * key-prefix heuristic relies on that exact substring.
 *
 * Each `*.test.ts` runs in its own subprocess under `node --test`, so
 * the module-private cache is fresh per file. This file pins the
 * key-prefix heuristic with an unknown provider env value AND an
 * Anthropic-shaped key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Unknown / typo'd provider env + Anthropic-shaped key → must fall back
// to "anthropic" via the key-prefix heuristic.
process.env.AI_DISPATCH_LLM_PROVIDER = "anthropic-eu"; // not in the {openai, anthropic} set
process.env.AI_DISPATCH_LLM_API_KEY = "sk-ant-abc123notreal";
// Leave model unset so we also exercise the "anthropic → default model"
// fallback once the provider lands on anthropic.
delete process.env.AI_DISPATCH_LLM_MODEL;

const { getAiDispatchPlatformConfig } = await import(
  "../../../src/aiDispatch/platformConfig.js"
);

test("provider detect: unknown providerRaw + sk-ant- key resolves to 'anthropic' (key-prefix fallback)", () => {
  // A typo in AI_DISPATCH_LLM_PROVIDER must NOT silently route to the
  // wrong provider. The resolver's fallback heuristic catches this by
  // sniffing the key prefix.
  assert.equal(getAiDispatchPlatformConfig().llmProvider, "anthropic");
});

test("provider detect: when the resolver lands on anthropic, llmModel defaults to the Anthropic model id", () => {
  // The default-model fallback fires when AI_DISPATCH_LLM_MODEL is
  // unset. Pin that the provider-driven default is wired to the
  // documented Anthropic model id — a regression that branched the
  // default the wrong way would send every request to the wrong
  // model name and 404 at the provider.
  assert.equal(getAiDispatchPlatformConfig().llmModel, "claude-sonnet-4-6");
});
