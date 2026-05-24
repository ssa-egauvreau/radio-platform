/** Radio log line for 10-8 CAD comments: callsign first, then what they said on the air. */
export function formatTen8RadioComment(callsign: string, transcript: string): string | null {
  const cs = callsign.trim();
  const tx = transcript.trim();
  if (!cs || !tx) {
    return null;
  }
  return `${cs} ${tx}`.slice(0, 4000);
}

/** True only when this call id is in the current open-incident list from the webhook store. */
export function isVerifiedOpenCallId(
  callId: string,
  active: Array<{ call_id: string }>,
): boolean {
  const id = callId.trim();
  if (!id) {
    return false;
  }
  return active.some((row) => row.call_id.trim() === id);
}

/**
 * Pull a call lookup/id from 10-8 New Incident API JSON (array of incidents).
 * Returns null when the response does not prove the call exists.
 */
export function extractCallIdFromCreateResponse(data: unknown): string | null {
  if (!data) {
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const id = idFromIncidentObject(item);
      if (id) {
        return id;
      }
    }
    return null;
  }
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.incidents)) {
      return extractCallIdFromCreateResponse(o.incidents);
    }
    return idFromIncidentObject(o);
  }
  return null;
}

function idFromIncidentObject(item: unknown): string | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  const o = item as Record<string, unknown>;
  const candidates = [
    o.incident_id,
    o.incidentId,
    o.id,
    o.callID,
    o.callId,
  ];
  for (const c of candidates) {
    if (c == null) {
      continue;
    }
    const s = String(c).trim();
    if (s) {
      return s;
    }
  }
  return null;
}
