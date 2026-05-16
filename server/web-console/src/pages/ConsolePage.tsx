import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { api, describeError, type Permission, type UserChannel } from "../api";
import { VoiceChannelClient, type VoiceState, type ToneOutKind } from "../voice/voiceClient";
import { TransmissionLog } from "./TransmissionLog";
import { MapPanel } from "./MapPanel";
import { AlertsPanel } from "./AlertsPanel";
import { ChannelRoster } from "./ChannelRoster";
import { sounds } from "../sounds";
import { ThemeToggle } from "../ThemeToggle";
import {
  IconBolt,
  IconBeacon,
  IconRadio,
  IconLogOut,
  IconShield,
  IconToneRoutine,
  IconTonePriority,
  IconToneStatus,
  IconStop,
} from "../icons";

const PERMISSION_LABEL: Record<Permission, string> = {
  talk_priority: "Talk priority",
  talk: "Talk",
  listen_only: "Listen only",
};

const STATE_LABEL: Record<VoiceState, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  listening: "Listening",
  transmitting: "On air",
  error: "Error",
  closed: "Disconnected",
};

const LAST_CHANNEL_KEY = "securityradio.lastChannel";
const TX_DIGITAL_KEY = "securityradio.txDigital";

export function ConsolePage() {
  const { user, logout } = useAuth();
  const [channels, setChannels] = useState<UserChannel[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeChannel, setActiveChannel] = useState<UserChannel | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceDetail, setVoiceDetail] = useState<string | null>(null);
  const [permission, setPermission] = useState<Permission | null>(null);
  const [marker33, setMarker33] = useState(false);
  const [txDigital, setTxDigital] = useState(() => localStorage.getItem(TX_DIGITAL_KEY) !== "0");

  const clientRef = useRef<VoiceChannelClient | null>(null);

  function selectChannel(channel: UserChannel) {
    const busy = voiceState === "connecting" || voiceState === "listening" || voiceState === "transmitting";
    if (activeChannel?.id === channel.id && busy) {
      return;
    }
    clientRef.current?.close();
    sounds.channelSwitch();
    localStorage.setItem(LAST_CHANNEL_KEY, String(channel.id));
    setActiveChannel(channel);
    setVoiceDetail(null);
    setPermission(channel.permission);
    setMarker33(false);
    const client = new VoiceChannelClient(channel.name, {
      onState: (state, detail) => {
        setVoiceState(state);
        setVoiceDetail(detail ?? null);
      },
      onPermission: (perm) => setPermission(perm),
    });
    client.setDigitalTx(txDigital);
    clientRef.current = client;
    client.connect();
  }

  function disconnect() {
    clientRef.current?.close();
    clientRef.current = null;
    setActiveChannel(null);
    setVoiceState("idle");
    setVoiceDetail(null);
    setPermission(null);
    setMarker33(false);
  }

  function toggleMarker() {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    const next = !marker33;
    client.setChannelMarker(next);
    setMarker33(next);
  }

  function sendTone(kind: ToneOutKind) {
    clientRef.current?.sendToneOut(kind);
  }

  function stopAllSounds() {
    clientRef.current?.stopAllTones();
    sounds.stopAll();
    setMarker33(false);
  }

  async function startTx() {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    try {
      await client.startTransmit();
      sounds.permit();
    } catch (err) {
      setVoiceDetail(
        err instanceof Error && err.message === "listen_only"
          ? "You have listen-only access on this channel."
          : "Microphone unavailable or permission denied.",
      );
    }
  }

  function stopTx() {
    clientRef.current?.stopTransmit();
  }

  function beginTransmit(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    void startTx();
  }

  function toggleTxMode() {
    const next = !txDigital;
    setTxDigital(next);
    localStorage.setItem(TX_DIGITAL_KEY, next ? "1" : "0");
    clientRef.current?.setDigitalTx(next);
  }

  // Latest handlers/data reachable from the once-mounted keyboard listener.
  const opsRef = useRef({ channels, selectChannel, startTx, stopTx });
  opsRef.current = { channels, selectChannel, startTx, stopTx };

  useEffect(() => {
    sounds.preload();
    let autoSelected = false;
    api
      .myChannels()
      .then((res) => {
        setChannels(res.channels);
        const lastId = Number(localStorage.getItem(LAST_CHANNEL_KEY));
        const last = res.channels.find((c) => c.id === lastId);
        if (last && !autoSelected) {
          autoSelected = true;
          opsRef.current.selectChannel(last);
        }
      })
      .catch((err) => setListError(describeError(err)))
      .finally(() => setLoading(false));
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  // Keyboard: Space = hold-to-talk PTT, digit keys = select that channel.
  useEffect(() => {
    let spaceHeld = false;
    function inField(): boolean {
      const el = document.activeElement;
      return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (inField() || e.metaKey || e.ctrlKey || e.altKey || e.repeat) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (!spaceHeld) {
          spaceHeld = true;
          void opsRef.current.startTx();
        }
        return;
      }
      if (e.code.startsWith("Digit")) {
        const channel = opsRef.current.channels[Number(e.code.slice(5)) - 1];
        if (channel) {
          e.preventDefault();
          opsRef.current.selectChannel(channel);
        }
      }
    }
    function release() {
      if (spaceHeld) {
        spaceHeld = false;
        opsRef.current.stopTx();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        release();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  const connected = voiceState === "listening" || voiceState === "transmitting";
  const canTransmit = permission !== null && permission !== "listen_only";
  const transmitting = voiceState === "transmitting";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          SECURITY RADIO <span>· Console</span>
        </div>
        <nav className="topnav">
          {user?.role === "admin" && (
            <Link to="/admin" className="icon-link">
              <IconShield size={15} /> Admin Portal
            </Link>
          )}
        </nav>
        <div className="who">
          <span className="role-chip">{user?.role}</span>
          <span>{user?.displayName}</span>
          <ThemeToggle />
          <button className="btn sm icon-btn" onClick={logout}>
            <IconLogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      <div className="console-grid">
        <div className="console-col">
          <h3>Channels</h3>
          {loading && <div className="empty">Loading…</div>}
          {listError && <div className="banner error">{listError}</div>}
          {!loading && !listError && channels.length === 0 && (
            <div className="empty">No channels assigned to this account.</div>
          )}
          {channels.map((channel, index) => {
            const active = activeChannel?.id === channel.id;
            const showZone = !!channel.zone && channel.zone !== (channels[index - 1]?.zone ?? null);
            return (
              <Fragment key={channel.id}>
                {showZone && <div className="zone-header">{channel.zone}</div>}
                <button
                  className={active ? "chan-item active" : "chan-item"}
                  onClick={() => selectChannel(channel)}
                  style={channel.color ? { boxShadow: `inset 4px 0 0 ${channel.color}` } : undefined}
                >
                  <span className="chan-name">
                    <IconRadio size={14} />
                    {channel.name}
                  </span>
                  <span className="perm">
                    {index < 9 && <span className="chan-key">{index + 1}</span>}
                    {PERMISSION_LABEL[channel.permission]}
                  </span>
                </button>
              </Fragment>
            );
          })}
          {channels.length > 0 && (
            <div className="kbd-hint">Keys 1–9 select · Space = PTT</div>
          )}
        </div>

        <div className="console-col">
          <h3>Live Audio</h3>
          {!activeChannel ? (
            <div className="placeholder-box">
              <strong>No channel selected</strong>
              Pick a channel on the left to start monitoring.
            </div>
          ) : (
            <div className="live-panel">
              <div className="live-head">
                <div className="live-channel">{activeChannel.name}</div>
                <span className={`state-chip ${voiceState}`}>{STATE_LABEL[voiceState]}</span>
              </div>
              <div className="live-meta">
                Permission: <strong>{permission ? PERMISSION_LABEL[permission] : "—"}</strong>
              </div>
              {voiceDetail && (
                <div className={`banner ${voiceState === "error" ? "error" : "info"}`}>{voiceDetail}</div>
              )}

              <button
                className={transmitting ? "tx-button active" : "tx-button"}
                disabled={!connected || !canTransmit}
                onPointerDown={beginTransmit}
                onPointerUp={stopTx}
                onPointerCancel={stopTx}
              >
                <span className="tx-main">
                  <IconBolt size={26} />
                  {transmitting ? "ON AIR" : canTransmit ? "XMIT" : "LISTEN ONLY"}
                </span>
                <span className="tx-sub">
                  {transmitting
                    ? "release to stop"
                    : !canTransmit
                      ? "no transmit permission"
                      : connected
                        ? "hold to talk · space"
                        : "connecting…"}
                </span>
              </button>

              <button className="txmode-btn" onClick={toggleTxMode}>
                TX MODE: <strong>{txDigital ? "DIGITAL · P25" : "ANALOG"}</strong>
              </button>

              <button
                className={marker33 ? "marker-button active" : "marker-button"}
                disabled={!connected || !canTransmit}
                onClick={toggleMarker}
              >
                <IconBeacon size={18} />
                <span>{marker33 ? "10-33 MARKER ON" : "10-33 CHANNEL MARKER"}</span>
              </button>
              {marker33 && <div className="marker-note">Emergency traffic — marker tone every 12s</div>}

              <div className="toneout">
                <div className="toneout-row">
                  <button
                    className="toneout-btn"
                    disabled={!connected || !canTransmit}
                    onClick={() => sendTone("routine")}
                  >
                    <IconToneRoutine size={16} />
                    Routine
                  </button>
                  <button
                    className="toneout-btn priority"
                    disabled={!connected || !canTransmit}
                    onClick={() => sendTone("priority")}
                  >
                    <IconTonePriority size={16} />
                    Priority
                  </button>
                  <button
                    className="toneout-btn"
                    disabled={!connected || !canTransmit}
                    onClick={() => sendTone("status")}
                  >
                    <IconToneStatus size={16} />
                    Status
                  </button>
                </div>
                <button className="stopall-btn" onClick={stopAllSounds}>
                  <IconStop size={16} />
                  Stop All Sounds
                </button>
              </div>

              <div className="live-actions">
                {(voiceState === "error" || voiceState === "closed") && (
                  <button className="btn sm" onClick={() => selectChannel(activeChannel)}>
                    Reconnect
                  </button>
                )}
                <button className="btn sm" onClick={disconnect}>
                  Leave channel
                </button>
              </div>

              <ChannelRoster channelName={activeChannel.name} />
            </div>
          )}

          <TransmissionLog />
        </div>

        <div className="console-col">
          <MapPanel />
          <AlertsPanel />
        </div>
      </div>
    </div>
  );
}
