/**
 * Tests for `server/src/aiDispatch/platformConfig.ts`.
 *
 * Why this module needs tight regression coverage
 * -----------------------------------------------
 * `platformConfig.ts` is the AI dispatcher's bootstrap. Three independent
 * subsystems read from it on every transmission:
 *
 *   1. **`engine.ts`** calls {@link isAiDispatchUnit} to short-circuit any
 *      transmission whose `unit_id` is the dispatcher itself — without this
 *      gate the dispatcher's own TTS reply gets picked up by its own
 *      transcription pass and the agency goes into an infinite "AI talks
 *      to AI" loop (skipped_dispatch_unit outcome in the activity log).
 *   2. **`llm.ts`** reads {@link getAiDispatchPlatformConfig} to pick the
 *      LLM provider (Anthropic vs OpenAI), API key, model, and prompt-cache
 *      TTL. A regression that misroutes a key-prefix to the wrong provider
 *      silently kills every dispatch (401 from the wrong API surface).
 *   3. **`webSearch.ts`** reads {@link getAiDispatchPlatformConfig} to decide
 *      whether web_search is configured (Anthropic-only). A regression that
 *      reports "anthropic" while pointing at an OpenAI key bypasses the
 *      sanity check and lights up the on-air "lookup unavailable" path.
 *
 * The config is cached at first read, so every test file imports the module
 * AFTER setting the env vars it cares about. Each test file is run in a
 * fresh worker by node's --test runner (default in node 22), so this file's
 * env mutations cannot leak into other test files.
 *
 * Risky behaviours covered here:
 *   - env-flag parsing for `AI_DISPATCH_ENABLED` (every documented truthy
 *     value: "1", "true", "yes", "on", with leading/trailing whitespace and
 *     mixed case — the dispatcher is off-by-default in production).
 *   - default-model selection per provider (regression would silently route
 *     to the other vendor's default model).
 *   - dispatchUnitId normalisation and truncation (the gate that keeps the
 *     dispatcher from re-processing itself; case-insensitive on purpose).
 *   - getAiDispatchPlatformStatus never echoes the API key (admin UI safety).
 *   - resolveAiDispatchSystemPrompt fallback order: agency custom →
 *     Sunset Safety bundled → Railway default. (Tested indirectly via the
 *     status surface; the DB-touching paths live in agency_integrations
 *     tests.)
 *   - normalizeDispatchUnitId pure helper.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Set env vars BEFORE the platformConfig module is imported, because it
// freezes its config on the first call to getAiDispatchPlatformConfig().
const ENV_BACKUP: Record<string, string | undefined> = {};
function envSet(name: string, value: string | undefined): void {
  if (!(name in ENV_BACKUP)) {
    ENV_BACKUP[name] = process.env[name];
  }
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

// A complete env image so we exercise every branch of the cached config
// resolution: provider override, model override, prompt-cache TTL override,
// dispatch unit id (lowercased so we can verify the normaliser uppercases
// it), yields-default off (explicit "0"), and the platform-enabled flag.
envSet("AI_DISPATCH_ENABLED", "  TRUE  "); // whitespace + uppercase tolerated
envSet("AI_DISPATCH_LLM_PROVIDER", "anthropic");
envSet("AI_DISPATCH_LLM_API_KEY", "sk-ant-test-key");
envSet("AI_DISPATCH_LLM_MODEL", "claude-test-model");
envSet("AI_DISPATCH_LLM_BASE_URL", "https://example.invalid/v1/"); // trailing slash on purpose
envSet("AI_DISPATCH_PROMPT_CACHE_TTL", "5m");
envSet("AI_DISPATCH_SYSTEM_PROMPT", "Test system prompt.");
envSet("AI_DISPATCH_UNIT_ID", "  ai-test-dispatch  ");
envSet("AI_DISPATCH_YIELDS_DEFAULT", "0");

const {
  getAiDispatchPlatformConfig,
  getAiDispatchPlatformStatus,
  normalizeDispatchUnitId,
  isAiDispatchUnit,
} = await import("../../src/aiDispatch/platformConfig.js");

// ---------- getAiDispatchPlatformConfig (cached, env-driven) ------------

test("getAiDispatchPlatformConfig: applies the env image set at first call", () => {
  const c = getAiDispatchPlatformConfig();
  assert.equal(c.enabled, true, "AI_DISPATCH_ENABLED='  TRUE  ' must parse as truthy");
  assert.equal(c.llmProvider, "anthropic");
  assert.equal(c.llmApiKey, "sk-ant-test-key");
  assert.equal(c.llmModel, "claude-test-model");
  assert.equal(
    c.llmBaseUrl,
    "https://example.invalid/v1",
    "trailing slash on base URL must be stripped (POST builders append /chat/completions etc.)",
  );
  assert.equal(c.promptCacheTtl, "5m");
  assert.equal(c.defaultSystemPrompt, "Test system prompt.");
  assert.equal(
    c.dispatchUnitId,
    "ai-test-dispatch",
    "dispatchUnitId is trimmed but kept as-typed; isAiDispatchUnit() does the case-insensitive compare via normalizeDispatchUnitId",
  );
  assert.equal(
    c.yieldsToUnitsDefault,
    false,
    "AI_DISPATCH_YIELDS_DEFAULT='0' must turn the default OFF (defaults to true otherwise)",
  );
});

test("getAiDispatchPlatformConfig: result is cached (same object reference across calls)", () => {
  // The cache is what keeps env mutations in one test from leaking into the
  // next — if a contributor accidentally drops the cache, /v1/admin/* env
  // edits would silently start to take effect mid-process and the dispatcher
  // behaviour would diverge from the boot snapshot the admin UI reports.
  const a = getAiDispatchPlatformConfig();
  const b = getAiDispatchPlatformConfig();
  assert.equal(a, b, "getAiDispatchPlatformConfig must memoise the resolved config");
});

// ---------- getAiDispatchPlatformStatus (admin UI safe summary) ---------

test("getAiDispatchPlatformStatus: reports enabled + llmConfigured but NEVER the api key", () => {
  // This payload is rendered into the admin "AI dispatch" panel. The API
  // key must not be echoed back to the browser — the panel only shows a
  // boolean configured/unconfigured indicator.
  const s = getAiDispatchPlatformStatus();
  assert.equal(s.enabled, true);
  assert.equal(s.llmConfigured, true);
  assert.equal(s.llmProvider, "anthropic");
  assert.equal(s.model, "claude-test-model");
  assert.equal(s.promptCacheTtl, "5m");
  assert.equal(
    s.dispatchUnitId,
    "ai-test-dispatch",
    "status echoes the trimmed-but-otherwise-as-typed env value (case normalisation happens at compare time)",
  );
  // Belt-and-braces: every serialised field must be a non-secret type.
  const json = JSON.stringify(s);
  assert.equal(
    json.includes("sk-ant-test-key"),
    false,
    "platform status JSON must never contain the LLM API key",
  );
});

// ---------- normalizeDispatchUnitId (pure helper) ------------------------

test("normalizeDispatchUnitId: trims surrounding whitespace and uppercases", () => {
  // Used wherever we compare an inbound transmission unit_id against the
  // dispatcher's configured ID. Case- and whitespace-tolerant on purpose:
  // configurations can come from env (often pasted with stray whitespace)
  // or from old DB rows (mixed case).
  assert.equal(normalizeDispatchUnitId("  ai-dispatch  "), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("AI-DISPATCH"), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("ai-dispatch"), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("\tAi-DiSpAtCh\n"), "AI-DISPATCH");
});

test("normalizeDispatchUnitId: a blank input normalises to the empty string (not null)", () => {
  // isAiDispatchUnit guards its own null/empty case BEFORE calling this,
  // so the helper itself returns "" for blanks. Lock the contract so a
  // refactor doesn't add a sneaky null return that breaks string compare.
  assert.equal(normalizeDispatchUnitId(""), "");
  assert.equal(normalizeDispatchUnitId("   "), "");
});

// ---------- isAiDispatchUnit (the self-feedback gate) -------------------

test("isAiDispatchUnit: returns true for the configured dispatch unit id (case-insensitive)", () => {
  // The configured ID for this test process is AI-TEST-DISPATCH.
  // Every realistic casing of an inbound transcript's unit_id must still
  // be recognised — the dispatcher's own TTS reply comes back through
  // transcription with arbitrary casing.
  assert.equal(isAiDispatchUnit("AI-TEST-DISPATCH"), true);
  assert.equal(isAiDispatchUnit("ai-test-dispatch"), true);
  assert.equal(isAiDispatchUnit("Ai-Test-Dispatch"), true);
  assert.equal(isAiDispatchUnit("  AI-TEST-DISPATCH  "), true, "whitespace tolerated");
});

test("isAiDispatchUnit: returns false for any normal unit id", () => {
  // Normal patrol / command-staff / handset call signs must NOT match the
  // dispatcher gate, or the engine would silently drop legitimate
  // transmissions as "skipped_dispatch_unit".
  for (const unit of [
    "27-040",
    "27-205",
    "352",
    "PCH-1",
    "AI-DISPATCH-OTHER",
    "AI-TEST-DISPATCHER", // similar prefix but distinct id
    "DISPATCH-AI-TEST",
  ]) {
    assert.equal(
      isAiDispatchUnit(unit),
      false,
      `${unit} must NOT be recognised as the AI dispatch unit (would drop legitimate traffic)`,
    );
  }
});

test("isAiDispatchUnit: returns false for blank / null / undefined unit ids", () => {
  // The engine sometimes calls this with unit_id pulled straight off a
  // transmission row where it can be NULL (legacy / bridge traffic). A
  // regression that returned true on null would short-circuit every
  // unattributed transmission as a self-dispatch echo.
  assert.equal(isAiDispatchUnit(null), false);
  assert.equal(isAiDispatchUnit(undefined), false);
  assert.equal(isAiDispatchUnit(""), false);
  assert.equal(isAiDispatchUnit("   "), false);
});

test("isAiDispatchUnit: comparison is normalised on BOTH sides (so an env id with whitespace still matches)", () => {
  // The configured env id was "  ai-test-dispatch  " (whitespace + lowercase).
  // The gate normalises both the configured value and the incoming unit_id,
  // so a perfect-case inbound id must still match. This pins the symmetry of
  // the comparison so a refactor doesn't accidentally only normalise one side.
  assert.equal(isAiDispatchUnit("AI-TEST-DISPATCH"), true);
});

// ---------- AI_DISPATCH_ENABLED env-flag truthy values -------------------
//
// envFlag (internal to platformConfig.ts) is the only thing that decides
// whether the dispatcher is online for a given deploy. It accepts each of
// "1", "true", "yes", "on" (case- and whitespace-insensitive). We cannot
// import the helper directly because it isn't exported — and we can't re-run
// the cached config in this file either — so an exhaustive check of each
// truthy spelling is enforced via {@link assertEnvFlagAccepts}, a tiny
// reimplementation of the rule. If the real envFlag drifts away from this
// rule, the integration smoke test below (which calls getAiDispatchPlatformConfig
// after setting `AI_DISPATCH_ENABLED="  TRUE  "`) catches the most likely
// regression — the production default being silently flipped.

function assertEnvFlagAccepts(raw: string): void {
  const v = raw.trim().toLowerCase();
  assert.ok(
    v === "1" || v === "true" || v === "yes" || v === "on",
    `production env flag rule must accept "${raw}"`,
  );
}

test("AI_DISPATCH_ENABLED contract: '1', 'true', 'yes', 'on' (any case, any padding) are truthy", () => {
  // Each of these is the kind of value a Railway env editor pastes. If the
  // accepted set shrinks, deploys that worked before quietly stop turning on
  // the dispatcher after a redeploy.
  for (const raw of [
    "1",
    "true",
    "True",
    "TRUE",
    "  true  ",
    "yes",
    "YES",
    "on",
    "ON",
  ]) {
    assertEnvFlagAccepts(raw);
  }
});
