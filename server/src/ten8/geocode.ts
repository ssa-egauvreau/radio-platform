import { getAgencyIntegrationValue } from "../store.js";

const GEO_CACHE = new Map<string, { lat: number; lon: number; at: number }>();
const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 10-8 New Incident API example: "(33.79990119110902, -117.88240038784782)" */
export function formatTen8Coordinates(lat: number, lon: number): string {
  return `(${lat}, ${lon})`;
}

/** CAD v1.1.0 create example: "33.717, -117.831" */
export function formatTen8Latlng(lat: number, lon: number): string {
  return `${lat}, ${lon}`;
}

/** Parse `coordinates` or `latlng` strings from 10-8 incident payloads. */
export function parseTen8CoordinateString(value: unknown): { lat: number; lon: number } | null {
  if (typeof value !== "string") {
    return null;
  }
  const s = value.trim();
  const paren = s.match(/^\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/);
  if (paren) {
    const lat = Number(paren[1]);
    const lon = Number(paren[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }
  const parts = s.split(",").map((x) => Number(x.trim()));
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return { lat: parts[0]!, lon: parts[1]! };
  }
  return null;
}

/**
 * Geocode a US address for 10-8 incident create + dispatch map pins.
 * Uses per-agency Google key, then GOOGLE_MAPS_GEOCODING_API_KEY, then Nominatim.
 */
export async function geocodeAddressForAgency(
  agencyId: number,
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  const key = address.trim().toLowerCase();
  if (!key) {
    return null;
  }
  const cached = GEO_CACHE.get(key);
  if (cached && Date.now() - cached.at < GEO_CACHE_TTL_MS) {
    return { lat: cached.lat, lon: cached.lon };
  }

  const googleKey =
    (await getAgencyIntegrationValue(agencyId, "google_maps_geocoding_api_key"))?.trim() ||
    process.env.GOOGLE_MAPS_GEOCODING_API_KEY?.trim() ||
    "";

  if (googleKey) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", address);
      url.searchParams.set("key", googleKey);
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = (await r.json()) as {
          status?: string;
          results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
        };
        const loc = data.results?.[0]?.geometry?.location;
        const lat = Number(loc?.lat);
        const lon = Number(loc?.lng);
        if (data.status === "OK" && Number.isFinite(lat) && Number.isFinite(lon)) {
          GEO_CACHE.set(key, { lat, lon, at: Date.now() });
          return { lat, lon };
        }
      }
    } catch {
      /* try nominatim */
    }
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "us");
    const r = await fetch(url.toString(), {
      headers: { "User-Agent": "SafeT-PTT-Console/1.0 (10-8 geocode)" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const data = (await r.json()) as Array<{ lat?: string; lon?: string }>;
      const hit = data[0];
      const lat = Number(hit?.lat);
      const lon = Number(hit?.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        GEO_CACHE.set(key, { lat, lon, at: Date.now() });
        return { lat, lon };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Local DB seed fields so dispatch map pins work before the 10-8 webhook arrives. */
export function buildTen8IncidentSeedCoords(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof body.coordinates === "string" && body.coordinates.trim()) {
    out.coordinates = body.coordinates.trim();
    const parsed = parseTen8CoordinateString(body.coordinates);
    if (parsed) {
      out.lat = parsed.lat;
      out.lng = parsed.lon;
      out.latitude = parsed.lat;
      out.longitude = parsed.lon;
    }
  }
  return out;
}
