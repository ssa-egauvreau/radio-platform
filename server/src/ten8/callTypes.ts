/**
 * Maps AI dispatch quick-call `code` values to exact 10-8 Systems incident `type` strings.
 * These must match what your 10-8 CAD has configured (webhook `incident.type` / `incident_type`).
 *
 * Source: SSA QuickCall list in sunsetSafetySystemPrompt.txt (same as legacy 10-8 dashboard).
 */

/** Default when code is missing or unknown — must exist in 10-8. */
export const TEN8_DEFAULT_INCIDENT_TYPE = "Patrol Check";

type CallTypeEntry = { code: string; label: string };

/** Official quick-call shortcuts → CAD type label (right-hand side of prompt list). */
const QUICK_CALL_ENTRIES: CallTypeEntry[] = [
  { code: "1014", label: "10-14 Escort or Convoy" },
  { code: "11350", label: "Controlled Substance" },
  { code: "11357", label: "Marijuana" },
  { code: "187", label: "Murder" },
  { code: "207", label: "Kidnapping" },
  { code: "211", label: "Robbery" },
  { code: "240", label: "Assault" },
  { code: "242", label: "Battery" },
  { code: "245", label: "Assault with Deadly Weapon" },
  { code: "261", label: "Rape" },
  { code: "273a", label: "Child Cruelty" },
  { code: "2735", label: "Domestic Violence" },
  { code: "288", label: "Lewd and Lascivious Conduct" },
  { code: "314", label: "Indecent Exposure" },
  { code: "374", label: "Illegal Dumping" },
  { code: "390", label: "Drunk Person" },
  { code: "415", label: "Disturbing the Peace" },
  { code: "415a", label: "Disturbing the Peace; Automobile(s)" },
  { code: "415e", label: "Disturbing the Peace; Music or Party" },
  { code: "415F", label: "Disturbing the Peace; Firework(s)" },
  { code: "415g", label: "Disturbing the Peace (Gangs)" },
  { code: "417", label: "Subject with Gun" },
  { code: "451", label: "Arson" },
  { code: "459", label: "Burglary in Progress" },
  { code: "459a", label: "Burglary Alarm (Audible)" },
  { code: "459s", label: "Burglary Alarm (Silent)" },
  { code: "470", label: "Forgery" },
  { code: "480", label: "Hit and Run (Injury) Felony" },
  { code: "481", label: "Hit and Run (Non-Injury) Misdemeanor" },
  { code: "483", label: "Hit and Run (Parked Vehicle)" },
  { code: "484", label: "Theft/Larceny" },
  { code: "487", label: "Grand Theft" },
  { code: "488", label: "Petty Theft" },
  { code: "496", label: "Stolen Property" },
  { code: "502", label: "Drunk Driver" },
  { code: "503", label: "Stolen Vehicle" },
  { code: "504", label: "Car Tampering / Stripping" },
  { code: "505a", label: "Reckless Driving" },
  { code: "510", label: "Speeding or Racing Vehicle" },
  { code: "586", label: "Illegally Parked Vehicle" },
  { code: "594", label: "Vandalism (Malicious Mischief)" },
  { code: "602", label: "Trespassing" },
  { code: "901", label: "Traffic Accident; Unknown Injuries" },
  { code: "901t", label: "Traffic Accident Injuries" },
  { code: "902m", label: "Medical Aid" },
  { code: "902t", label: "Traffic Accident without Injuries" },
  { code: "904", label: "Fire" },
  { code: "904A", label: "Fire Alarm" },
  { code: "905b", label: "Animal Bite" },
  { code: "905n", label: "Animal Noise" },
  { code: "905s", label: "Stray Animal" },
  { code: "906", label: "Rescue" },
  { code: "909", label: "Traffic Information" },
  { code: "909c", label: "Traffic Control" },
  { code: "909t", label: "Traffic Hazard" },
  { code: "911B", label: "Contact Officer" },
  { code: "914a", label: "Attempt Suicide" },
  { code: "914s", label: "Suicide" },
  { code: "917a", label: "Abandoned Vehicle" },
  { code: "918", label: "Mental Subject" },
  { code: "918v", label: "Violent Mental Subject" },
  { code: "919", label: "Keep the Peace" },
  { code: "920a", label: "Missing Adult" },
  { code: "920c", label: "Missing Child" },
  { code: "920j", label: "Missing Juvenile" },
  { code: "921", label: "Prowler" },
  { code: "924", label: "Detail" },
  { code: "924d", label: "Station Detail" },
  { code: "924r", label: "Report Writing" },
  { code: "925", label: "Suspicious Person/Circumstances" },
  { code: "925v", label: "Suspicious Vehicle" },
  { code: "927", label: "Unknown Trouble" },
  { code: "930", label: "See the Man" },
  { code: "931", label: "See the Woman" },
  { code: "932", label: "Open Door" },
  { code: "933", label: "Open Window" },
  { code: "961", label: "Car Stop" },
  { code: "966a", label: "Shots heard; no suspect info" },
  { code: "982", label: "Bomb Threat" },
  { code: "983", label: "Explosion" },
  { code: "984", label: "Hazardous Material Spill" },
  { code: "995", label: "Riot or Major Disturbance" },
  { code: "CA", label: "Citizen Assist" },
  { code: "c5", label: "Code 5 - Stakeout" },
  { code: "c6", label: "Code 6 - Out for Investigation" },
  { code: "c7", label: "Code 7 - Lunch" },
  { code: "FU", label: "Follow Up" },
  { code: "info", label: "Information Only" },
  { code: "notice", label: "Issue Notice" },
  { code: "mi", label: "Maintenance Issue" },
  { code: "meet", label: "Meeting" },
  { code: "pc", label: "Patrol Check" },
  { code: "ped", label: "Pedestrian Stop" },
  { code: "prop", label: "Property Damage" },
  { code: "event", label: "Special Event" },
  { code: "post", label: "Standing Post" },
  { code: "task", label: "Task" },
  { code: "test", label: "Test Call (Do not Dispatch)" },
  { code: "Welfare", label: "Welfare Check" },
];

