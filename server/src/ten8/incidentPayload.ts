import type { AiDispatchParseResult } from "../aiDispatch/parse.js";
import { lookupSsaProperty } from "../aiDispatch/ssaProperties.js";
import { isWebSearchConfigured, webSearchAnswer } from "../aiDispatch/webSearch.js";

/** Fields 10-8 / Google Maps geocoding expect (see New Incident API `location` example). */
export type Ten8LocationFields = {
  location: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  locnotes?: string;
};

/** 10-8 New Incident API: priority is integer 1 (highest) through 4 (lowest). There is no 0. */
export function clampTen8Priority(value: unknown, fallback = 3): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  if (n > 4) {
    return 4;
  }
  return Math.round(n);
}

/** Map call type / intent to a valid 10-8 priority (never 0). */
export function resolveTen8Priority(code: string | null | undefined, intent: string): number {
  const c = (code ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (intent === "emergency" || c === "10-33" || c === "1033") {
    return 1;
  }
  const urgent = [
    "961",
    "925",
    "925v",
    "459",
    "459a",
    "459s",
    "415",
    "415a",
    "415b",
    "415e",
    "245",
    "211",
    "966a",
    "187",
    "242",
  ];
  if (urgent.some((u) => c === u || c.startsWith(u))) {
    return 2;
  }
  const routine = ["586", "602", "484", "488", "c6", "test"];
  if (routine.some((r) => c === r)) {
    return 4;
  }
  return 3;
}

/**
 * Build the single `location` line and split fields the way Google Maps / 10-8 expect:
 * "2000 E Gene Autry Way, Anaheim, CA 92806"
 */
export function formatLocationForTen8(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  name?: string | null;
  locnotes?: string | null;
  county?: string | null;
}): Ten8LocationFields | null {
  const street = parts.street?.trim() || "";
  const city = parts.city?.trim() || "";
  let state = (parts.state?.trim() || "CA").toUpperCase();
  if (state.length > 2) {
    state = state.slice(0, 2);
  }
  const zip = (parts.zip?.trim() || "").replace(/\D/g, "").slice(0, 5);
  const name = parts.name?.trim() || "";
  const locnotes = parts.locnotes?.trim() || name || undefined;

  if (!street && !city) {
    return null;
  }

  const cityRegion = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const location = [street, cityRegion].filter(Boolean).join(", ");

  return {
    location,
    ...(street ? { streetAddress: street } : {}),
    ...(city ? { city } : {}),
    state,
    ...(zip ? { zip } : {}),
    ...(parts.county?.trim() ? { county: parts.county.trim() } : state === "CA" ? { county: "Orange County" } : {}),
    ...(locnotes ? { locnotes } : {}),
  };
}

/** Try to split "123 Main St, Anaheim, CA 92805" into structured fields. */
export function parseUsAddressLine(text: string): Ten8LocationFields | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }
  const segments = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) {
    return formatLocationForTen8({ street: raw, city: "Orange", state: "CA" });
  }
  const street = segments[0]!;
  const city = segments.length >= 3 ? segments[1]! : "";
  const tail = segments.length >= 3 ? segments[2]! : segments[1]!;
  const stateZip = tail.match(/^([A-Za-z]{2})\s*(\d{5})?/);
  const state = stateZip?.[1]?.toUpperCase() ?? "CA";
  const zip = stateZip?.[2] ?? "";
  return formatLocationForTen8({ street, city, state, zip });
}

function applyLocationFields(body: Record<string, unknown>, loc: Ten8LocationFields): void {
  body.location = loc.location;
  if (loc.streetAddress) body.streetAddress = loc.streetAddress;
  if (loc.city) body.city = loc.city;
  if (loc.state) body.state = loc.state;
  if (loc.zip) body.zip = loc.zip;
  if (loc.county) body.county = loc.county;
  if (loc.locnotes) body.locnotes = loc.locnotes;
}

async function resolveLocationFields(
  agencyId: number,
  parsed: AiDispatchParseResult,
): Promise<Ten8LocationFields | null> {
  const prop = lookupSsaProperty(parsed.location_code);
  if (prop) {
    return formatLocationForTen8({
      street: prop.street,
      city: prop.city,
      state: prop.state,
      zip: prop.zip,
      name: prop.name,
      locnotes: prop.locnotes || prop.name,
    });
  }

  const name = parsed.location_name?.trim();
  if (!name) {
    return null;
  }

  const parsedLine = parseUsAddressLine(name);
  if (parsedLine?.streetAddress && parsedLine.city) {
    return parsedLine;
  }

  if (!isWebSearchConfigured()) {
    return parseUsAddressLine(name) ?? formatLocationForTen8({ street: name, city: "Orange", state: "CA" });
  }

  const web = await webSearchAnswer(name, "external_address");
  const raw = web.raw;
  if (web.ok && raw && raw.found === true) {
    const street = typeof raw.street === "string" ? raw.street.trim() : "";
    const city = typeof raw.city === "string" ? raw.city.trim() : "";
    const state = typeof raw.state === "string" ? raw.state.trim() : "CA";
    const zip = typeof raw.zip === "string" ? raw.zip.trim() : "";
    const placeName = typeof raw.name === "string" ? raw.name.trim() : name;
    const formatted =
      formatLocationForTen8({
        street: street || name,
        city,
        state,
        zip,
        name: placeName,
        locnotes: placeName,
      }) ?? null;
    if (formatted) {
      return formatted;
    }
  }

  return parseUsAddressLine(name) ?? formatLocationForTen8({ street: name, city: "Orange", state: "CA" });
}

/** Build POST /incidents body with Google-style location + valid priority 1–4. */
export async function buildTen8NewIncidentBody(
  agencyId: number,
  parsed: AiDispatchParseResult,
  unit: string,
  dispatcherName: string,
): Promise<Record<string, unknown>> {
  const type = parsed.code?.trim() || "Officer Initiated";
  const body: Record<string, unknown> = {
    type,
    summary: parsed.summary?.trim() || type,
    dispatcher: dispatcherName,
    require_acknowledge: false,
    priority: resolveTen8Priority(parsed.code, parsed.intent),
  };
  if (unit.trim()) {
    body.units = unit.trim();
  }

  const loc = await resolveLocationFields(agencyId, parsed);
  if (loc) {
    applyLocationFields(body, loc);
  }

  return body;
}

/** Strip invalid priority and ensure location string is present when components exist. */
export function finalizeTen8NewIncidentBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  out.priority = clampTen8Priority(out.priority, 3);
  if (
    typeof out.streetAddress === "string" &&
    out.streetAddress.trim() &&
    (!out.location || !String(out.location).trim())
  ) {
    const loc = formatLocationForTen8({
      street: String(out.streetAddress),
      city: typeof out.city === "string" ? out.city : "",
      state: typeof out.state === "string" ? out.state : "CA",
      zip: typeof out.zip === "string" ? out.zip : "",
    });
    if (loc) {
      applyLocationFields(out, loc);
    }
  }
  return out;
}
