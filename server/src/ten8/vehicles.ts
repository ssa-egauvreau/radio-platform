import type { PlateLookupResult } from "../aiDispatch/plateLookup.js";

/** 10-8 CAD API POST /v1/incidents/{lookup}/vehicles (AddVehicleRequest). */
export type Ten8AddVehicleBody = {
  notes?: string;
  vehicle: {
    license?: string;
    vin?: string;
    state?: string;
    type?: string;
    make?: string;
    model?: string;
    color?: string;
    year?: number;
  };
};

function parseVehicleYear(year: string | null | undefined): number | undefined {
  if (!year) {
    return undefined;
  }
  const n = parseInt(String(year).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2100) {
    return undefined;
  }
  return n;
}

/** Build AddVehicleRequest when lookup returned vehicle fields. */
export function buildTen8AddVehicleBody(lookup: PlateLookupResult): Ten8AddVehicleBody | null {
  if (!lookup.ok) {
    return null;
  }

  const license = lookup.plate?.trim().toUpperCase();
  const vin = lookup.vin?.trim().toUpperCase();
  const state = lookup.state?.trim().toUpperCase();
  const make = lookup.make?.trim();
  const model = lookup.model?.trim();
  const color = lookup.color?.trim();
  const year = parseVehicleYear(lookup.year ?? undefined);

  if (!license && !vin && !make && !model && !color && year == null) {
    return null;
  }

  const vehicle: Ten8AddVehicleBody["vehicle"] = {};
  if (license) {
    vehicle.license = license;
  }
  if (vin) {
    vehicle.vin = vin;
  }
  if (state) {
    vehicle.state = state;
  }
  if (make) {
    vehicle.make = make;
  }
  if (model) {
    vehicle.model = model;
  }
  if (color) {
    vehicle.color = color;
  }
  if (year != null) {
    vehicle.year = year;
  }

  const notesParts: string[] = [];
  if (license && state) {
    notesParts.push(`Plate lookup ${state} ${license}`);
  } else if (vin) {
    notesParts.push("VIN lookup");
  } else {
    notesParts.push("Vehicle lookup");
  }

  return { notes: notesParts.join(" "), vehicle };
}

/**
 * Fallback CAD comment (strict alphanumeric + spaces) when vehicle API fields are not applied.
 * Includes plate/VIN and decoded year/make/model/color when available.
 */
export function formatTen8VehicleLookupComment(
  callsign: string,
  lookup: PlateLookupResult,
): string | null {
  const cs = callsign.trim();
  if (!cs) {
    return null;
  }

  const parts: string[] = [cs, "VEHICLE LOOKUP"];

  if (lookup.plate) {
    parts.push(lookup.state ? `${lookup.state} ${lookup.plate}` : lookup.plate);
  } else if (lookup.vin) {
    parts.push(`VIN ${lookup.vin}`);
  }

  if (!lookup.ok) {
    const reason = lookup.reason?.trim() || lookup.message?.trim() || "no record";
    parts.push(String(reason).toUpperCase().replace(/_/g, " "));
    return parts.join(" ").slice(0, 4000);
  }

  const desc = [lookup.year, lookup.make, lookup.model, lookup.color].filter(Boolean).join(" ");
  if (desc) {
    parts.push(desc);
  }
  if (lookup.vin && lookup.plate) {
    parts.push(`VIN ${lookup.vin}`);
  }

  return parts.join(" ").slice(0, 4000);
}
