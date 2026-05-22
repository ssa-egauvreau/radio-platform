/**
 * Anthropic web_search tool for dispatcher info lookups (10-8-alert-dashboard webSearchAnswer).
 * Phone book / contacts / external addresses / legal codes / general questions all use this.
 */

import { getAiDispatchPlatformConfig } from "./platformConfig.js";

export type WebSearchKind = "phone" | "external_address" | "legal_code" | "general";

export type WebSearchRaw = Record<string, unknown>;

export interface WebSearchResult {
  ok: boolean;
  reason?: string;
  kind?: WebSearchKind;
  raw?: WebSearchRaw;
  source?: string | null;
  ms?: number;
  cached?: boolean;
  from_web?: boolean;
  status?: number;
  error?: string;
  timeout_ms?: number;
}

const WEB_LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEB_LOOKUP_TIMEOUT_MS = 20_000;

const cache = new Map<string, { result: WebSearchResult; at: number }>();

function normalizeWebQuery(q: string): string {
  return String(q || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function webSearchModel(): string {
  return process.env.AI_DISPATCH_WEB_SEARCH_MODEL?.trim() || "claude-sonnet-4-6";
}

function buildWebSearchPrompt(query: string, kind: WebSearchKind): string {
  const locationCtx =
    "We are dispatching for Sunset Safety Agency in Orange County, California — specifically Santa Ana, Orange, Tustin, Lake Forest. Bias toward businesses/agencies serving this area when relevant.";

  switch (kind) {
    case "phone":
      return `${locationCtx}

Find the current phone number for: "${query}"

Respond ONLY with JSON. No prose, no code fences. Use this shape:
If found: {"found": true, "name": "Official name", "phone": "714-555-1234", "address": "Address or null", "source": "URL"}
If not found: {"found": false, "reason": "Brief explanation"}

Only return found:true if HIGH CONFIDENCE the number is correct and current. Avoid placeholder/sales numbers.`;

    case "external_address":
      return `${locationCtx}

Find the street address for: "${query}"

This is for a radio dispatcher reading the address aloud over the radio to a field officer. Keep it short.

Use Google Maps style addressing: numbered street first, then city, then two-letter state and 5-digit ZIP when known.

Respond ONLY with JSON. No prose, no code fences. Use this shape:
If found: {"found": true, "name": "Official name", "street": "123 N Main St", "city": "Garden Grove", "state": "CA", "zip": "92840", "phone": "phone if commonly needed too, else null", "source": "URL"}
If not found: {"found": false, "reason": "Brief explanation"}

The combined address for CAD must read like: "123 N Main St, Garden Grove, CA 92840". Only return found:true if HIGH CONFIDENCE.`;

    case "legal_code":
      return `${locationCtx}

Look up this legal/vehicle/penal code reference for a field officer: "${query}"

The officer needs a quick radio answer. Provide the CODE SECTION NUMBER and a ONE-SENTENCE plain-English summary of what it covers. Do not quote the full statute — just the section number and a brief description.

Respond ONLY with JSON. No prose, no code fences. Use this shape:
If found: {"found": true, "code_section": "CVC 4000(a)(1)", "short_title": "Registration of Vehicles Required", "brief_summary": "Requires every vehicle to be currently registered with DMV before operation on public roads.", "source": "URL"}
If not found: {"found": false, "reason": "Brief explanation"}

Keep brief_summary to ONE clear sentence. The officer is on the radio — short, factual, no editorializing.`;

    case "general":
    default:
      return `${locationCtx}

Answer this radio dispatch question concisely: "${query}"

This is for a field officer on the radio. Give a ONE OR TWO sentence answer, factual and brief.

Respond ONLY with JSON. No prose, no code fences. Use this shape:
If you can answer confidently: {"found": true, "answer": "Brief one or two sentence answer", "source": "URL"}
If you can't answer: {"found": false, "reason": "Brief explanation"}`;
  }
}

function parseWebSearchJson(fullText: string): WebSearchRaw | null {
  const cleaned = fullText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as WebSearchRaw;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]!) as WebSearchRaw;
    } catch {
      return null;
    }
  }
}

export function isWebSearchConfigured(): boolean {
  const platform = getAiDispatchPlatformConfig();
  return platform.enabled && platform.llmProvider === "anthropic" && platform.llmApiKey.length > 0;
}

/** Web search via Anthropic Messages API + web_search tool (same as old 10-8 dispatcher). */
export async function webSearchAnswer(
  query: string,
  kind: WebSearchKind = "general",
): Promise<WebSearchResult> {
  if (!query?.trim()) {
    return { ok: false, reason: "no_query", kind };
  }

  const platform = getAiDispatchPlatformConfig();
  if (!platform.llmApiKey) {
    return { ok: false, reason: "no_api_key", kind };
  }
  if (platform.llmProvider !== "anthropic") {
    return { ok: false, reason: "anthropic_required", kind };
  }

  const cacheKey = `${kind}|${normalizeWebQuery(query)}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < WEB_LOOKUP_CACHE_TTL_MS) {
    return { ...cached.result, cached: true };
  }

  const startedAt = Date.now();
  const prompt = buildWebSearchPrompt(query.trim(), kind);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEB_LOOKUP_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": platform.llmApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: webSearchModel(),
        max_tokens: 1024,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 3,
            user_location: {
              type: "approximate",
              city: "Orange",
              region: "California",
              country: "US",
              timezone: "America/Los_Angeles",
            },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const result: WebSearchResult = {
        ok: false,
        reason: "api_error",
        status: res.status,
        kind,
        ms: Date.now() - startedAt,
      };
      console.warn(`[ai-dispatch] web_search ${res.status}: ${body.slice(0, 200)}`);
      cache.set(cacheKey, { result, at: Date.now() });
      return result;
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const fullText = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n")
      .trim();

    const parsed = parseWebSearchJson(fullText);
    if (!parsed) {
      const result: WebSearchResult = {
        ok: false,
        reason: "parse_error",
        kind,
        ms: Date.now() - startedAt,
      };
      cache.set(cacheKey, { result, at: Date.now() });
      return result;
    }

    if (parsed.found === false) {
      const result: WebSearchResult = {
        ok: false,
        reason: "not_found",
        kind,
        ms: Date.now() - startedAt,
      };
      cache.set(cacheKey, { result, at: Date.now() });
      return result;
    }

    const result: WebSearchResult = {
      ok: true,
      kind,
      raw: parsed,
      source: typeof parsed.source === "string" ? parsed.source : null,
      ms: Date.now() - startedAt,
      from_web: true,
    };
    cache.set(cacheKey, { result, at: Date.now() });
    return result;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const isAbort = err.name === "AbortError";
    const result: WebSearchResult = {
      ok: false,
      reason: isAbort ? "timeout" : "exception",
      error: err.message,
      kind,
      ms: Date.now() - startedAt,
      timeout_ms: isAbort ? WEB_LOOKUP_TIMEOUT_MS : undefined,
    };
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}
