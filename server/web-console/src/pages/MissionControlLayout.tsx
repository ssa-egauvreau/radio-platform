import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

const SPLIT_STORAGE_KEY = "securityradio.missionChannelsColPct";
const DEFAULT_CHANNELS_PCT = 58;
const MIN_CHANNELS_PCT = 32;
const MAX_CHANNELS_PCT = 78;

function loadChannelsPct(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && n >= MIN_CHANNELS_PCT && n <= MAX_CHANNELS_PCT) {
      return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CHANNELS_PCT;
}

/** Mission Control: resizable split between channels (left) and map/alerts (right). */
export function MissionControlLayout({
  channels,
  mapAlerts,
}: {
  channels: ReactNode;
  mapAlerts: ReactNode;
}) {
  const [channelsPct, setChannelsPct] = useState(loadChannelsPct);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(channelsPct));
    } catch {
      /* storage unavailable */
    }
  }, [channelsPct]);

  const beginColSplit = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }
      const rect = layout.getBoundingClientRect();
      const startX = e.clientX;
      const startPct = channelsPct;

      function onMove(ev: globalThis.PointerEvent) {
        const dx = ev.clientX - startX;
        const next = startPct + (dx / rect.width) * 100;
        setChannelsPct(Math.max(MIN_CHANNELS_PCT, Math.min(MAX_CHANNELS_PCT, next)));
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [channelsPct],
  );

  return (
    <div ref={layoutRef} className="mission-control-layout">
      <div className="mission-control-channels console-col" style={{ flex: `${channelsPct} 1 0` }}>
        {channels}
      </div>
      <button
        type="button"
        className="mission-control-col-splitter"
        aria-label="Resize channels and map areas"
        onPointerDown={beginColSplit}
      />
      <div
        className="mission-control-map-alerts console-col map-alerts-col"
        style={{ flex: `${100 - channelsPct} 1 0` }}
      >
        {mapAlerts}
      </div>
    </div>
  );
}
