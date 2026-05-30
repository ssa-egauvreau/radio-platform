import type { AiDispatchParseResult } from "./parse.js";
import type { SsaPropertyRecord } from "./ssaProperties.js";
import { accountCodeLocnotesForm } from "./speech/numbers.js";
import { findRadioMapPosition } from "./unitLocation.js";
import { isWebSearchConfigured, webSearchAnswer } from "./webSearch.js";
import { forwardGeocodeStructuredForAgency } from "../ten8/geocode.js";
import type { Ten8LocationFields } from "../ten8/incidentPayload.js";
import { formatLocationForTen8, normalizeAddressForTen8 } from "../ten8/incidentPayload.js";
import { listPositions } from "../store.js";

export type UnitGpsHint = {
  lat: number;
  lon: number;
  natural?: string;
  city?: string;
};

/** "at the Ross at 3123" / "Ross at 32-08" — business + SSA account anchor. */
export function parseBusinessAtAccountPhrase(
  transcript: string,
): { business: string; accountCode: string } | null {
  const tx = transcript.trim();
  if (!tx) {
    return null;
  }
  const patterns = [
    /\bat\s+(?:the\s+)?([a-z][a-z0-9\s&'.-]{1,40}?)\s+at\s+(?:property\s+)?(\d{2}-\d{2})\b/i,
    /\bout\s+with\s+(?:one\s+)?(?:at\s+)?(?:the\s+)?([a-z][a-z0-9\s&'.-]{1,40}?)\s+at\s+(\d{2}-\d{2})\b/i,
    /\bat\s+(?:the\s+)?([a-z][a-z0-9\s&'.-]{1,40}?)\s+at\s+(?:property\s+)?(\d{3,5})\b/i,
    /\bout\s+with\s+(?:one\s+)?(?:at\s+)?(?:the\s+)?([a-z][a-z0-9\s&'.-]{1,40}?)\s+at\s+(\d{3,5})\b/i,
    /\b(?:the\s+)?([a-z][a-z0-9\s&'.-]{1,35}?)\s+at\s+(\d{2}-\d{2})\b/i,
  ];
  for (const re of patterns) {
    const m = tx.match(re);
    if (m?.[1] && m[2]) {
      const business = cleanBusinessToken(m[1]);
      const accountCode = m[2]!.trim();
      if (business && accountCode) {
        return { business, accountCode };
      }
    }
  }
  return null;
}

function cleanBusinessToken(raw: string): string {
  return raw
    .replace(/\b(one|a|an|the)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlaceKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when the officer named a place that is not the SSA property name on file. */
export function spokenPlaceConflictsWithProperty(
  spokenBusiness: string,
  propertyName: string,
): boolean {
  const s = normalizePlaceKey(spokenBusiness);
  const p = normalizePlaceKey(propertyName);
  if (!s || !p) {
    return false;
  }
  if (s === p || p.includes(s) || s.includes(p)) {
    return false;
  }
  return true;
}

export function buildAccountLocnotes(
  accountCode: string,
  prop: SsaPropertyRecord,
  extra?: string | null,
): string {
  const acct = accountCodeLocnotesForm(accountCode).trim();
  const name = prop.name.trim();
  const base = [acct, name].filter(Boolean).join(" ");
  const hint = extra?.trim();
  if (base && hint) {
    return `${base} — ${hint}`;
  }
  return base || hint || "";
}

function webRawToLocationFields(
  raw: Record<string, unknown>,
  locnotes: string,
): Ten8LocationFields | null {
  const street = typeof raw.street === "string" ? raw.street.trim() : "";
  const city = typeof raw.city === "string" ? raw.city.trim() : "";
  const state = typeof raw.state === "string" ? raw.state.trim() : "CA";
  const zip = typeof raw.zip === "string" ? raw.zip.trim() : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!street && !city) {
    return null;
  }
  return (
    formatLocationForTen8({
      street: street || name,
      city: city || "Orange",
      state,
      zip,
      locnotes,
    }) ?? null
  );
}

async function resolveViaWebAndGeocode(
  agencyId: number,
  searchQuery: string,
  locnotes: string,
  gps?: UnitGpsHint | null,
): Promise<Ten8LocationFields | null> {
  const hintSuffix = gps
    ? ` Near map coordinates ${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}${gps.city ? ` (${gps.city})` : ""} in Orange County California. Pick the closest matching storefront.`
    : "";

  if (isWebSearchConfigured()) {
    const web = await webSearchAnswer(`${searchQuery}${hintSuffix}`, "external_address");
    if (web.ok && web.raw && web.raw.found === true) {
      const loc = webRawToLocationFields(web.raw as Record<string, unknown>, locnotes);
      if (loc) {
        return loc;
      }
    }
  }

  const geoQuery = gps
    ? `${searchQuery}, near ${gps.natural ?? `${gps.lat},${gps.lon}`}, Orange County, CA`
    : `${searchQuery}, Orange County, CA`;
  const structured = await forwardGeocodeStructuredForAgency(agencyId, geoQuery);
  if (structured?.street || structured?.city) {
    return (
      formatLocationForTen8({
        street: structured.street,
        city: structured.city,
        state: structured.state ?? "CA",
        zip: structured.zip,
        locnotes,
      }) ?? null
    );
  }
  return null;
}

/** Officer at account property but named a different business (e.g. Ross at 3123). */
export async function resolveBusinessAtAccountProperty(
  agencyId: number,
  business: string,
  accountCode: string,
  prop: SsaPropertyRecord,
  spokenHint: string,
): Promise<Ten8LocationFields | null> {
  const anchor = formatLocationForTen8({
    street: prop.street,
    city: prop.city,
    state: prop.state,
    zip: prop.zip,
  });
  const anchorLine = anchor?.location ?? `${prop.street}, ${prop.city}, ${prop.state} ${prop.zip}`;
  const locnotes = buildAccountLocnotes(accountCode, prop, spokenHint.trim() || business.trim());

  const queries = [
    `${business} store near ${anchorLine}`,
    `${business} ${prop.city} CA near ${normalizeAddressForTen8(prop.street)}`,
    `${business} Orange County CA closest to ${anchorLine}`,
  ];

  for (const q of queries) {
    const loc = await resolveViaWebAndGeocode(agencyId, q, locnotes);
    if (loc) {
      return loc;
    }
  }
  return null;
}

export async function loadUnitGpsHint(
  agencyId: number,
  unitId: string | null | undefined,
): Promise<UnitGpsHint | null> {
  const unit = unitId?.trim();
  if (!unit) {
    return null;
  }
  const positions = await listPositions(agencyId);
  const pos = findRadioMapPosition(positions, unit);
  if (!pos) {
    return null;
  }
  const updatedMs = Date.parse(pos.updated_at);
  if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > 10 * 60 * 1000) {
    return null;
  }
  const lat = Number(pos.lat);
  const lon = Number(pos.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  const structured = await forwardGeocodeStructuredForAgency(
    agencyId,
    `${lat},${lon}`,
  );
  return {
    lat,
    lon,
    natural: structured?.formatted ?? undefined,
    city: structured?.city ?? undefined,
  };
}

/** External place (no SSA match): web + geocode, biased by unit GPS when available. */
export async function resolveExternalPlaceWithHints(
  agencyId: number,
  searchQuery: string,
  opts: { locnotes?: string; unitId?: string | null; transcript?: string },
): Promise<Ten8LocationFields | null> {
  const gps = await loadUnitGpsHint(agencyId, opts.unitId);
  let query = searchQuery.trim();
  const tx = opts.transcript ?? "";
  const cross = tx.match(
    /\b(?:on|at|near)\s+([a-z0-9\s]+?)\s+(?:and|&)\s+([a-z0-9\s]+?)(?:\s|,|\.|$)/i,
  );
  if (cross?.[1] && cross[2]) {
    const a = cross[1].trim();
    const b = cross[2].trim();
    if (a.length > 2 && b.length > 2) {
      query = `${query} at ${a} and ${b}, Orange County California`;
    }
  } else if (gps?.natural && !/\d{3,5}\s+[A-Za-z]/.test(query)) {
    query = `${query} near ${gps.natural}`;
  }

  const locnotes =
    opts.locnotes?.trim() ||
    (gps?.natural ? `${searchQuery}; near unit GPS ${gps.natural}` : searchQuery);

  return resolveViaWebAndGeocode(agencyId, query, locnotes, gps);
}

/** Pick business name from parse + transcript when it differs from the SSA property. */
export function inferSpokenBusiness(
  parsed: AiDispatchParseResult,
  transcript: string,
  prop: SsaPropertyRecord | null,
): string | null {
  const fromPhrase = parseBusinessAtAccountPhrase(transcript);
  if (fromPhrase?.business) {
    return fromPhrase.business;
  }

  const name = parsed.location_name?.trim();
  if (name && prop && spokenPlaceConflictsWithProperty(name, prop.name)) {
    return name;
  }
  if (name && !prop && name.length >= 3 && !/^\d{3,5}$/.test(name)) {
    return name;
  }

  const summary = parsed.summary?.trim() ?? "";
  const atBiz = summary.match(
    /\bat\s+(?:the\s+)?([A-Za-z][A-Za-z0-9\s&'.-]{2,35}?)(?:\s+at\s+|\s*,|\s*\.|$)/i,
  );
  if (atBiz?.[1]) {
    const biz = cleanBusinessToken(atBiz[1]);
    if (biz && (!prop || spokenPlaceConflictsWithProperty(biz, prop.name))) {
      return biz;
    }
  }
  return null;
}
