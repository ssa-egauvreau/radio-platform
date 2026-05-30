import type { CadPersonLinkFields } from "./parse.js";
import { buildCadPersonLinkBody } from "../ten8/cadRadioLookup.js";
import { ten8AddComment, ten8AddPerson } from "../ten8/client.js";
import { formatTen8RadioComment } from "../ten8/cadComments.js";

/** Build a person link body from a free-text CAD search subject (name / DOB). */
export function buildCadPersonLinkFromSubject(subject: string): CadPersonLinkFields | null {
  const raw = subject.trim();
  if (!raw || raw.length < 2) {
    return null;
  }
  let rest = raw;
  let dob: string | null = null;
  const dobMatch = rest.match(
    /\b(?:dob|born)\s*[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/i,
  );
  if (dobMatch) {
    dob = dobMatch[1]!.trim();
    rest = rest.replace(dobMatch[0], " ").replace(/\s+/g, " ").trim();
  }
  const parts = rest.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return {
      relation: null,
      first_name: null,
      last_name: parts[0]!,
      dob,
      notes: `Subject lookup ${raw}`.slice(0, 400),
    };
  }
  return {
    relation: null,
    first_name: parts[0]!,
    last_name: parts.slice(1).join(" "),
    dob,
    notes: `Subject lookup ${raw}`.slice(0, 400),
  };
}

export function personSearchHadNoMatch(line: string): boolean {
  return /no matching persons/i.test(line);
}

/** After a miss, create-and-link person on the unit open call and log a CAD comment. */
export async function createPersonOnCallAfterMiss(opts: {
  agencyId: number;
  callId: string;
  callsign: string;
  subject: string;
  link: CadPersonLinkFields;
}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { call_id: opts.callId };
  const body = buildCadPersonLinkBody(opts.link);
  const personRes = await ten8AddPerson(opts.agencyId, opts.callId, body);
  out.person_request = body;
  Object.assign(out, personRes);

  const note = formatTen8RadioComment(
    opts.callsign,
    `SUBJECT LOOKUP NO CAD RECORD ${opts.subject.toUpperCase().slice(0, 200)} PERSON ADDED TO CALL`,
  );
  if (note) {
    const commentRes = await ten8AddComment(opts.agencyId, opts.callId, note);
    out.person_comment = { comment: note, ...commentRes };
  }
  return out;
}
