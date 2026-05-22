import { useEffect } from "react";
import { bindLostLinkBusyAlerts, sounds } from "../sounds";
import { Topbar } from "../Topbar";
import { ChannelsPanel } from "./ChannelsPanel";
import { MapAlertsColumn } from "./MapAlertsColumn";
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

      <p className="mission-control-intro">
        <Link to="/console/ai-activity">AI dispatch activity log</Link>
        <span className="muted"> — transcripts, 10-33, plate lookups, 10-8 CAD notes</span>
      </p>

      <div className="console-grid mission-control-grid">
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

        <div className="console-col map-alerts-col">
          <MapAlertsColumn />
        </div>
      </div>
    </div>
  );
}
