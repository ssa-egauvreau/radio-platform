import type { PlateLookupResult } from "./plateLookup.js";
import type { WebSearchResult } from "./webSearch.js";

/** csPart is the callsign prefix, e.g. "352, " or "". */

export function callsignPrefixForRadio(unitId: string | null | undefined): string {
  if (!unitId?.trim()) {
    return "";
  }
  const u = unitId.trim();
  const short = /^27-0[0-3]0$/.test(u) ? u : u.replace(/^27-/, "");
  return `${short}, `;
}

export function plateLookupFailureLine(
  csPart: string,
  lookup?: Pick<PlateLookupResult, "reason"> | null,
): string {
  const reason = lookup?.reason;
  if (reason === "no_record") {
    return `${csPart}no return comes back to that license plate.`;
  }
  if (reason === "not_configured") {
    return `${csPart}license plate system is not set up.`;
  }
  if (reason === "auth_error" || reason === "insufficient_credit") {
    return `${csPart}license plate system is down right now.`;
  }
  if (reason === "network_error" || reason === "api_error") {
    return `${csPart}license plate system is down right now.`;
  }
  return `${csPart}no return comes back to that license plate.`;
}

export function vinLookupFailureLine(
  csPart: string,
  lookup?: Pick<PlateLookupResult, "reason"> | null,
): string {
  const reason = lookup?.reason;
  if (reason === "no_record") {
    return `${csPart}no return comes back to that VIN.`;
  }
  if (reason === "invalid_vin") {
    return `${csPart}negative on that vin, please 10-9 the transmission.`;
  }
  if (reason === "not_configured") {
    return `${csPart}license plate system is not set up.`;
  }
  if (
    reason === "auth_error" ||
    reason === "insufficient_credit" ||
    reason === "network_error" ||
    reason === "api_error"
  ) {
    return `${csPart}license plate system is down right now.`;
  }
  return `${csPart}license plate system is down right now.`;
}

export function webSearchFailureLine(csPart: string, web: WebSearchResult): string {
  const reason = web.reason;
  if (reason === "no_api_key" || reason === "anthropic_required") {
    return `${csPart}I can't search that information, web lookup is not configured.`;
  }
  if (reason === "timeout") {
    return `${csPart}internet is not working right now, try again.`;
  }
  if (reason === "api_error" || reason === "exception" || reason === "parse_error") {
    return `${csPart}internet is not working right now.`;
  }
  if (reason === "not_found") {
    return `${csPart}I can't find that information.`;
  }
  return `${csPart}I can't search that information.`;
}

export function webSearchNotConfiguredLine(csPart: string): string {
  return `${csPart}I can't search that information, web lookup is not configured.`;
}

export function genericInfoLookupFailedLine(csPart: string): string {
  return `${csPart}I can't find that information.`;
}

export function cadSystemDownLine(csPart: string): string {
  return `${csPart}10-8 CAD is down right now, try again.`;
}

export function cadLookupFailedLine(csPart: string): string {
  return `${csPart}I can't find that information in CAD right now.`;
}
