import { useEffect } from "react";
import { bindLostLinkBusyAlerts, sounds } from "../sounds";
import { Topbar } from "../Topbar";
import { MapPanel } from "./MapPanel";
import { AlertsPanel } from "./AlertsPanel";
import { ChannelsPanel } from "./ChannelsPanel";
import { Link } from "react-router-dom";
import { PopOutSection } from "./PopOutSection";

export function ConsolePage() {
  useEffect(() => {
    sounds.preload();
    const stopSoundSync = sounds.startAutoRefresh();
    const stopLostLink = bindLostLinkBusyAlerts();
    return () => {
      stopSoundSync();
      stopLostLink();
    };
  }, []);

  return (
    <div className="app-shell">
      <Topbar section="console" />

      <p style={{ padding: "0.5rem 1rem 0", margin: 0 }}>
        <Link to="/console/ai-activity">AI dispatch activity log</Link>
        <span className="muted"> — transcripts, 10-33, plate lookups, 10-8 CAD notes</span>
      </p>

      <div className="console-grid">
        <div className="console-col">
          <PopOutSection
            title="Channels"
            route="/console/channels"
            windowName="safetConsoleChannels"
            width={720}
            height={900}
            render={(onPopOut) => <ChannelsPanel onPopOut={onPopOut} />}
          />
        </div>

        <div className="console-col">
          <MapPanel />
          <div className="alerts-slot">
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
      </div>
    </div>
  );
}
