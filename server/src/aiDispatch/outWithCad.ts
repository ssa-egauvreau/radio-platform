/**
 * "Out with" / "I'll be out with" — SSA radio phrasing for pedestrian stops, car stops,
 * and on-scene updates. Server enforces CAD behavior so active calls get comments only.
 */

import { incidentPayloadHasUnit } from "./infoRequest.js";
import type { AiDispatchParseResult } from "./parse.js";

type ActiveIncident = { payload: unknown; call_id: string };

const OUT_WITH_RE =
  /\b(?:i\s*['']?ll\s+be\s+|will\s+be\s+|i\s*am\s+)?(?:out\s+with|out\s+w\/|ow)\s+/i;

const SKIP_INTENTS = new Set([
  "clear",
  "emergency",
  "emergency_clear",
  "plate_request",
  "plate_transmit",
  "request_info",
  "info_request_912",
  "info_clear_913",
]);

const VEHICLE_WORDS =
  /\b(?:vehicle|veh|car|cars|truck|suv|sedan|van|pickup|motorcycle|auto|automobile|plates?|vin|occupied|occupants?|civic|camry|accord|mustang|corolla|f-150|silverado|bmw|mercedes|honda|toyota|ford|chevy|chevrolet|nissan|hyundai|kia|lexus|audi|dodge|jeep|ram|gmc|tesla|subaru|mazda)\b/i;

const COLOR_WORDS =
  /\b(?:white|black|gray|grey|silver|red|blue|green|brown|tan|gold|maroon|beige|charcoal|burgundy)\b/i;

const PED_WORDS =
  /\b(?:male|female|man|woman|men|women|juvenile|juv|mha|fha|fwa|subject|subj|person|adult|suspect|detainee|transient|homeless)\b/i;

/** Party already on the call — comment only, never a new call type. */
const ON_CALL_PARTY_WORDS =
  /\b(?:the\s+)?(?:rp|reporting\s+party|property\s+manager|manager|homeowner|tenant|resident|owner|security|guard|supervisor|witness|victim|complainant|caller)\b/i;

export function isOutWithTransmission(transcript: string): boolean {
  return OUT_WITH_RE.test(transcript);
}

export function extractOutWithTail(transcript: string): string | null {
  const m = transcript.match(OUT_WITH_RE);
  if (!m || m.index === undefined) {
    return null;
  }
  return transcript.slice(m.index + m[0].length).replace(/[.,;]+$/, "").trim();
}

export function unitHasActiveAssignedCall(active: ActiveIncident[], unit: string): boolean {
  const u = unit.trim();
  if (!u) {
    return false;
  }
  return active.some((inc) => incidentPayloadHasUnit(inc, u));
}

function findActiveCallForUnit(
  active: ActiveIncident[],
  unit: string,
): ActiveIncident | null {
  const u = unit.trim();
  if (!u) {
    return null;
  }
  return active.find((inc) => incidentPayloadHasUnit(inc, u)) ?? null;
}

/** Cop-shorthand CAD comment for an out-with line. */
export function buildOutWithCommentText(tailOrTranscript: string): string {
  const tail = extractOutWithTail(tailOrTranscript) ?? tailOrTranscript.trim();
  if (!tail) {
    return "OUT W/";
  }
  let c = tail
    .replace(/\s+/g, " ")
    .replace(/\bwith\b/gi, "W/")
    .toUpperCase();
  if (!c.startsWith("OUT ")) {
    c = `OUT W/ ${c}`;
  }
  return c.slice(0, 240);
}

/**
 * Infer call type when officer is NOT on an existing call (new self-dispatch).
 * Returns null when AI context should decide (ambiguous person vs role on scene).
 */
export function inferOutWithCallCode(tail: string, hasActiveCall: boolean): string | null {
  const t = tail.trim();
  if (!t) {
    return null;
  }
  const lower = t.toLowerCase();

  if (/\b586\b/.test(lower) || /\billegally\s+parked\b/i.test(t) || /\bparked\s+illegally\b/i.test(t)) {
    return "586";
  }

  if (VEHICLE_WORDS.test(t) || (COLOR_WORDS.test(t) && VEHICLE_WORDS.test(t))) {
    return "961";
  }

  const numMatch = lower.match(/^(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (numMatch) {
    return "ped";
  }

  if (PED_WORDS.test(t)) {
    return "ped";
  }

  if (hasActiveCall && ON_CALL_PARTY_WORDS.test(t)) {
    return null;
  }

  if (ON_CALL_PARTY_WORDS.test(t) && !VEHICLE_WORDS.test(t)) {
    return "ped";
  }

  return null;
}

export function applyOutWithCadRules(
  parsed: AiDispatchParseResult,
  transcript: string,
  active: ActiveIncident[],
  fallbackUnit: string,
): AiDispatchParseResult {
  if (!isOutWithTransmission(transcript) || SKIP_INTENTS.has(parsed.intent)) {
    return parsed;
  }

  const unit = (parsed.unit ?? fallbackUnit).trim();
  const tail = extractOutWithTail(transcript) ?? "";
  const hasActive = unitHasActiveAssignedCall(active, unit);
  const activeCall = findActiveCallForUnit(active, unit);
  const commentText =
    parsed.comment_text?.trim() || buildOutWithCommentText(tail || transcript);

  if (hasActive && activeCall) {
    const next: AiDispatchParseResult = {
      ...parsed,
      intent: "on_scene",
      actionable: true,
      comment_text: commentText,
      recommended_action: `Post out-with comment on assigned call ${activeCall.call_id}; do not create a new incident.`,
    };
    if (parsed.intent === "dispatch") {
      next.summary = `${unit} out-with update on current assignment (comment only). ${parsed.summary}`.slice(
        0,
        480,
      );
    }
    if (!next.dispatcher_response?.trim()) {
      const cs = /^27-0[0-3]0$/.test(unit) ? unit : unit.replace(/^27-/, "");
      next.dispatcher_response = `Copy ${cs}, logged on your call.`;
    }
    return next;
  }

  const inferred = inferOutWithCallCode(tail, false);
  const code = (inferred ?? parsed.code)?.toLowerCase() ?? null;
  const next: AiDispatchParseResult = {
    ...parsed,
    intent: "dispatch",
    actionable: true,
    code,
    comment_text: commentText,
    recommended_action:
      parsed.recommended_action ??
      (code
        ? `Create new ${code} call from out-with transmission.`
        : "Create new call from out-with transmission using AI-inferred type."),
  };

  if (parsed.intent === "on_scene" || parsed.intent === "status_change" || parsed.intent === "unknown") {
    next.summary = `${unit} self-dispatch via out-with (new call). ${parsed.summary}`.slice(0, 480);
  }

  return next;
}
