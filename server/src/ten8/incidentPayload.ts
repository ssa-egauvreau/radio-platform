import type { AiDispatchParseResult } from "../aiDispatch/parse.js";
import { accountCodeLocnotesForm } from "../aiDispatch/speech/numbers.js";
import { lookupSsaProperty } from "../aiDispatch/ssaProperties.js";
import { isWebSearchConfigured, webSearchAnswer } from "../aiDispatch/webSearch.js";
import { resolveTen8IncidentType, resolveTen8PriorityForCode, clampPriority } from "./callTypes.js";

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
export function clampTen8Priority(value: unknown, fallback = 4): number {
  return clampPriority(value, fallback);
}

/**
 * Google Maps' geocoder (which 10-8 uses to resolve `location`) is picky: "1586 N. Batavia
 * St" comes back UNAVAILABLE, but its own autocomplete returns "1586 N Batavia St" with
 * NO period after the directional. Strip the period after directional and common street
 * type abbreviations, and collapse runs of whitespace, so what we send geocodes cleanly.
 */
const DIRECTIONAL = /\b([NSEW]|NE|NW|SE|SW)\.(?=\s)/gi;
const STREET_TYPES = new Set([
  "st",
  "ave",
  "blvd",
  "dr",
  "rd",
  "ln",
  "ct",
  "pl",
  "hwy",
  "pkwy",
  "fwy",
  "ter",
  "trl",
  "cir",
  "way",
]);
export function normalizeAddressForTen8(input: string | null | undefined): string {
  const s = (input ?? "").trim();
  if (!s) {
    return "";
  }
  return s
    .replace(DIRECTIONAL, "$1")
    .replace(/\b([A-Za-z]+)\.(?=\s|,|$)/g, (m, word: string) =>
      STREET_TYPES.has(word.toLowerCase()) ? word : m,
    )
    .replace(/\s+/g, " ")
    .trim();
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
  const street = normalizeAddressForTen8(parts.street);
  const city = normalizeAddressForTen8(parts.city);
  let state = (parts.state?.trim() || "CA").toUpperCase();
  if (state.length > 2) {
    state = state.slice(0, 2);
  }
  const zip = (parts.zip?.trim() || "").replace(/\D/g, "").slice(0, 5);

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
    ...(parts.locnotes?.trim() ? { locnotes: parts.locnotes.trim() } : {}),
  };
}

/** SSA account property — property number then name for 10-8 locnotes (no dashes, no word "property"). */
export function buildSsaPropertyLocnotes(accountCode: string, prop: { name: string }): string {
  const name = prop.name.trim();
  const acct = accountCodeLocnotesForm(accountCode).trim();
  if (acct && name) {
    return `${acct} ${name}`;
  }
  return acct || name;
}

function looksLikeBareAccountCode(text: string): boolean {
  const t = text.trim();
  return /^\d{3,5}$/.test(t) || /^\d{2}-\d{2}$/.test(t);
}

/** Free-text place the officer said (not in SSA property DB) — for Google Maps lookup. */
export function buildExternalLocationSearchQuery(
  parsed: AiDispatchParseResult,
  transcript?: string,
): string | null {
  const name = parsed.location_name?.trim();
  if (name && !looksLikeBareAccountCode(name)) {
    return name;
  }

  const summary = parsed.summary?.trim() ?? "";
  if (summary) {
    const atInSummary = summary.match(/\bat\s+(.+?)(?:\.|,|;|$)/i);
    if (atInSummary?.[1]?.trim()) {
      return atInSummary[1].trim();
    }
    if (!looksLikeBareAccountCode(summary) && summary.length <= 200) {
      return summary;
    }
  }

  const tx = transcript?.trim() ?? "";
  if (tx) {
    const atInTx = tx.match(/\bat\s+(.+)/i);
    if (atInTx?.[1]?.trim()) {
      return atInTx[1].trim().slice(0, 220);
    }
  }

  return name || null;
}

function buildExternalLocnotes(searchQuery: string, resolvedPlaceName?: string): string {
  const q = searchQuery.trim();
  const place = resolvedPlaceName?.trim();
  if (place && place.toLowerCase() !== q.toLowerCase()) {
    return `${q}; ${place}`;
  }
  return q;
}