/** Radio shorthand not in the main list but used on SSA air. */
const CODE_ALIASES: Record<string, string> = {
  "907a": "pc",
  "907b": "911B",
};

/**
 * Format as 10-8 expects: numeric codes → "961 - Car Stop"; word codes → "Pedestrian Stop".
 */
export function formatTen8IncidentType(code: string, label: string): string {
  const c = code.trim();
  const l = label.trim();
  if (!c) {
    return l;
  }
  if (l.startsWith("Code ") || l.startsWith("10-")) {
    return l;
  }
  if (/^[0-9]/.test(c)) {
    return `${c} - ${l}`;
  }
  return l;
}

const TYPE_BY_CODE_LOWER: Map<string, string> = new Map();

for (const { code, label } of QUICK_CALL_ENTRIES) {
  TYPE_BY_CODE_LOWER.set(code.toLowerCase(), formatTen8IncidentType(code, label));
}

function matchKnownTen8Type(code: string, knownTypes: string[]): string | null {
  const want = code.trim().toLowerCase();
  if (!want) {
    return null;
  }
  for (const raw of knownTypes) {
    const t = raw?.trim();
    if (!t) {
      continue;
    }
    const sep = t.match(/^(.+?)\s+[-–—]\s+/);
    if (sep && sep[1]!.trim().toLowerCase() === want) {
      return t;
    }
    const lead = t.match(/^(\d{2,4}[A-Za-z]?)\b/i);
    if (lead && lead[1]!.toLowerCase() === want) {
      return t;
    }
    if (t.toLowerCase() === want) {
      return t;
    }
  }
  return null;
}

/**
 * Resolve AI `code` to the exact `type` string configured in 10-8 CAD.
 * Prefer a match from live webhook incident types when available.
 */
export function resolveTen8IncidentType(
  code: string | null | undefined,
  opts?: { knownTypes?: string[] },
): string {
  const raw = (code ?? "").trim();
  if (!raw) {
    return TEN8_DEFAULT_INCIDENT_TYPE;
  }

  const known = opts?.knownTypes ?? [];
  const fromActive = matchKnownTen8Type(raw, known);
  if (fromActive) {
    return fromActive;
  }

  const lower = raw.toLowerCase();
  const aliasTarget = CODE_ALIASES[lower];
  const mapped = TYPE_BY_CODE_LOWER.get(aliasTarget ?? lower);
  if (mapped) {
    return mapped;
  }

  console.warn(`[ten8] unknown quick-call code "${raw}" — using default type "${TEN8_DEFAULT_INCIDENT_TYPE}"`);
  return TEN8_DEFAULT_INCIDENT_TYPE;
}

/** All canonical type strings (for validation / admin tooling). */
export function listTen8IncidentTypes(): string[] {
  return [...new Set(TYPE_BY_CODE_LOWER.values())].sort();
}
