/**
 * Pure helpers for the Live Channel Control "delete emergency channel"
 * affordance.
 *
 * Why this lives in its own file:
 *
 *  - {@link decideEmergencyDelete} is the safety check that prevents an
 *    admin's click on the small `×` button on an emergency-channel header
 *    from accidentally deleting the *wrong* channel when the local
 *    channel-list state has gone stale (the bug PR #140 fixes).
 *
 *  - The original implementation kept the lookup as a `useMemo`-built
 *    `Map<name, id>` inside `LiveControlPanel.tsx` and called
 *    `api.deleteChannel(map.get(name))` directly. That is fundamentally
 *    racy: a different admin (or this admin in another tab) could create
 *    a non-emergency channel that the local map still has cached under
 *    an emergency-name slot, or rename the channel, or recycle the id.
 *
 *  - Pulling the decision out of the component lets a Node test exercise
 *    every branch deterministically without a React renderer or DOM.
 *
 * Regression risk if this logic breaks:
 *
 *  - **Wrong-channel delete** — admin clicks `×` next to "EMERGENCY 14:23",
 *    backend deletes "Operations" because the stale mapping still pointed
 *    `"EMERGENCY 14:23" → 7` and `7` has since been recycled. This is the
 *    bug PR #140 directly addresses.
 *
 *  - **Soft-deleted channel resurrected** — admin sees a phantom emergency
 *    channel because their local roster lags the server, and the click
 *    issues a 404 instead of being suppressed cleanly with a status message.
 *
 *  - **Non-emergency name slipping through** — if `isEmergencyChannelName`
 *    drifts (e.g. matches "Security Emergency" or "EmergencyBackup" as a
 *    word fragment) the `×` could appear on, or accept deletion of, a
 *    plain dispatch channel. The DELETE endpoint on the server does NOT
 *    re-check the emergency-name predicate — it accepts any channel id an
 *    admin sends — so this client-side guard is the **only** thing keeping
 *    the affordance safe.
 */

/** Channel descriptor as the live-control panel already shapes it. */
export interface ChannelLike {
  id: number;
  name: string;
}

/**
 * The emergency-channel endpoint always emits names that *start* with the
 * literal token "EMERGENCY" — see `POST /v1/channels/emergency` in
 * `server/src/apiRoutes.ts`. We anchor on that token only at the start of
 * the trimmed name and require either the end-of-string or a word boundary,
 * so:
 *
 *  - "EMERGENCY 14:23"   → emergency
 *  - "emergency-bravo"   → emergency
 *  - "Emergency"         → emergency  (admin-renamed back to bare token)
 *  - "Operations"        → not emergency
 *  - "Security Emergency"→ not emergency  (token must be at the start)
 *  - "EmergencyBackup"   → not emergency  (no boundary after token)
 */
export function isEmergencyChannelName(name: string): boolean {
  return /^emergency(\b|$)/i.test(name.trim());
}

/**
 * Decision returned by {@link decideEmergencyDelete}. Each variant maps to
 * exactly one user-visible outcome in `LiveControlPanel.tsx`:
 *
 *  - `refresh_failed` — the `/v1/channels` refresh threw; surface a generic
 *    "try again" message and do nothing.
 *  - `channel_missing` — the channel name no longer appears in the latest
 *    roster (deleted or renamed by another admin already); show a friendly
 *    message instead of attempting a likely-stale delete.
 *  - `not_emergency` — the name still resolves to a channel, but that
 *    channel is no longer emergency-named; refuse to delete it.
 *  - `confirm_delete` — safe to prompt the admin and call
 *    `api.deleteChannel(id)` against the **fresh** id.
 */
export type EmergencyDeleteDecision =
  | { kind: "refresh_failed" }
  | { kind: "channel_missing"; name: string }
  | { kind: "not_emergency"; name: string }
  | { kind: "confirm_delete"; id: number; name: string };

/**
 * Resolve a "delete emergency channel" click against a freshly fetched
 * channel list. Pure function — does not prompt, does not mutate state.
 *
 * @param channelName  The header that was clicked, exactly as displayed.
 * @param latestChannels  Result of a fresh `api.myChannels()` call, or
 *                        `null` if the refresh request itself failed.
 */
export function decideEmergencyDelete(
  channelName: string,
  latestChannels: ChannelLike[] | null,
): EmergencyDeleteDecision {
  if (latestChannels === null) {
    return { kind: "refresh_failed" };
  }
  // Match by name against the freshest data we have. Using id from a
  // local `useMemo` map is what caused PR #140 — by the time the operator
  // clicks `×`, the cached id can already point at a different channel.
  const channel = latestChannels.find((c) => c.name === channelName);
  if (!channel) {
    return { kind: "channel_missing", name: channelName };
  }
  if (!isEmergencyChannelName(channel.name)) {
    return { kind: "not_emergency", name: channel.name };
  }
  return { kind: "confirm_delete", id: channel.id, name: channel.name };
}
