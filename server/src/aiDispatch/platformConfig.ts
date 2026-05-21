/**
 * Platform-wide AI dispatcher settings — set on Railway (or host env), not per agency.
 * Per-agency API keys (ElevenLabs, webhooks, future plate/VIN keys) live in agency_integrations.
 */

export interface AiDispatchPlatformConfig {
  enabled: boolean;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  defaultSystemPrompt: string;
  dispatchUnitId: string;
  yieldsToUnitsDefault: boolean;
}

function envFlag(name: string, defaultOn = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return defaultOn;
  }
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** Loaded once per process; env changes require restart. */
let cached: AiDispatchPlatformConfig | null = null;

export function getAiDispatchPlatformConfig(): AiDispatchPlatformConfig {
  if (cached) {
    return cached;
  }
  cached = {
    enabled: envFlag("AI_DISPATCH_ENABLED"),
    llmApiKey: process.env.AI_DISPATCH_LLM_API_KEY?.trim() ?? "",
    llmBaseUrl: (process.env.AI_DISPATCH_LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    ),
    llmModel: process.env.AI_DISPATCH_LLM_MODEL?.trim() || "gpt-4o-mini",
    defaultSystemPrompt:
      process.env.AI_DISPATCH_SYSTEM_PROMPT?.trim() ||
      "You are a professional public-safety radio dispatcher. Be brief, clear, and use standard 10-codes when appropriate.",
    dispatchUnitId: (process.env.AI_DISPATCH_UNIT_ID?.trim() || "AI-DISPATCH").slice(0, 64),
    yieldsToUnitsDefault: process.env.AI_DISPATCH_YIELDS_DEFAULT?.trim() !== "0",
  };
  return cached;
}

/** Safe summary for admin UI — never exposes secrets. */
export function getAiDispatchPlatformStatus(): {
  enabled: boolean;
  llmConfigured: boolean;
  model: string;
  dispatchUnitId: string;
} {
  const c = getAiDispatchPlatformConfig();
  return {
    enabled: c.enabled,
    llmConfigured: c.llmApiKey.length > 0,
    model: c.llmModel,
    dispatchUnitId: c.dispatchUnitId,
  };
}
