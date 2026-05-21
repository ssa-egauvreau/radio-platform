import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, type UserChannel } from "../api";
import { useAuth } from "../auth";
import { sounds } from "../sounds";
import { ChannelPanel } from "./ChannelPanel";
import { QuickReplay } from "./QuickReplay";
import { TransmissionLog } from "./TransmissionLog";
import { SimulcastManager } from "./SimulcastManager";
import { SectionHeader, type SectionProps } from "./PopOutSection";
import { keyLabel } from "./consoleShared";
import {
  focusChannel,
  reconcileChannels,
  setChannelMonitoring,
  setKeyboardOn,
  setPrimaryChannel,
  setPttCode,
  toggleChannelExpanded,
  useConsoleState,
} from "../consoleStore";

/**
 * The "Channels" section — every channel the account may use, each as a
 * collapsible row. Collapsed rows show the name, an on/off (monitor) toggle, and
 * a quick PTT button; expanding a row reveals its full control surface.
 */
export function ChannelsPanel({ variant = "embedded", onPopOut }: SectionProps) {
  const { user } = useAuth();
  const { open, expanded, primary, pttCode, keyboardOn } = useConsoleState();
  const [channels, setChannels] = useState<UserChannel[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [simulcastOpen, setSimulcastOpen] = useState(false);
  const [rebindingPtt, setRebindingPtt] = useState(false);
  const canSimulcast = user?.role === "admin" || user?.role === "dispatcher";

  const refreshChannels = useCallback(() => {
    api
      .myChannels()
      .then((res) => {
        setChannels(res.channels);
        reconcileChannels(res.channels.map((c) => c.id));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .myChannels()
      .then((res) => {
        setChannels(res.channels);
        reconcileChannels(res.channels.map((c) => c.id));
      })
      .catch((err) => setListError(describeError(err)))
      .finally(() => setLoading(false));
  }, []);

  function toggleKeyboard() {
    const next = !keyboardOn;
    setKeyboardOn(next);
    if (!next) {
      setRebindingPtt(false);
    }
  }

  // Latest data reachable from the once-mounted keyboard listener.
  const opsRef = useRef({ channels, keyboardOn });
  opsRef.current = { channels, keyboardOn };

  // Keyboard: digit keys 1–9 turn on + expand that channel (PTT is per-panel).
  useEffect(() => {
    function inField(): boolean {
      const el = document.activeElement;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!opsRef.current.keyboardOn || inField() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) {
        return;
      }
      if (e.code.startsWith("Digit")) {
        const channel = opsRef.current.channels[Number(e.code.slice(5)) - 1];
        if (channel) {
          e.preventDefault();
          sounds.channelSwitch();
          focusChannel(channel.id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // PTT-key rebinding: capture the next keypress (Escape cancels). The capture
  // phase + stopPropagation keeps that keypress from also triggering transmit.
  useEffect(() => {
    if (!rebindingPtt) {
      return;
    }
    function capture(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") {
        setPttCode(e.code);
      }
      setRebindingPtt(false);
    }
    window.addEventListener("keydown", capture, { capture: true });
    return () => window.removeEventListener("keydown", capture, { capture: true });
  }, [rebindingPtt]);

  return (
    <div className={variant === "window" ? "section-panel windowed" : "section-panel"}>
      <SectionHeader title="Channels" onPopOut={onPopOut} />
      <QuickReplay />

      {loading && <div className="empty">Loading…</div>}
      {listError && <div className="banner error">{listError}</div>}
      {!loading && !listError && channels.length === 0 && (
        <div className="empty">No channels assigned to this account.</div>
      )}

      <div className="channel-accordion">
        {channels.map((channel, index) => {
          const showZone = !!channel.zone && channel.zone !== (channels[index - 1]?.zone ?? null);
          return (
            <Fragment key={channel.id}>
              {showZone && <div className="zone-header">{channel.zone}</div>}
              <ChannelPanel
                channel={channel}
                monitoring={open.includes(channel.id)}
                expanded={expanded.includes(channel.id)}
                primary={primary === channel.id}
                pttCode={pttCode}
                keyboardOn={keyboardOn}
                onToggleMonitor={() =>
                  setChannelMonitoring(channel.id, !open.includes(channel.id))
                }
                onToggleExpanded={() => toggleChannelExpanded(channel.id)}
                onMakePrimary={() => setPrimaryChannel(channel.id)}
              />
            </Fragment>
          );
        })}
      </div>

      {channels.length > 0 && (
        <div className="kbd-hint">
          <button
            className={keyboardOn ? "kbd-toggle on" : "kbd-toggle"}
            onClick={toggleKeyboard}
            title="Enable or disable all keyboard shortcuts"
          >
            Keyboard shortcuts: {keyboardOn ? "On" : "Off"}
          </button>
          {keyboardOn && (
            <div className="kbd-keys">
              Keys 1–9 open · PTT{" "}
              <button
                className={rebindingPtt ? "key-rebind active" : "key-rebind"}
                onClick={() => setRebindingPtt((v) => !v)}
                title="Click, then press a key to rebind push-to-talk"
              >
                {rebindingPtt ? "press a key…" : keyLabel(pttCode)}
              </button>
            </div>
          )}
        </div>
      )}

      {canSimulcast && !loading && !listError && (
        <button
          className="btn sm"
          style={{ marginTop: 10, width: "100%" }}
          onClick={() => setSimulcastOpen(true)}
        >
          Manage simulcast
        </button>
      )}

      <TransmissionLog />

      {simulcastOpen && (
        <SimulcastManager
          channels={channels}
          onClose={() => setSimulcastOpen(false)}
          onChanged={refreshChannels}
        />
      )}
    </div>
  );
}