async function resolveAddressViaGoogleSearch(
  searchQuery: string,
): Promise<Ten8LocationFields | null> {
  if (!isWebSearchConfigured()) {
    console.warn("[ten8] external location needs web search but Anthropic web_search is not configured");
    return null;
  }

  const web = await webSearchAnswer(searchQuery, "external_address");
  const raw = web.raw;
  if (!web.ok || !raw || raw.found !== true) {
    return null;
  }

  const street = typeof raw.street === "string" ? raw.street.trim() : "";
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  const state = typeof raw.state === "string" ? raw.state.trim() : "CA";
  const zip = typeof raw.zip === "string" ? raw.zip.trim() : "";
  const placeName = typeof raw.name === "string" ? raw.name.trim() : "";

  if (!street && !city) {
    return null;
  }

  return (
    formatLocationForTen8({
      street: street || searchQuery,
      city: city || "Orange",
      state,
      zip,
      locnotes: buildExternalLocnotes(searchQuery, placeName || undefined),
    }) ?? null
  );
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
  _agencyId: number,
  parsed: AiDispatchParseResult,
  opts?: { transcript?: string },
): Promise<Ten8LocationFields | null> {
  const accountCode = parsed.location_code?.trim() ?? "";
  const prop = lookupSsaProperty(accountCode);
  if (prop && accountCode) {
    return formatLocationForTen8({
      street: prop.street,
      city: prop.city,
      state: prop.state,
      zip: prop.zip,
      locnotes: buildSsaPropertyLocnotes(accountCode, prop),
    });
  }

  const searchQuery = buildExternalLocationSearchQuery(parsed, opts?.transcript);
  if (!searchQuery) {
    return null;
  }

  const fromGoogle = await resolveAddressViaGoogleSearch(searchQuery);
  if (fromGoogle) {
    return fromGoogle;
  }

  const parsedLine = parseUsAddressLine(searchQuery);
  if (parsedLine?.streetAddress && parsedLine.city) {
    return {
      ...parsedLine,
      locnotes: buildExternalLocnotes(searchQuery),
    };
  }

  return (
    formatLocationForTen8({
      street: searchQuery,
      city: "Orange",
      state: "CA",
      locnotes: buildExternalLocnotes(searchQuery),
    }) ?? null
  );
}

/** Build POST /incidents body with Google-style location + valid priority 1–4. */
export async function buildTen8NewIncidentBody(
  agencyId: number,
  parsed: AiDispatchParseResult,
  unit: string,
  dispatcherName: string,
  opts?: { knownIncidentTypes?: string[]; transcript?: string },
): Promise<Record<string, unknown>> {
  const type = resolveTen8IncidentType(parsed.code, {
    knownTypes: opts?.knownIncidentTypes,
  });
  const body: Record<string, unknown> = {
    type,
    summary: parsed.summary?.trim() || type,
    dispatcher: dispatcherName,
    require_acknowledge: false,
    priority: resolveTen8PriorityForCode(parsed.code, parsed.intent),
  };
  if (unit.trim()) {
    body.units = unit.trim();
  }

  const loc = await resolveLocationFields(agencyId, parsed, { transcript: opts?.transcript });
  if (loc) {
    applyLocationFields(body, loc);
  }

  return body;
}

/** Strip invalid priority and ensure location string is present when components exist. */
export function finalizeTen8NewIncidentBody(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };
  out.priority = clampTen8Priority(out.priority, 4);
  if (typeof out.type === "string") {
    out.type = out.type.trim();
  }
  // Run every address-shaped field through the Google-friendly normalizer so a pre-formed
  // body coming from any code path (Google web search, parseUsAddressLine, hand-rolled,
  // etc.) lands as "1586 N Batavia St" not "1586 N. Batavia St" — 10-8's geocoder fails
  // on the latter and the call ends up with Coordinates: UNAVAILABLE.
  if (typeof out.location === "string") {
    out.location = normalizeAddressForTen8(out.location);
  }
  if (typeof out.streetAddress === "string") {
    out.streetAddress = normalizeAddressForTen8(out.streetAddress);
  }
  if (typeof out.city === "string") {
    out.city = normalizeAddressForTen8(out.city);
  }
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
