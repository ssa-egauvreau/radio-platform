import { useEffect, useMemo, useState } from "react";
import { Topbar } from "../Topbar";
import { api, type ChannelMember } from "../api";
import { useUnitAliasResolver } from "../unitAliases";
import { IconRadio, IconUser } from "../icons";

const POLL_MS = 4000;

const MOVE_REASONS = [
  "Reassigned",
  "Emergency response",
  "Wrong channel",
  "Noise control",
  "Training",
  "Supervisor request",
  "Other",
] as const;

interface ChannelGroup {
  channel: string;
  members: ChannelMember[];
}

/**
 * Live Channel Control — a control-room view of every channel and the units on
 * it. Drag a unit onto another channel to live-move them (the unit's radio
 * retunes and shows a "you were moved" banner). Admin/dispatcher only.
 */
export function LiveControlPage() {
  const aliasFor = useUnitAliasResolver();
  const [rosters, setRosters] = useState<ChannelGroup[]>([]);
  const [allChannels, setAllChannels] = useState<string[]>([]);
  const [reason, setReason] = useState<(typeof MOVE_REASONS)[number]>("Reassigned");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myChannels()
      .then((res) => setAllChannels(res.channels.map((c) => c.name)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await api.channelRosters();
        if (!cancelled) {
          setRosters(res.channels);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load live channel state.");
        }
      }
    }
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Every channel to show as a drop target: assigned channels plus any that
  // currently have members (deduped, sorted).
  const channels = useMemo(() => {
    const map = new Map<string, ChannelMember[]>();
    for (const name of allChannels) {
      map.set(name, []);
    }
    for (const group of rosters) {
      map.set(group.channel, group.members);
    }
    return [...map.entries()]
      .map(([channel, members]) => ({ channel, members }))
      .sort((a, b) => a.channel.localeCompare(b.channel));
  }, [allChannels, rosters]);

  async function move(unitId: string, fromChannel: string, toChannel: string) {
    if (fromChannel === toChannel) {
      return;
    }
    setStatus(null);
    try {
      const res = await api.moveUnit({ unitId, fromChannel, toChannel, reason });
      setStatus(
        res.reached > 0
          ? `Moved ${aliasFor(unitId)} to ${toChannel}.`
          : `${aliasFor(unitId)} isn't connected — move not delivered.`,
      );
      const fresh = await api.channelRosters();
      setRosters(fresh.channels);
    } catch {
      setError(`Could not move ${aliasFor(unitId)}.`);
    }
  }

  return (
    <div className="app-shell">
      <Topbar section="console" />
      <div className="lcc">
        <div className="lcc-head">
          <h1>Live Channel Control</h1>
          <label className="lcc-reason">
            Move reason
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              {MOVE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="lcc-hint">
          Drag a unit from one channel onto another to move them live. They&apos;ll retune and see a
          &ldquo;you were moved&rdquo; banner. Every move is written to the audit log.
        </p>

        {error && <div className="banner error">{error}</div>}
        {status && <div className="banner info">{status}</div>}

        <div className="lcc-grid">
          {channels.map((group) => (
            <section
              key={group.channel}
              className={`lcc-channel${dragOver === group.channel ? " drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(group.channel);
              }}
              onDragLeave={() => setDragOver((c) => (c === group.channel ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const unit = e.dataTransfer.getData("text/unit");
                const from = e.dataTransfer.getData("text/from");
                if (unit) {
                  void move(unit, from, group.channel);
                }
              }}
            >
              <div className="lcc-channel-head">
                <IconRadio size={14} />
                <span className="lcc-channel-name">{group.channel}</span>
                <span className="count">{group.members.length}</span>
              </div>
              {group.members.length === 0 ? (
                <div className="lcc-empty">Drop a unit here</div>
              ) : (
                group.members.map((m) => (
                  <div
                    key={`${m.unit_id}-${m.kind}`}
                    className="lcc-unit"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/unit", m.unit_id);
                      e.dataTransfer.setData("text/from", group.channel);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    title="Drag to another channel to move this unit"
                  >
                    <IconUser size={13} />
                    <span className="lcc-unit-name">{m.display_name || aliasFor(m.unit_id)}</span>
                    {m.kind === "legacy" && <span className="roster-tag">radio</span>}
                  </div>
                ))
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
