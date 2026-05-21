import { setChannelTen33 } from "../store.js";
import { playMarkerToneOnChannel } from "./markerTone.js";

const MARKER_INTERVAL_MS = 12_000;

type LoopKey = string;

const markerLoops = new Map<LoopKey, ReturnType<typeof setInterval>>();

function loopKey(agencyId: number, channelName: string): LoopKey {
  return `${agencyId}:${channelName}`;
}

function stopTen33MarkerLoop(agencyId: number, channelName: string): void {
  const key = loopKey(agencyId, channelName);
  const timer = markerLoops.get(key);
  if (timer) {
    clearInterval(timer);
    markerLoops.delete(key);
  }
}

function startTen33MarkerLoop(opts: {
  loopbackPort: number;
  agencyId: number;
  channelName: string;
  unitId: string;
}): void {
  const key = loopKey(opts.agencyId, opts.channelName);
  stopTen33MarkerLoop(opts.agencyId, opts.channelName);
  const tick = () => {
    void playMarkerToneOnChannel(opts).catch((err) => {
      console.warn(`[ai-dispatch] 10-33 marker tone failed channel=${opts.channelName}`, err);
    });
  };
  tick();
  markerLoops.set(key, setInterval(tick, MARKER_INTERVAL_MS));
}

/**
 * Sets the safeT 10-33 channel marker (DB + repeating marker tone on the channel).
 * Matches the dispatch console "10-33 CHANNEL MARKER" button behavior for radios and listeners.
 */
export async function applyChannelTen33Marker(opts: {
  loopbackPort: number;
  agencyId: number;
  channelName: string;
  active: boolean;
  markerUnitId: string;
  source: "regex" | "ai" | "manual";
}): Promise<void> {
  const channel = opts.channelName.trim();
  if (!channel) {
    return;
  }
  await setChannelTen33(opts.agencyId, channel, opts.active);
  if (opts.active) {
    startTen33MarkerLoop({
      loopbackPort: opts.loopbackPort,
      agencyId: opts.agencyId,
      channelName: channel,
      unitId: opts.markerUnitId,
    });
    console.log(`[ai-dispatch] 10-33 ON channel=${channel} source=${opts.source}`);
  } else {
    stopTen33MarkerLoop(opts.agencyId, channel);
    console.log(`[ai-dispatch] 10-34 / clear 10-33 channel=${channel} source=${opts.source}`);
  }
}
