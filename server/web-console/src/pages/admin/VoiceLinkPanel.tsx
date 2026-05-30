import { useEffect, useMemo, useState } from "react";
import {
  api,
  describeError,
  type Channel,
  type VoiceLinkCodecEntry,
  type VoiceLinkTimeseriesPoint,
  type VoiceLinkUnitSummary,
} from "../../api";
import {
  EmptyState,
  ErrorState,
  LineChart,
  LoadingState,
  TimeRangeSelector,
  type AnalyticsRange,
  ANALYTICS_RANGES,
} from "../../components/ui";

/**
 * "Link Health" admin panel — surfaces per-unit inbound voice link quality from
 * the new `/v1/admin/voice-link-telemetry` aggregate so an operator can answer
 * "is this unit having voice problems?" with data instead of trusting an
 * end-user report.
 *
 * Layout follows the same pattern as ChannelsPanel / AudioLabPanel:
 *   - Panel head with title + count.
 *   - Filter card: time range, channel filter, unit-id search.
 *   - Units table: row per unit with last-seen, PLC ratio, underruns, codec
 *     mix, health badge.
 *   - Selecting a row reveals the per-unit time-series detail (three small
 *     line charts: PLC %, buffer underruns, decoded frames per window).
 *
 * Charts reuse the shared `LineChart` primitive — no new chart library.
 */

type LoadState = "idle" | "loading" | "ready" | "error";

interface HealthClassification {
  badge: "green" | "yellow" | "red" | "unknown";
  label: string;
  description: string;
}

function rangeToMs(range: AnalyticsRange): number {
  const entry = ANALYTICS_RANGES.find((r) => r.value === range);
  return (entry?.days ?? 1) * 24 * 60 * 60 * 1000;
}

function plcRatio(plc: number, decoded: number): number {
  if (!Number.isFinite(plc) || plc <= 0) return 0;
  if (!Number.isFinite(decoded) || decoded <= 0) return plc > 0 ? 1 : 0;
  return Math.min(1, plc / (plc + decoded));
}

/** Mirrors the server-side `classifyHealth` thresholds so the badge stays
 *  consistent whether the aggregate is rendered server-side or fresh from a
 *  re-derived client view. The duplicate is small; the consistency is worth
 *  it. */
