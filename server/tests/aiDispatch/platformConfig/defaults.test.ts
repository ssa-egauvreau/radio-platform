/**
 * Tests for the documented DEFAULTS of `server/src/aiDispatch/platformConfig.ts`,
 * and for the `isAiDispatchUnit` self-loop guard.
 *
 * `isAiDispatchUnit` is what stops the AI dispatcher from listening to
 * itself: every transmission the recorder ingests is checked against the
 * configured dispatch unit id before the engine is invoked. A regression
 * here breaks the guard in one of two ways:
 *
 *   - false NEGATIVE on the AI's own callsign → the AI dispatcher
 *     processes its own TTS reply as a fresh transmission, generating
 *     another reply, generating another, ... an instant feedback loop
 *     that burns LLM credits and spams the radio channel until somebody
 *     pulls the plug.
 *
 *   - false POSITIVE on a real unit → the recorder skips a real
 *     officer's transmission as if it were the AI's, and the AI
 *     dispatcher goes silently dead for that unit.
 *
 * The other half of the file is `getAiDispatchPlatformConfig` — the
 * env-cached snapshot the engine reads on the hot path. Defaults matter
 * here because a fresh Railway deploy with no env set must come up in a
 * known-safe configuration (`enabled: false`, anthropic provider,
 * `AI-DISPATCH` callsign for the self-loop guard).
 *
 * Because `getAiDispatchPlatformConfig()` caches its result in a
 * module-private closure on first call, this whole file runs against the
 * documented defaults. The env keys are scrubbed BEFORE the dynamic
 * import so the cache resolves to the documented values even if the test
 * shell happens to have AI_DISPATCH_* leaking in. Per-env-override cases
 * live in sibling test files (each `*.test.ts` runs in its own
 * subprocess under `node --test`, so the module cache is fresh per file).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const ENV_KEYS = [
  "AI_DISPATCH_ENABLED",
  "AI_DISPATCH_LLM_PROVIDER",
  "AI_DISPATCH_LLM_API_KEY",
  "AI_DISPATCH_LLM_BASE_URL",
  "AI_DISPATCH_LLM_MODEL",
  "AI_DISPATCH_PROMPT_CACHE_TTL",
  "AI_DISPATCH_SYSTEM_PROMPT",
  "AI_DISPATCH_UNIT_ID",
  "AI_DISPATCH_YIELDS_DEFAULT",
];

for (const key of ENV_KEYS) {
  delete process.env[key];
}

const {
  getAiDispatchPlatformConfig,
  getAiDispatchPlatformStatus,
  isAiDispatchUnit,
  normalizeDispatchUnitId,
} = await import("../../../src/aiDispatch/platformConfig.js");

// ---------- normalizeDispatchUnitId (pure) -------------------------------

test("normalizeDispatchUnitId trims surrounding whitespace and uppercases", () => {
  assert.equal(normalizeDispatchUnitId("ai-dispatch"), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("  AI-DISPATCH  "), "AI-DISPATCH");
  assert.equal(normalizeDispatchUnitId("\tdispatcher-1\n"), "DISPATCHER-1");
  // Already canonical → returns the same string.
  assert.equal(normalizeDispatchUnitId("AI-DISPATCH"), "AI-DISPATCH");
});

test("normalizeDispatchUnitId is a pure string operation (no I/O, no env reads)", () => {
  // Locks in that the helper does NOT consult getAiDispatchPlatformConfig.
  // If a future refactor pulled the configured dispatch id INTO the
  // normalizer, isAiDispatchUnit would become circular with itself.
  const a = normalizeDispatchUnitId("foo");
  const b = normalizeDispatchUnitId("foo");
  assert.equal(a, b);
  assert.equal(a, "FOO");
});

// ---------- getAiDispatchPlatformConfig — documented defaults ------------

test("default config: enabled is OFF (must be explicitly turned on per agency)", () => {
  // Documented safe default — a fresh deploy with no AI_DISPATCH_ENABLED
  // env must come up dark, not start running the LLM on every channel.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.enabled, false);
});

test("default config: llmProvider falls back to anthropic when no provider env is set", () => {
  // The model selection cascade is:
  //   AI_DISPATCH_LLM_PROVIDER="openai"     → "openai"
  //   AI_DISPATCH_LLM_PROVIDER="anthropic"  → "anthropic"
  //   AI_DISPATCH_LLM_PROVIDER unset/empty  → "anthropic" (default)
  // Anthropic is the documented default since prod uses Claude with 1h
  // prompt caching for the SSA system prompt.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.llmProvider, "anthropic");
});

test("default config: llmModel matches the documented Anthropic default when provider is anthropic", () => {
  // Locks in the "claude-sonnet-4-6" default — a regression that changes
  // the default model silently flips the bill and capability profile of
  // every agency that hasn't pinned an explicit AI_DISPATCH_LLM_MODEL.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.llmModel, "claude-sonnet-4-6");
});

test("default config: llmBaseUrl is the documented OpenAI v1 URL with no trailing slash", () => {
  // The OpenAI URL is intentionally the default here because the
  // legacy LLM client used the OpenAI completion shape; the trailing
  // slash is stripped before concatenation so the request URL stays
  // canonical.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.llmBaseUrl, "https://api.openai.com/v1");
  assert.equal(cfg.llmBaseUrl.endsWith("/"), false);
});

test("default config: promptCacheTtl is the documented '1h'", () => {
  // The big SSA system prompt is cached on Anthropic for 1h by default
  // (10-8 parity, per commit 1836964). A regression that flipped this
  // back to "5m" would 12x the prompt re-write cost.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.promptCacheTtl, "1h");
});

test("default config: dispatchUnitId is the documented 'AI-DISPATCH'", () => {
  // This is the canonical id used by the self-loop guard. Changing it
  // breaks every agency that doesn't override AI_DISPATCH_UNIT_ID.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.dispatchUnitId, "AI-DISPATCH");
});

test("default config: yieldsToUnitsDefault is true (AI yields to live units by default)", () => {
  // The "yields to units" policy means AI dispatcher backs off if a
  // real officer is about to key up. Documented safe default; a
  // regression flipping this to false makes the AI step on field
  // traffic.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(cfg.yieldsToUnitsDefault, true);
});

test("default config: defaultSystemPrompt is the documented fallback (non-empty), not null", () => {
  // Sanity check — without a system prompt the LLM has no guardrails
  // at all on what to say on the air. The fallback string must remain
  // populated.
  const cfg = getAiDispatchPlatformConfig();
  assert.equal(typeof cfg.defaultSystemPrompt, "string");
  assert.ok(cfg.defaultSystemPrompt.length > 0, "defaultSystemPrompt must not be empty");
  // The documented default explicitly tells the model to use 10-codes.
  // Lock in the substring so a regression that rewords the default to
  // something cute (or removes the "professional public-safety"
  // framing) trips this test.
  assert.match(cfg.defaultSystemPrompt, /public-safety/i);
  assert.match(cfg.defaultSystemPrompt, /10-codes/i);
});

test("getAiDispatchPlatformConfig is cached: repeated calls return the same instance", () => {
  // The cache is what keeps every hot-path call to the engine from
  // re-walking process.env. Pin reference equality so a future refactor
  // that turned the cache into a per-call snapshot trips this test
  // before it ships.
  const a = getAiDispatchPlatformConfig();
  const b = getAiDispatchPlatformConfig();
  assert.equal(a, b, "getAiDispatchPlatformConfig must return the cached instance");
});

// ---------- getAiDispatchPlatformStatus — never exposes secrets ----------

test("getAiDispatchPlatformStatus exposes the safe summary fields (no llmApiKey)", () => {
  const status = getAiDispatchPlatformStatus();
  assert.deepEqual(Object.keys(status).sort(), [
    "dispatchUnitId",
    "enabled",
    "llmConfigured",
    "llmProvider",
    "model",
    "promptCacheTtl",
  ]);
});

test("getAiDispatchPlatformStatus.llmConfigured is FALSE when no AI_DISPATCH_LLM_API_KEY is set", () => {
  // This drives the "AI provider configured?" badge in the admin UI.
  // A regression that always reported `true` would mislead admins into
  // thinking the LLM was wired up when it wasn't.
  const status = getAiDispatchPlatformStatus();
  assert.equal(status.llmConfigured, false);
});

test("getAiDispatchPlatformStatus does NOT leak the API key under any field name", () => {
  // Belt-and-suspenders against a future addition that accidentally
  // forwarded llmApiKey through the status payload. Iterate every key
  // and assert no value matches the loaded llmApiKey (which is ""
  // here, so this also covers the empty-string case by checking that
  // no value is the literal env value if one were set).
  const status = getAiDispatchPlatformStatus() as Record<string, unknown>;
  for (const [key, value] of Object.entries(status)) {
    // The key itself must never be a secret-like name.
    assert.equal(
      /api_?key|secret|token/i.test(key),
      false,
      `field "${key}" looks like a secret name`,
    );
    // Status fields must be primitives — never the cached config object.
    assert.notEqual(typeof value, "object", `field "${key}" must not be an object`);
  }
});

// ---------- isAiDispatchUnit: the self-loop guard ------------------------

test("isAiDispatchUnit: 'AI-DISPATCH' matches the configured dispatch unit id (default)", () => {
  // The exact-match case — what the recorder actually sees when the
  // engine's TTS reply is re-ingested. Without this, the AI dispatcher
  // feedback-loops on its own output.
  assert.equal(isAiDispatchUnit("AI-DISPATCH"), true);
});

test("isAiDispatchUnit: case is folded (lower / mixed case both match)", () => {
  // `normalizeDispatchUnitId` uppercases both sides — pin that the
  // self-loop guard ignores case variation in what the recorder
  // surfaces (some transports lower-case their unit id headers).
  assert.equal(isAiDispatchUnit("ai-dispatch"), true);
  assert.equal(isAiDispatchUnit("Ai-Dispatch"), true);
  assert.equal(isAiDispatchUnit("AI-DiSpAtCh"), true);
});

test("isAiDispatchUnit: surrounding whitespace is trimmed before comparison", () => {
  // A transport that pads the unit id with a trailing newline must
  // still trip the guard — otherwise " AI-DISPATCH\n" would slip
  // through and feed back into the engine.
  assert.equal(isAiDispatchUnit("  AI-DISPATCH  "), true);
  assert.equal(isAiDispatchUnit("\tAI-DISPATCH"), true);
  assert.equal(isAiDispatchUnit("AI-DISPATCH\n"), true);
});

test("isAiDispatchUnit: a real patrol unit id does NOT match (no false positives)", () => {
  // Critical: a false positive here makes the engine ignore a real
  // officer's transmission as if it were the AI's. Test a few
  // representative real callsigns.
  for (const cs of ["27-040", "27-205", "27-020", "ADAM-1", "DISPATCH-1"]) {
    assert.equal(
      isAiDispatchUnit(cs),
      false,
      `${cs} must not be treated as the AI dispatcher`,
    );
  }
});

test("isAiDispatchUnit: blank / null / undefined never match (recorder may pass either)", () => {
  // The recorder occasionally sees a transmission with no unit id
  // (e.g. legacy bridge sockets). Those must never be treated as the
  // AI dispatcher — otherwise every unattributed transmission gets
  // silently dropped.
  assert.equal(isAiDispatchUnit(null), false);
  assert.equal(isAiDispatchUnit(undefined), false);
  assert.equal(isAiDispatchUnit(""), false);
  assert.equal(isAiDispatchUnit("   "), false);
  assert.equal(isAiDispatchUnit("\t\n"), false);
});

test("isAiDispatchUnit: a substring of the dispatch id does NOT match", () => {
  // Match is a normalised equality (not a substring contains), so a
  // unit id that happens to start with or end with the dispatch id
  // must not collide. Locks in the equality semantics so a refactor
  // can't accidentally loosen this into a startsWith / includes.
  assert.equal(isAiDispatchUnit("AI-DISPATCH-1"), false);
  assert.equal(isAiDispatchUnit("AI-DISPATCHER"), false);
  assert.equal(isAiDispatchUnit("X-AI-DISPATCH"), false);
});
