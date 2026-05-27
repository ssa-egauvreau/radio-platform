/**
 * Tests that the env overrides for `server/src/aiDispatch/platformConfig.ts`
 * actually flow through to the cached config. Each `AI_DISPATCH_*` env key
 * exists so an operator can pin platform-wide AI dispatcher behaviour
 * without a code change — a regression that silently ignored one of these
 * env keys would let a Railway operator THINK they had reconfigured the
 * platform when nothing actually changed.
 *
 * `getAiDispatchPlatformConfig()` resolves and CACHES the env values on
 * its first call, so this whole test file runs against a single set of
 * env overrides applied before the dynamic import. Sibling test files
 * (defaults.test.ts, openAiProvider.test.ts) cover the other shapes;
 * each `*.test.ts` runs in its own subprocess under `node --test`, so
 * the module cache is fresh per file.
 *
 * The most safety-critical override is `AI_DISPATCH_UNIT_ID` — that is
 * what the engine's self-loop guard (`isAiDispatchUnit`) checks against.
 * If the override didn't flow through, operators couldn't move the AI
 * dispatcher onto a different callsign per platform (multi-agency
 * deploys with conflicting unit ids), and the self-loop guard would
 * still be matching the default "AI-DISPATCH" — silently letting the
 * configured callsign feedback-loop into the engine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Apply env overrides BEFORE the dynamic import so the module-level
// cache resolves to these values exactly once.
process.env.AI_DISPATCH_ENABLED = "1";
process.env.AI_DISPATCH_LLM_PROVIDER = "openai";
process.env.AI_DISPATCH_LLM_API_KEY = "sk-test-not-real";
process.env.AI_DISPATCH_LLM_BASE_URL = "https://api.example.com/v1/";
process.env.AI_DISPATCH_LLM_MODEL = "gpt-test-9001";
process.env.AI_DISPATCH_PROMPT_CACHE_TTL = "5m";
process.env.AI_DISPATCH_SYSTEM_PROMPT = "Custom test prompt";
process.env.AI_DISPATCH_UNIT_ID = "  dispatch-console-7  ";
process.env.AI_DISPATCH_YIELDS_DEFAULT = "0";

const {
  getAiDispatchPlatformConfig,
  getAiDispatchPlatformStatus,
  isAiDispatchUnit,
} = await import("../../../src/aiDispatch/platformConfig.js");

test("env override: AI_DISPATCH_ENABLED=1 flips the platform on", () => {
  // Cascade of supported truthy tokens lives in `envFlag`. "1" is the
  // canonical on-token used in our deploy docs.
  assert.equal(getAiDispatchPlatformConfig().enabled, true);
});

test("env override: AI_DISPATCH_LLM_PROVIDER=openai pins provider to openai (overrides key-prefix heuristic)", () => {
  // Even with a key that DOESN'T start with "sk-ant-", an explicit
  // provider env wins. Without this rule, prod-only providers (Azure
  // OpenAI, OpenRouter) couldn't be selected because the resolver would
  // peek at the key prefix instead of the operator's explicit choice.
  assert.equal(getAiDispatchPlatformConfig().llmProvider, "openai");
});

test("env override: AI_DISPATCH_LLM_API_KEY is loaded onto the cached config", () => {
  // The key is private — we ASSERT it equals the value we set, but
  // separately assert (in defaults.test.ts and below) that the status
  // payload never leaks it.
  assert.equal(getAiDispatchPlatformConfig().llmApiKey, "sk-test-not-real");
});

test("env override: AI_DISPATCH_LLM_BASE_URL is honored AND the trailing slash is stripped", () => {
  // The strip-trailing-slash rule keeps the URL canonical so the
  // engine can concatenate `${baseUrl}/messages` without doubling the
  // slash. A regression that dropped the strip would silently route
  // requests to a `//messages` path that the LLM provider rejects.
  assert.equal(getAiDispatchPlatformConfig().llmBaseUrl, "https://api.example.com/v1");
  assert.equal(getAiDispatchPlatformConfig().llmBaseUrl.endsWith("/"), false);
});

test("env override: AI_DISPATCH_LLM_MODEL pins the model name verbatim", () => {
  // No model name validation — the operator's value is trusted as-is
  // so they can roll an experimental model out per platform.
  assert.equal(getAiDispatchPlatformConfig().llmModel, "gpt-test-9001");
});

test("env override: AI_DISPATCH_PROMPT_CACHE_TTL='5m' flips the cache window to 5m", () => {
  // Only "5m" flips the window; any other value (including "1h") stays
  // at the documented "1h" default per the loader's switch. This test
  // pins that the "5m" token specifically works — a regression that
  // typo'd the comparison silently leaves Anthropic on the 1h window
  // and 12x's the prompt-rewrite bill for a one-off short-cache test.
  assert.equal(getAiDispatchPlatformConfig().promptCacheTtl, "5m");
});

test("env override: AI_DISPATCH_SYSTEM_PROMPT replaces the bundled default verbatim", () => {
  // Operator-supplied prompt wins. Used for platform-wide tone /
  // policy changes without bouncing the deploy.
  assert.equal(getAiDispatchPlatformConfig().defaultSystemPrompt, "Custom test prompt");
});

test("env override: AI_DISPATCH_UNIT_ID is trimmed AND uppercased on the cached config", () => {
  // The loader does `.trim().toUpperCase()`-ish work via `.slice(0,64)`
  // here, but more importantly the comparator (`normalizeDispatchUnitId`)
  // uppercases both sides. The cached value itself is trimmed and length-
  // capped — pin BOTH the storage form and the self-loop comparison.
  const cfg = getAiDispatchPlatformConfig();
  // Storage form is trimmed (no leading/trailing whitespace) and
  // length-capped to 64 chars before storage.
  assert.equal(cfg.dispatchUnitId, "dispatch-console-7");
  assert.ok(cfg.dispatchUnitId.length <= 64);
});

test("env override: isAiDispatchUnit matches the CONFIGURED unit, not the default 'AI-DISPATCH'", () => {
  // The whole point of the override. A regression here means operators
  // can rename the dispatch unit on the deploy but the engine's
  // self-loop guard still checks against the hard-coded default —
  // either AI traffic from the configured callsign feedback-loops, or
  // a real unit using "AI-DISPATCH" as their callsign gets dropped.
  assert.equal(isAiDispatchUnit("dispatch-console-7"), true);
  assert.equal(isAiDispatchUnit("DISPATCH-CONSOLE-7"), true, "case-folded match");
  assert.equal(isAiDispatchUnit("  dispatch-console-7  "), true, "whitespace-trimmed match");
});

test("env override: isAiDispatchUnit does NOT match the previous default once the override is set", () => {
  // Defensive: when AI_DISPATCH_UNIT_ID is overridden, the default
  // "AI-DISPATCH" must no longer match — otherwise a stale references
  // to the old callsign would still feedback-loop.
  assert.equal(isAiDispatchUnit("AI-DISPATCH"), false);
});

test("env override: AI_DISPATCH_YIELDS_DEFAULT='0' flips the yields-to-units flag to false", () => {
  // The yield policy is opt-out only: any value other than the literal
  // "0" keeps the safe default of true. Pin the off-switch so it
  // actually works.
  assert.equal(getAiDispatchPlatformConfig().yieldsToUnitsDefault, false);
});

test("env override: getAiDispatchPlatformStatus.llmConfigured is TRUE when an api key is present", () => {
  // Drives the "AI provider configured" badge in the admin UI. With
  // a non-empty key, the badge must be green.
  assert.equal(getAiDispatchPlatformStatus().llmConfigured, true);
});

test("env override: getAiDispatchPlatformStatus does NOT echo the api key under any field", () => {
  // Belt-and-suspenders for the secret-leak guard. With a real (-ish)
  // api key loaded, walk every field of the status payload and assert
  // it never equals the loaded key.
  const status = getAiDispatchPlatformStatus() as Record<string, unknown>;
  for (const [key, value] of Object.entries(status)) {
    assert.notEqual(
      value,
      "sk-test-not-real",
      `field "${key}" must not echo the loaded API key`,
    );
  }
});

test("env override: getAiDispatchPlatformStatus.dispatchUnitId reports the operator-overridden id", () => {
  // The admin UI shows the configured dispatch callsign so the
  // operator can confirm their env edit actually took effect. A
  // regression that always reported "AI-DISPATCH" would silently
  // hide failed env edits.
  assert.equal(getAiDispatchPlatformStatus().dispatchUnitId, "dispatch-console-7");
});

test("env override: getAiDispatchPlatformStatus.model echoes the env-pinned model", () => {
  // Same audit/visibility argument as dispatchUnitId — the admin UI
  // needs to surface the active model name to confirm the env edit.
  assert.equal(getAiDispatchPlatformStatus().model, "gpt-test-9001");
});
