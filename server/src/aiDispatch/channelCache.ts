import { normalizedChannel } from "../presence.js";

/** In-memory mirror of channel_ai_dispatch for hot paths (recorder, voice relay). */
const enabledByAgencyChannel = new Map<string, boolean>();

function cacheKey(agencyId: number, channelName: string): string {
  return `${agencyId}:${normalizedChannel(channelName)}`;
}

export function setAiDispatchChannelCached(
  agencyId: number,
  channelName: string,
  enabled: boolean,
): void {
  enabledByAgencyChannel.set(cacheKey(agencyId, channelName), enabled);
}

export function isAiDispatchChannelCached(agencyId: number, channelName: string): boolean {
  return enabledByAgencyChannel.get(cacheKey(agencyId, channelName)) === true;
}

/** Warm cache at startup from DB rows. */
export function warmAiDispatchChannelCache(
  rows: Array<{ agency_id: number; channel_name: string }>,
): void {
  enabledByAgencyChannel.clear();
  for (const row of rows) {
    setAiDispatchChannelCached(row.agency_id, row.channel_name, true);
  }
}
