import { getAgencyIntegrationValue } from "../store.js";

const DEFAULT_BASE = "https://ps569km5w9.execute-api.us-gov-west-1.amazonaws.com/prod";

async function ten8Config(agencyId: number): Promise<{
  baseUrl: string;
  apiKey: string | null;
  apiSecret: string | null;
  live: boolean;
} | null> {
  const apiKey = await getAgencyIntegrationValue(agencyId, "ten8_api_key");
  const apiSecret = await getAgencyIntegrationValue(agencyId, "ten8_api_secret");
  if (!apiKey?.trim() || !apiSecret?.trim()) {
    return null;
  }
  const baseUrl =
    (await getAgencyIntegrationValue(agencyId, "ten8_api_base_url"))?.trim() || DEFAULT_BASE;
  const liveRaw = await getAgencyIntegrationValue(agencyId, "ten8_live_execution");
  const live = liveRaw === "1" || liveRaw?.toLowerCase() === "true";
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey: apiKey.trim(), apiSecret: apiSecret.trim(), live };
}

async function ten8Fetch(
  agencyId: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cfg = await ten8Config(agencyId);
  if (!cfg) {
    return { ok: false, status: 0, data: { error: "ten8_not_configured" } };
  }
  if (!cfg.live && method !== "GET") {
    console.log(`[ten8] shadow ${method} ${path}`, body ?? "");
    return { ok: true, status: 200, data: { shadow: true, method, path, body } };
  }
  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const r = await fetch(url, {
    method,
    headers: {
      "X-API-Key": cfg.apiKey!,
      "X-API-Secret": cfg.apiSecret!,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await r.json();
  } catch {
    data = await r.text().catch(() => null);
  }
  return { ok: r.ok, status: r.status, data };
}

export async function ten8AddComment(
  agencyId: number,
  callId: string,
  comment: string,
): Promise<{ ok: boolean; shadow?: boolean; data?: unknown }> {
  const lookup = encodeURIComponent(callId);
  const res = await ten8Fetch(agencyId, "POST", `/v1/incidents/${lookup}/comments`, {
    comment: comment.slice(0, 4000),
  });
  return { ok: res.ok, shadow: (res.data as { shadow?: boolean })?.shadow === true, data: res.data };
}

export async function ten8Configured(agencyId: number): Promise<boolean> {
  return (await ten8Config(agencyId)) != null;
}
