import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
const MapPanel = lazy(() => import("./MapPanel").then((m) => ({ default: m.MapPanel })));
import { AlertsPanel } from "./AlertsPanel";
import { PopOutSection } from "./PopOutSection";

const SPLIT_STORAGE_KEY = "securityradio.mapAlertsSplitPct";
const DEFAULT_MAP_PCT = 58;
const MIN_MAP_PCT = 28;
const MAX_MAP_PCT = 82;

function loadSplitPct(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && n >= MIN_MAP_PCT && n <= MAX_MAP_PCT) {
      return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MAP_PCT;
}

/** Right column: resizable map (top) and alerts (bottom). */
export function MapAlertsColumn() {
  const [mapPct, setMapPct] = useState(loadSplitPct);
  const [mapReady, setMapReady] = useState(false);
  const columnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMapReady(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(mapPct));
    } catch {
      /* storage unavailable */
    }
  }, [mapPct]);

  const beginSplitDrag = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const col = columnRef.current;
    if (!col) {
      return;
    }
    const rect = col.getBoundingClientRect();
    const startY = e.clientY;
    const startPct = mapPct;

    function onMove(ev: globalThis.PointerEvent) {
      const dy = ev.clientY - startY;
      const next = startPct + (dy / rect.height) * 100;
      setMapPct(Math.max(MIN_MAP_PCT, Math.min(MAX_MAP_PCT, next)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [mapPct]);

  return (
    <div ref={columnRef} className="map-alerts-column">
      <div className="map-alerts-map" style={{ flex: `${mapPct} 1 0` }}>
        {mapReady ? (
          <Suspense fallback={<div className="empty">Loading map…</div>}>
            <MapPanel />
          </Suspense>
        ) : (
          <div className="empty">Loading map…</div>
        )}
      </div>
      <button
        type="button"
        className="map-alerts-splitter"
        aria-label="Resize map and alerts areas"
        onPointerDown={beginSplitDrag}
      />
      <div className="map-alerts-alerts" style={{ flex: `${100 - mapPct} 1 0` }}>
        <PopOutSection
          title="Alerts & Paging"
          route="/console/alerts"
          windowName="safetConsoleAlerts"
          width={480}
          height={820}
          render={(onPopOut) => <AlertsPanel onPopOut={onPopOut} />}
        />
      </div>
    </div>
  );
}
