/**
 * SSA / 10-8 CAD call types — exact `type` strings and per-type priority from agency config.
 * AI `code` field = shortcut (middle column). API `type` = first column verbatim.
 */

import cadCallTypesJson from "./data/cadCallTypes.json" with { type: "json" };

export type CadCallTypeRow = {
  shortcut: string;
  type: string;
  priority: number;
};

const CAD_CALL_TYPES = cadCallTypesJson as CadCallTypeRow[];

export const TEN8_DEFAULT_INCIDENT_TYPE = "Patrol Check";

const BY_SHORTCUT: Map<string, CadCallTypeRow> = new Map();
const BY_TYPE_LOWER: Map<string, CadCallTypeRow> = new Map();

for (const row of CAD_CALL_TYPES) {
  BY_SHORTCUT.set(row.shortcut.toLowerCase(), row);
  BY_TYPE_LOWER.set(row.type.toLowerCase(), row);
}

function normalizeShortcutKey(code: string): string {
  return code.trim().toLowerCase();
}

function matchKnownTypeString(type: string, knownTypes: string[]): string | null {
  const want = type.trim().toLowerCase();
  for (const raw of knownTypes) {
    const t = raw?.trim();
    if (t && t.toLowerCase() === want) {
      return t;
    }
  }
  return null;
}

export function lookupCadCallType(shortcut: string | null | undefined): CadCallTypeRow | null {
  const key = normalizeShortcutKey(shortcut ?? "");
  if (!key) {
    return BY_SHORTCUT.get("pc") ?? null;
  }
  return BY_SHORTCUT.get(key) ?? null;
}

/**
 * Resolve AI quick-call shortcut to exact 10-8 `type` string (first column in CAD table).
 */
export function resolveTen8IncidentType(
  code: string | null | undefined,
  opts?: { knownTypes?: string[] },
): string {
  const row = lookupCadCallType(code);
  if (row) {
    const fromWebhook = matchKnownTypeString(row.type, opts?.knownTypes ?? []);
    return fromWebhook ?? row.type;
  }

  const raw = (code ?? "").trim();
  if (raw) {
    console.warn(
      `[ten8] unknown shortcut "${raw}" — using default type "${TEN8_DEFAULT_INCIDENT_TYPE}"`,
    );
  }
  return TEN8_DEFAULT_INCIDENT_TYPE;
}

/** Priority 1–4 from CAD table for this shortcut (never 0). */
export function resolveTen8PriorityForCode(code: string | null | undefined, intent?: string): number {
  if (intent === "emergency") {
    return 1;
  }
  const row = lookupCadCallType(code);
  if (row) {
    return clampPriority(row.priority);
  }
  return 4;
}

export function clampPriority(value: unknown, fallback = 4): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  if (n > 4) {
    return 4;
  }
  return Math.round(n);
}

export function listTen8IncidentTypes(): string[] {
  return CAD_CALL_TYPES.map((r) => r.type);
}
