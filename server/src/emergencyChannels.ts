/** Shared emergency-channel name rules across UI + API safeguards. */
export const EMERGENCY_CHANNEL_NAME_SQL_REGEX = "^emergency(\\y|$)";

/** Names produced by the emergency-channel flow always start with "EMERGENCY". */
export function isEmergencyChannelName(name: string): boolean {
  return /^emergency(\b|$)/i.test(name.trim());
}
