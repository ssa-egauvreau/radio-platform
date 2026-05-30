import type { AiDispatchParseResult } from "./parse.js";
import { buildCadPersonLinkFromSubject } from "./cadPersonHelpers.js";
import { normalizeCadTagName } from "../ten8/cadRadioLookup.js";

/** Incident / call number like 26-2223 or 25-0129. */
export function extractCallLookupNumber(text: string): string | null {
  const tx = text.trim();
  if (!tx) {
    return null;
  }
  const m =
    tx.match(/\b(\d{2,4}-\d{2,6})\b/) ||
    tx.match(/\bcall\s+(?:number\s+)?(\d{2,4}-\d{2,6})\b/i) ||
    tx.match(/\bincident\s+(\d{2,4}-\d{2,6})\b/i);
  return m?.[1]?.trim() ?? null;
}

const PERSON_SEARCH_RE =
  /\b968\b|\b(?:run|check|search)\s+(?:a\s+)?(?:subject|person|name)\b|\b(?:lookup|look\s+up)\s+(?:a\s+)?subject\b|\b(?:subject|person)\s+(?:in\s+)?(?:the\s+)?(?:cad|system|records)\b|\b(?:can you|could you|dispatch,?)\s+run\s+.+\s+in\s+(?:the\s+)?(?:cad|system)\b/i;

const INCIDENT_LOOKUP_RE =
  /\b(?:get|pull|look\s+up|lookup|open|read)\s+(?:a\s+)?(?:the\s+)?(?:incident|call)\b|\b(?:incident|call)\s+(?:details|info|information|summary)\b|\bwhat(?:'s| is)\s+on\s+call\b/i;

function matchTagQuery(transcript: string): string | null {
  const tx = transcript;
  const withTagWord = tx.match(
    /\b(?:does|is|do)\s+(?:this\s+)?call\s+(?:have|show|include)\s+(?:the\s+)?(.+?)\s+tag\b/i,
  );
  if (withTagWord?.[1]) {
    return withTagWord[1];
  }
  const direct = tx.match(
    /\b(?:is|are)\s+(?:this\s+)?call\s+(billable|parking\s+response)\b/i,
  );
  if (direct?.[1]) {
    return direct[1];
  }
  const we = tx.match(/\b(?:is|are)\s+we\s+(?:tagged|billing)\s+(?:as\s+)?(billable|parking\s+response)\b/i);
  return we?.[1] ?? null;
}

const TAG_ADD_RE =
  /\b(?:add|assign|apply|tag)\s+(?:this\s+)?(?:call\s+)?(?:as\s+)?(?:the\s+)?(billable|parking\s+response)\b|\b(?:mark|flag)\s+(?:this\s+)?(?:as\s+)?(billable|parking\s+response)\b/i;

const TAG_REMOVE_RE =
  /\b(?:remove|clear|drop|delete)\s+(?:the\s+)?(billable|parking\s+response)\s+tag\b|\b(?:untag|un-tag)\s+(billable|parking\s+response)\b/i;

function extractPersonSearchSubject(transcript: string): string | null {
  const tx = transcript.trim();
  const patterns = [
    /\b968\b[,\s]+(?:for\s+)?(.+?)(?:\.|,|$)/i,
    /\brun\s+(?:a\s+)?subject\s+(?:in\s+)?(?:cad|system|records)?\s*[,:]?\s*(.+?)(?:\.|,|$)/i,
    /\b(?:can you|could you|dispatch,?)\s+run\s+(.+?)\s+in\s+(?:the\s+)?(?:cad|system|records)\b/i,
    /\b(?:can you|could you)\s+run\s+(.+?)\s+in\s+(?:the\s+)?system\b/i,
    /\b(?:run|check|lookup)\s+(.+?)\s+in\s+(?:the\s+)?(?:cad|system|records)\b/i,
    /\blookup\s+subject\s+(.+?)(?:\.|,|$)/i,
    /\bsubject\s+(?:check|lookup)\s+(?:on\s+)?(.+?)(?:\.|,|$)/i,
  ];
  for (const re of patterns) {
    const m = tx.match(re);
    if (m?.[1]?.trim()) {
      return m[1].trim().slice(0, 200);
    }
  }
  return null;
}

function wantsIncidentLookup(transcript: string): boolean {
  return INCIDENT_LOOKUP_RE.test(transcript);
}

/**
 * Server-side CAD radio rules (968 person lookup, incident-by-number, tags).
 * Runs after the LLM parse and after out-with rules.
 */
export function applyCadDispatchRules(
  parsed: AiDispatchParseResult,
  transcript: string,
): AiDispatchParseResult {
  const tx = transcript.trim();
  if (!tx) {
    return parsed;
  }

  let out = { ...parsed };

  const callNum = extractCallLookupNumber(tx);

  if (PERSON_SEARCH_RE.test(tx) || out.code === "968") {
    const subject =
      extractPersonSearchSubject(tx) ||
      out.info_request?.subject?.trim() ||
      out.location_name?.trim() ||
      null;
    if (subject) {
      const link = buildCadPersonLinkFromSubject(subject);
      out = {
        ...out,
        actionable: true,
        intent: "request_info",
        code: "968",
        info_request: {
          type: "cad_person_search",
          account_code: null,
          subject,
        },
        dispatcher_response: null,
        ...(link && !out.cad_person_link ? { cad_person_link: link } : {}),
      };
    }
  }

  if (wantsIncidentLookup(tx)) {
    if (callNum) {
      out = {
        ...out,
        actionable: true,
        intent: "request_info",
        info_request: {
          type: "cad_incident_lookup",
          account_code: null,
          subject: callNum,
        },
        dispatcher_response: null,
      };
    } else if (!out.info_request || out.info_request.type !== "cad_incident_lookup") {
      out = {
        ...out,
        actionable: true,
        intent: "request_info",
        info_request: {
          type: "cad_incident_lookup",
          account_code: null,
          subject: null,
        },
        dispatcher_response: `${out.unit ?? "Unit"}, 10-9 the call number to look up that incident.`,
      };
    }
  }

  if (out.info_request?.type === "call_details" && callNum) {
    out = {
      ...out,
      info_request: {
        ...out.info_request,
        type: "cad_incident_lookup",
        subject: callNum,
      },
      dispatcher_response: null,
    };
  }

  const tagAdd = tx.match(TAG_ADD_RE);
  if (tagAdd?.[1]) {
    const tag = normalizeCadTagName(tagAdd[1]);
    if (tag) {
      out = { ...out, actionable: true, cad_tag: tag };
    }
  }

  const tagRemove = tx.match(TAG_REMOVE_RE);
  if (tagRemove?.[1]) {
    const tag = normalizeCadTagName(tagRemove[1]);
    if (tag) {
      out = { ...out, actionable: true, cad_tag_remove: tag };
    }
  }

  const tagQueryRaw = matchTagQuery(tx);
  if (tagQueryRaw) {
    const tag = normalizeCadTagName(tagQueryRaw);
    if (tag) {
      out = {
        ...out,
        actionable: true,
        intent: "request_info",
        info_request: {
          type: "cad_call_tags",
          account_code: null,
          subject: callNum ? `${callNum} ${tag}` : tag,
        },
        dispatcher_response: null,
      };
    }
  }

  return out;
}
