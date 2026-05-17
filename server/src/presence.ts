/**
 * Lightweight in-memory channel presence, keyed by agency + normalized channel
 * label so two tenants with the same channel name never share a presence bucket.
 */

const TTL_MS = 45_000;
const presence = new Map<string, Map<string, number>>(); // agency:channel -> unit -> lastHeartbeatMs

export function normalizedChannel(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Composite presence key namespacing a normalized channel under its agency. */
function presenceKey(agencyId: number, channelNorm: string): string {
  return `${agencyId} ${channelNorm}`;
}

function prunePresence(now: number): void {
  const cutoff = now - TTL_MS;
  const channels = [...presence.entries()];
  for (const [ch, units] of channels) {
    const entries = [...units.entries()];
    for (const [u, ts] of entries) {
      if (ts < cutoff) units.delete(u);
    }
    if (units.size === 0) presence.delete(ch);
  }
}

export function heartbeatPresence(
  agencyId: number,
  unitIdRaw: unknown,
  channelRaw: unknown,
): { ok: boolean; error?: string } {
  const unit = String(unitIdRaw ?? "").trim().toUpperCase();
  const ch = normalizedChannel(channelRaw);
  if (!unit || !ch || ch === "----") {
    return { ok: false, error: "bad_unit_or_channel" };
  }
  const key = presenceKey(agencyId, ch);
  const now = Date.now();
  prunePresence(now);
  if (!presence.has(key)) presence.set(key, new Map());
  presence.get(key)!.set(unit, now);
  return { ok: true };
}

export function countPresence(agencyId: number, channelRaw: unknown): number {
  const ch = normalizedChannel(channelRaw);
  const now = Date.now();
  prunePresence(now);
  return presence.get(presenceKey(agencyId, ch))?.size ?? 0;
}