function classify(u: VoiceLinkUnitSummary): HealthClassification {
  if (u.frames_decoded === 0 && u.plc_frames_synthesized === 0) {
    return {
      badge: "unknown",
      label: "Idle",
      description: "No audio frames received in the window — unit is connected but silent.",
    };
  }
  const ratio = plcRatio(u.plc_frames_synthesized, u.frames_decoded);
  const underrunsPerWindow = u.reports > 0 ? u.buffer_underruns / u.reports : u.buffer_underruns;
  if (ratio < 0.01 && u.buffer_underruns === 0) {
    return {
      badge: "green",
      label: "Healthy",
      description: "Clean link — under 1 % PLC and no buffer underruns this window.",
    };
  }
  if (ratio < 0.05 && underrunsPerWindow < 3) {
    return {
      badge: "yellow",
      label: "Marginal",
      description: "Some smoothing — under 5 % PLC and occasional underruns. Watch.",
    };
  }
  return {
    badge: "red",
    label: "Degraded",
    description: "Operator-noticeable cutout — over 5 % PLC or frequent underruns.",
  };
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function codecMixLabel(mix: Record<string, VoiceLinkCodecEntry> | null | undefined): string {
  if (!mix) return "—";
  const entries = Object.entries(mix);
  if (entries.length === 0) return "—";
  const total = entries.reduce((acc, [, v]) => acc + (v.framesDecoded ?? 0), 0);
  if (total <= 0) return entries.map(([k]) => k).join(", ");
  return entries
    .map(([k, v]) => `${k}: ${Math.round(((v.framesDecoded ?? 0) / total) * 100)}%`)
    .join(", ");
}

function bucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function VoiceLinkPanel() {
  const [range, setRange] = useState<AnalyticsRange>("24h");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [units, setUnits] = useState<VoiceLinkUnitSummary[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [windows, setWindows] = useState<VoiceLinkTimeseriesPoint[] | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);

  // --- top-level fetch -----------------------------------------------------

  async function reload() {
    setState("loading");
    setError(null);
    try {
      const [chRes, telemetryRes] = await Promise.all([
        api.listChannels().catch(() => ({ channels: [] as Channel[] })),
        api.listVoiceLinkTelemetry({
          sinceMs: rangeToMs(range),
          channel: channelFilter || undefined,
        }),
      ]);
      setChannels(chRes.channels);
      setUnits(telemetryRes.units);
      setState("ready");
    } catch (err) {
      setError(describeError(err));
      setState("error");
    }
  }

  useEffect(() => {
    void reload();
    // Refresh every 30 s so the dashboard stays close to live without forcing
    // operators to keep hitting reload — same cadence as the client reporter.
    const id = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, channelFilter]);

  // --- detail fetch --------------------------------------------------------

  useEffect(() => {
    if (!selectedUnit) {
      setWindows(null);
      setDetailState("idle");
      return;
    }
    let cancelled = false;
    async function go() {
      setDetailState("loading");
      setDetailError(null);
      try {
        const res = await api.getVoiceLinkUnitTimeseries(selectedUnit!, {
          sinceMs: rangeToMs(range),
          channel: channelFilter || undefined,
        });
        if (cancelled) return;
        setWindows(res.windows);
        setDetailState("ready");
      } catch (err) {
        if (cancelled) return;
        setDetailError(describeError(err));
        setDetailState("error");
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [selectedUnit, range, channelFilter]);

  // --- derived view --------------------------------------------------------

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((u) => u.unit_id.toLowerCase().includes(q));
  }, [units, search]);

  const selected = useMemo(
    () => (selectedUnit ? filteredUnits.find((u) => u.unit_id === selectedUnit) ?? null : null),
    [selectedUnit, filteredUnits],
  );

  // Charts — three series derived from the per-window points. Sized down to
  // ~32 buckets so a 24 h × 30 s = 2880-point series doesn't render a wall of
  // 2880 SVG nodes. Each bucket sums underruns / PLC / decoded across the
  // windows that fall into it.
  const chartSeries = useMemo(() => {
    if (!windows || windows.length === 0) {
      return null;
    }
    const buckets = 32;
    const t0 = Date.parse(windows[0]!.server_ts);
    const tN = Date.parse(windows[windows.length - 1]!.server_ts);
    if (!Number.isFinite(t0) || !Number.isFinite(tN) || tN <= t0) {
      // Fall back to point-per-window when timestamps are unusable.
      return {
        plc: windows.map((w) => ({
          label: bucketLabel(w.server_ts),
          value: Math.round(plcRatio(w.plc_frames_synthesized, w.frames_decoded) * 1000),
        })),
        underruns: windows.map((w) => ({
          label: bucketLabel(w.server_ts),
          value: w.buffer_underruns,
        })),
        decoded: windows.map((w) => ({
          label: bucketLabel(w.server_ts),
          value: w.frames_decoded,
        })),
      };
    }
    const stepMs = (tN - t0) / buckets;
    const acc: { plcN: number; plcD: number; underruns: number; decoded: number; iso: string }[] =
      Array.from({ length: buckets }, () => ({
        plcN: 0,
        plcD: 0,
        underruns: 0,
        decoded: 0,
        iso: "",
      }));
    for (const w of windows) {
      const t = Date.parse(w.server_ts);
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((t - t0) / stepMs)));
      const slot = acc[idx]!;
      slot.plcN += w.plc_frames_synthesized;
      slot.plcD += w.frames_decoded;
      slot.underruns += w.buffer_underruns;
      slot.decoded += w.frames_decoded;
      // First non-empty server_ts in the bucket labels it.
      if (!slot.iso) slot.iso = w.server_ts;
    }
    // Carry forward a bucket label so empty buckets still get a sensible
    // X-axis hint even when no window fell in them.
    let lastIso = windows[0]!.server_ts;
    for (const slot of acc) {
      if (!slot.iso) slot.iso = lastIso;
      else lastIso = slot.iso;
    }
    return {
      plc: acc.map((s) => ({
        label: bucketLabel(s.iso),
        // Scaled to per-mille so a 1 % PLC reads as "10" — keeps the integer
        // axis labels in `LineChart` readable.
        value: Math.round(plcRatio(s.plcN, s.plcD) * 1000),
      })),
      underruns: acc.map((s) => ({ label: bucketLabel(s.iso), value: s.underruns })),
      decoded: acc.map((s) => ({ label: bucketLabel(s.iso), value: s.decoded })),
    };
  }, [windows]);

  return (
    <div>
      <div className="panel-head">
        <h2>Link Health</h2>
        <span className="count">{filteredUnits.length} units</span>
      </div>
      <p className="panel-desc">
        Inbound voice quality per unit — jitter buffer underruns, PLC frames synthesised,
        decode failures, and frames received per codec. Clients post a short summary every
        ~30 s; rows here roll those windows up. Click a unit to see its
        last-window-by-window trend.
      </p>

      <div className="card">
        <div className="form-row">
          <div className="field">
            <label>Time range</label>
            <TimeRangeSelector value={range} onChange={setRange} disabled={state === "loading"} />
          </div>
          <div className="field">
            <label>Channel</label>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              disabled={state === "loading"}
            >
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Unit search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by unit id…"
            />
          </div>
          <button className="btn sm" onClick={() => void reload()} disabled={state === "loading"}>
            {state === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {state === "loading" && units.length === 0 ? (
        <LoadingState label="Loading link health" />
      ) : state === "error" && units.length === 0 ? (
        <ErrorState title="Couldn't load link health" detail={error ?? undefined} onRetry={() => void reload()} />
      ) : filteredUnits.length === 0 ? (
        <EmptyState
          title="No telemetry in this window"
          description={
            search
              ? "No units match the current search. Try clearing the filter."
              : "Connect a client and wait ~30 s — every audio client posts a summary on that cadence."
          }
        />
      ) : (
        <table className="vlt-units">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Last seen</th>
              <th>PLC ratio</th>
              <th>Underruns</th>
              <th>Decode fail</th>
              <th>Decoded</th>
              <th>Codec mix</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {filteredUnits.map((u) => {
              const ratio = plcRatio(u.plc_frames_synthesized, u.frames_decoded);
              const h = classify(u);
              const selectedRow = u.unit_id === selectedUnit;
              return (
                <tr
                  key={u.unit_id}
                  className={selectedRow ? "selected" : undefined}
                  onClick={() =>
                    setSelectedUnit((prev) => (prev === u.unit_id ? null : u.unit_id))
                  }
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <code className="mono">{u.unit_id}</code>
                  </td>
                  <td>{formatRelative(u.last_seen)}</td>
                  <td>{(ratio * 100).toFixed(2)}%</td>
                  <td>{u.buffer_underruns}</td>
                  <td>{u.decode_failures}</td>
                  <td>{u.frames_decoded.toLocaleString()}</td>
                  <td>{codecMixLabel(u.codec_mix)}</td>
                  <td>
                    <span
                      className={`vlt-badge vlt-badge-${h.badge}`}
                      title={h.description}
                    >
                      {h.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {selected && (
        <div className="card">
          <div className="panel-head" style={{ marginTop: 0 }}>
            <h3>
              Detail — <code className="mono">{selected.unit_id}</code>
            </h3>
            <button className="btn sm" onClick={() => setSelectedUnit(null)}>
              Close
            </button>
          </div>
          {detailState === "loading" ? (
            <LoadingState label="Loading time series" />
          ) : detailState === "error" ? (
            <ErrorState
              title="Couldn't load detail"
              detail={detailError ?? undefined}
              onRetry={() => setSelectedUnit(selected.unit_id)}
            />
          ) : !chartSeries ? (
            <EmptyState
              title="No windows reported for this unit yet"
              description="Wait one or two reporter intervals (~30 s each) for the first data points."
            />
          ) : (
            <div className="vlt-charts">
              <div className="vlt-chart">
                <div className="vlt-chart-title">PLC ratio (per mille — 10 = 1 %)</div>
                <LineChart points={chartSeries.plc} area />
              </div>
              <div className="vlt-chart">
                <div className="vlt-chart-title">Buffer underruns (count per bucket)</div>
                <LineChart points={chartSeries.underruns} area />
              </div>
              <div className="vlt-chart">
                <div className="vlt-chart-title">Frames decoded</div>
                <LineChart points={chartSeries.decoded} area />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
