import { listTen8ActiveIncidents } from "../ten8/store.js";
import { lookupSsaProperty } from "./ssaProperties.js";
import { accountCodeDashForm } from "./speech/numbers.js";
import { formatPhoneForTts } from "./speech/phoneSpeech.js";
import type { InfoRequestFields } from "./parse.js";
import { isWebSearchConfigured, webSearchAnswer } from "./webSearch.js";

function normalizeUnitId(u: string): string {
  return u.trim().toLowerCase().replace(/^27-/, "");
}

function incidentPayloadHasUnit(inc: { payload: unknown }, targetUnit: string): boolean {
  if (!targetUnit || !inc.payload || typeof inc.payload !== "object") {
    return false;
  }
  const body = inc.payload as Record<string, unknown>;
  const units = body.units ?? body.Units;
  if (!Array.isArray(units)) {
    return false;
  }
  const want = normalizeUnitId(targetUnit);
  return units.some((u) => {
    if (!u || typeof u !== "object") {
      return false;
    }
    const row = u as Record<string, unknown>;
    const id = String(row.id ?? row.unitId ?? row.unit_id ?? "").trim();
    return normalizeUnitId(id) === want;
  });
}

/** Trim a full street address to street + city for brevity on the air (drop state/zip/country). */
function shortenLocationForRadio(loc: string | null): string {
  if (!loc?.trim()) {
    return "";
  }
  const parts = loc
    .split(",")
    .map((p) => p.replace(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, "").trim())
    .filter((p) => p && !/^USA$/i.test(p) && !/^\d{5}(?:-\d{4})?$/.test(p) && !/^[A-Z]{2}$/.test(p));
  return parts.slice(0, 2).join(", ");
}

export function buildInfoRequestAck(requestingUnit: string | null | undefined): string {
  if (!requestingUnit) {
    return "Copy. Standby.";
  }
  const csShort = /^27-0[0-3]0$/.test(requestingUnit)
    ? requestingUnit
    : requestingUnit.replace(/^27-/, "");
  return `${csShort}, copy. Standby.`;
}

/** Slow lookups: web search (phone book uses web, not a local list). */
export function infoRequestNeedsAsync(infoRequest: InfoRequestFields): boolean {
  const t = infoRequest.type;
  return ["phone", "contact", "external_address", "legal_code", "general_query"].includes(t);
}

function webNotConfiguredLine(csPart: string): string {
  return `${csPart}negative, web lookup not configured.`;
}

export async function buildInfoRequestResponse(
  agencyId: number,
  infoRequest: InfoRequestFields,
  requestingUnit: string | null | undefined,
): Promise<string | null> {
  const csPart = requestingUnit
    ? `${/^27-0[0-3]0$/.test(requestingUnit) ? requestingUnit : requestingUnit.replace(/^27-/, "")}, `
    : "";

  switch (infoRequest.type) {
    case "address": {
      if (!infoRequest.account_code) {
        return `${csPart}negative, no account number heard. 10-9 with the account number.`;
      }
      const prop = lookupSsaProperty(infoRequest.account_code);
      if (!prop) {
        return `${csPart}negative, account ${infoRequest.account_code} is not in our property database.`;
      }
      const accountSpoken = accountCodeDashForm(infoRequest.account_code);
      const parts = [`account ${accountSpoken} is ${prop.name}`];
      if (prop.street) {
        parts.push(`at ${prop.street}`);
      }
      if (prop.city) {
        parts.push(prop.city);
      }
      return `${csPart}${parts.join(", ")}.`;
    }

    case "pending_calls": {
      const pending = await listTen8ActiveIncidents(agencyId);
      if (pending.length === 0) {
        return `${csPart}no pending calls at this time.`;
      }
      const MAX_READ = 6;
      const items = pending.slice(0, MAX_READ).map((inc) => {
        const codeOrType = (inc.incident_type || "call").trim();
        const loc = shortenLocationForRadio(inc.location);
        return loc ? `${codeOrType} at ${loc}` : codeOrType;
      });
      const intro = pending.length === 1 ? "one pending call:" : `${pending.length} pending calls:`;
      let body = items.join("; ");
      if (pending.length > MAX_READ) {
        body += `; plus ${pending.length - MAX_READ} more on the dashboard`;
      }
      return `${csPart}${intro} ${body}.`;
    }

    case "active_calls_for_unit": {
      const targetUnit = (infoRequest.subject || requestingUnit || "")
        .trim()
        .replace(/^27-/, "")
        .toLowerCase();
      const active = await listTen8ActiveIncidents(agencyId);
      const inc = active.find((i) => incidentPayloadHasUnit(i, targetUnit));
      if (!inc) {
        return `${csPart}no active calls assigned at this time.`;
      }
      const codeOrType = inc.incident_type || "call";
      const loc = inc.location || "unknown location";
      return `${csPart}you're on ${codeOrType} at ${loc}.`;
    }

    case "phone":
    case "contact": {
      if (!infoRequest.subject) {
        return `${csPart}negative, no contact specified.`;
      }
      if (!isWebSearchConfigured()) {
        return webNotConfiguredLine(csPart);
      }
      const webResult = await webSearchAnswer(infoRequest.subject, "phone");
      if (webResult.ok && webResult.raw) {
        const phone = typeof webResult.raw.phone === "string" ? webResult.raw.phone : null;
        if (phone) {
          const phoneSpoken = formatPhoneForTts(phone);
          const name =
            (typeof webResult.raw.name === "string" && webResult.raw.name) || infoRequest.subject;
          return `${csPart}${name}, number is ${phoneSpoken}.`;
        }
      }
      if (webResult.reason === "no_api_key" || webResult.reason === "anthropic_required") {
        return webNotConfiguredLine(csPart);
      }
      if (webResult.reason === "timeout") {
        return `${csPart}negative, lookup timed out. Try again or check the number yourself.`;
      }
      return `${csPart}negative, unable to find a phone number for ${infoRequest.subject}.`;
    }

    case "external_address": {
      if (!infoRequest.subject) {
        return `${csPart}negative, no place specified.`;
      }
      if (!isWebSearchConfigured()) {
        return webNotConfiguredLine(csPart);
      }
      const webResult = await webSearchAnswer(infoRequest.subject, "external_address");
      if (webResult.ok && webResult.raw && typeof webResult.raw.street === "string") {
        const r = webResult.raw;
        const name =
          (typeof r.name === "string" && r.name) || infoRequest.subject;
        const addressParts = [r.street, r.city, r.state].filter(Boolean).join(", ");
        return `${csPart}${name}, address is ${addressParts}.`;
      }
      if (webResult.reason === "no_api_key" || webResult.reason === "anthropic_required") {
        return webNotConfiguredLine(csPart);
      }
      if (webResult.reason === "timeout") {
        return `${csPart}negative, lookup timed out. Try again.`;
      }
      return `${csPart}negative, unable to find an address for ${infoRequest.subject}.`;
    }

    case "legal_code": {
      if (!infoRequest.subject) {
        return `${csPart}negative, no code question heard.`;
      }
      if (!isWebSearchConfigured()) {
        return webNotConfiguredLine(csPart);
      }
      const webResult = await webSearchAnswer(infoRequest.subject, "legal_code");
      if (webResult.ok && webResult.raw && typeof webResult.raw.code_section === "string") {
        const r = webResult.raw;
        const codeSpoken = String(r.code_section)
          .replace(/[()]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const parts = [codeSpoken];
        if (typeof r.short_title === "string" && r.short_title) {
          parts.push(r.short_title);
        }
        if (typeof r.brief_summary === "string" && r.brief_summary) {
          parts.push(r.brief_summary);
        }
        return `${csPart}${parts.join(", ")}`;
      }
      if (webResult.reason === "no_api_key" || webResult.reason === "anthropic_required") {
        return webNotConfiguredLine(csPart);
      }
      if (webResult.reason === "timeout") {
        return `${csPart}negative, lookup timed out. Try again.`;
      }
      return `${csPart}negative, unable to find a code reference for ${infoRequest.subject}.`;
    }

    case "general_query": {
      if (!infoRequest.subject) {
        return `${csPart}negative, no question heard.`;
      }
      if (!isWebSearchConfigured()) {
        return webNotConfiguredLine(csPart);
      }
      const webResult = await webSearchAnswer(infoRequest.subject, "general");
      if (webResult.ok && webResult.raw && typeof webResult.raw.answer === "string") {
        return `${csPart}${webResult.raw.answer}`;
      }
      if (webResult.reason === "no_api_key" || webResult.reason === "anthropic_required") {
        return webNotConfiguredLine(csPart);
      }
      if (webResult.reason === "timeout") {
        return `${csPart}negative, lookup timed out. Try again.`;
      }
      return `${csPart}negative, unable to find an answer.`;
    }

    default:
      // "unknown" / unrecognized type: we have no specific lookup to run. Return null so the
      // caller keeps the model's own dispatcher_response instead of speaking a canned "negative"
      // line — otherwise normal traffic the model mis-tags as request_info gets no real reply.
      return null;
  }
}
