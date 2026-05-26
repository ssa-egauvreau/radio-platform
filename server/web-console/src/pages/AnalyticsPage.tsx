// Operational analytics for an agency: KPI tiles with prior-window deltas,
// a transmissions time series, channel utilization, top units, and AI
// dispatcher outcomes. Read-only and agency-scoped — all heavy lifting
// happens server-side in `analytics.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "../Topbar";
import {
  api,
  describeError,
  type AnalyticsAiOutcomeRow,
  type AnalyticsChannelRow,
  type AnalyticsRange,
  type AnalyticsSummary,
  type AnalyticsTimeSeriesPoint,
  type AnalyticsUnitRow,
} from "../api";
import { useUnitAliasResolver } from "../unitAliases";
import {
  BarBreakdown,
  EmptyState,
  ErrorState,
  LineChart,
  LoadingState,
  StatBox,
  TimeRangeSelector,
} from "../components/ui";

const STORAGE_KEY = "analytics-range";

function parseStoredRange(raw: string | null): AnalyticsRange {
  return raw === "24h" || raw === "7d" || raw === "30d" ? raw : "7d";
}

/** Format a millisecond duration as "Xh Ym" / "Xm Ys" / "Xs" for KPI displays. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const s = totalSeconds % 60;
    return s > 0 ? `${minutes}m ${s}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
}

/** % delta between `now` and `prev`, or null when there's no meaningful baseline. */
function percentDelta(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev)) {
    return null;
  }
  if (prev <= 0) {
    // No baseline — only show a delta if the current window is also zero
    // (flat) or skip it entirely. A "+∞%" pill would be noisy.
    return now > 0 ? null : 0;
  }
  return ((now - prev) / prev) * 100;
}

/** Render a short label for a time-series bucket given the active range. */
function formatBucketLabel(iso: string, range: AnalyticsRange): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  if (range === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface PanelState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

const initialPanel = <T,>(): PanelState<T> => ({ data: null, error: null, loading: true });

export function AnalyticsPage() {
  const aliasFor = useUnitAliasResolver();
  const [range, setRange] = useState<AnalyticsRange>(() => {
    try {
      return parseStoredRange(localStorage.getItem(STORAGE_KEY));
    } catch {
      return "7d";
    }
  });

  const [summary, setSummary] = useState<PanelState<AnalyticsSummary>>(initialPanel);
  const [timeSeries, setTimeSeries] =
    useState<PanelState<AnalyticsTimeSeriesPoint[]>>(initialPanel);
  const [channels, setChannels] = useState<PanelState<AnalyticsChannelRow[]>>(initialPanel);
  const [units, setUnits] = useState<PanelState<AnalyticsUnitRow[]>>(initialPanel);
  const [aiOutcomes, setAiOutcomes] =
    useState<PanelState<AnalyticsAiOutcomeRow[]>>(initialPanel);

  const handleRangeChange = useCallback((next: AnalyticsRange) => {
    setRange(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setSummary((s) => ({ ...s, loading: true, error: null }));
      setTimeSeries((s) => ({ ...s, loading: true, error: null }));
      setChannels((s) => ({ ...s, loading: true, error: null }));
      setUnits((s) => ({ ...s, loading: true, error: null }));
      setAiOutcomes((s) => ({ ...s, loading: true, error: null }));

      // Each fetch settles independently so a slow / failed panel doesn't hide
      // the rest of the page. Per-panel error UI surfaces what went wrong.
      const [s, ts, ch, un, ai] = await Promise.allSettled([
        api.getAnalyticsSummary(range),
        api.getAnalyticsTimeSeries(range),
        api.getAnalyticsChannels(range),
        api.getAnalyticsUnits(range),
        api.getAnalyticsAiOutcomes(range),
      ]);
      if (signal?.aborted) {
        return;
      }

      setSummary(
        s.status === "fulfilled"
          ? { data: s.value, error: null, loading: false }
          : { data: null, error: describeError(s.reason), loading: false },
      );
      setTimeSeries(
        ts.status === "fulfilled"
          ? { data: ts.value.points, error: null, loading: false }
          : { data: null, error: describeError(ts.reason), loading: false },
      );
      setChannels(
        ch.status === "fulfilled"
          ? { data: ch.value.channels, error: null, loading: false }
          : { data: null, error: describeError(ch.reason), loading: false },
      );
      setUnits(
        un.status === "fulfilled"
          ? { data: un.value.units, error: null, loading: false }
          : { data: null, error: describeError(un.reason), loading: false },
      );
      setAiOutcomes(
        ai.status === "fulfilled"
          ? { data: ai.value.outcomes, error: null, loading: false }
          : { data: null, error: describeError(ai.reason), loading: false },
      );
    },
    [range],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const sparklinePoints = useMemo(
    () => timeSeries.data?.map((p) => p.transmissions) ?? [],
    [timeSeries.data],
  );

  return (
    <div className="analytics-page">
      <Topbar section="console" />
      <header className="analytics-header">
        <div>
          <h1>Analytics</h1>
          <p>Operational metrics for the last selected window. Updates on range change.</p>
        </div>
        <TimeRangeSelector
          value={range}
          onChange={handleRangeChange}
          disabled={summary.loading}
        />
      </header>

      {/* KPI row */}
      <section className="analytics-kpi-row" aria-label="Key metrics">
        <KpiTile
          label="Transmissions"
          state={summary}
          render={(d) => ({
            value: d.transmissions.toLocaleString(),
            delta: percentDelta(d.transmissions, d.transmissionsPrev),
            sparkline: sparklinePoints,
          })}
        />
        <KpiTile
          label="Active units"
          state={summary}
          render={(d) => ({
            value: d.activeUnits.toLocaleString(),
            delta: percentDelta(d.activeUnits, d.activeUnitsPrev),
          })}
        />
        <KpiTile
          label="On-air time"
          state={summary}
          render={(d) => ({
            value: formatDuration(d.onAirMs),
            delta: percentDelta(d.onAirMs, d.onAirMsPrev),
          })}
        />
        <KpiTile
          label="Alerts"
          state={summary}
          render={(d) => ({
            value: d.alerts.toLocaleString(),
            delta: percentDelta(d.alerts, d.alertsPrev),
            // For alerts, FEWER is better — colour the pill accordingly.
            deltaGoodWhenPositive: false,
          })}
        />
        <KpiTile
          label="AI dispatches"
          state={summary}
          render={(d) => ({
            value: d.aiCalls.toLocaleString(),
            subValue:
              d.aiEscalated > 0
                ? `${d.aiEscalated.toLocaleString()} escalated`
                : "0 escalated",
            delta: percentDelta(d.aiCalls, d.aiCallsPrev),
          })}
        />
      </section>

      {/* Time series */}
      <section className="analytics-section">
        <h2>Transmissions over time</h2>
        <p className="analytics-section-sub">
          {range === "24h"
            ? "Hourly counts for the last 24 hours."
            : range === "7d"
              ? "Daily counts for the last 7 days."
              : "Daily counts for the last 30 days."}
        </p>
        <SectionBody
          state={timeSeries}
          render={(points) =>
            points.length === 0 ? (
              <EmptyState title="No transmissions yet" description="When units key up they'll appear here." />
            ) : (
              <LineChart
                area
                height={180}
                points={points.map((p) => ({
                  label: formatBucketLabel(p.bucket, range),
                  value: p.transmissions,
                }))}
              />
            )
          }
          retry={refresh}
        />
      </section>

      <div className="analytics-two-col">
        {/* Channel utilization */}
        <section className="analytics-section">
          <h2>Channel utilization</h2>
          <p className="analytics-section-sub">
            Total on-air time per channel. Top 25 only.
          </p>
          <SectionBody
            state={channels}
            render={(rows) =>
              rows.length === 0 ? (
                <EmptyState title="No channel activity" />
              ) : (
                <BarBreakdown
                  rows={rows.map((r) => ({
                    label: r.channel,
                    value: r.onAirMs,
                    sub: `${r.transmissions.toLocaleString()} TX · ${r.uniqueUnits} unit${r.uniqueUnits === 1 ? "" : "s"}`,
                  }))}
                  format={formatDuration}
                />
              )
            }
            retry={refresh}
          />
        </section>

        {/* Top units */}
        <section className="analytics-section">
          <h2>Top units by on-air time</h2>
          <p className="analytics-section-sub">
            Highest cumulative transmission time over the window.
          </p>
          <SectionBody
            state={units}
            render={(rows) =>
              rows.length === 0 ? (
                <EmptyState title="No unit activity" />
              ) : (
                <BarBreakdown
                  rows={rows.map((r) => {
                    const alias = aliasFor(r.unitId);
                    const label = alias
                      ? `${alias} (${r.unitId})`
                      : r.displayName
                        ? `${r.displayName} (${r.unitId})`
                        : r.unitId;
                    return {
                      label,
                      value: r.onAirMs,
                      sub: `${r.transmissions.toLocaleString()} transmission${r.transmissions === 1 ? "" : "s"}`,
                    };
                  })}
                  format={formatDuration}
                />
              )
            }
            retry={refresh}
          />
        </section>
      </div>

      {/* AI dispatch outcomes */}
      <section className="analytics-section">
        <h2>AI dispatcher outcomes</h2>
        <p className="analytics-section-sub">
          Breakdown of how the AI dispatcher resolved calls in this window.
        </p>
        <SectionBody
          state={aiOutcomes}
          render={(rows) =>
            rows.length === 0 ? (
              <EmptyState
                title="No AI dispatcher activity"
                description="When the AI dispatcher answers a call its outcome shows up here."
              />
            ) : (
              <BarBreakdown
                rows={rows.map((r) => ({
                  label: r.outcome.replace(/_/g, " "),
                  value: r.count,
                }))}
              />
            )
          }
          retry={refresh}
        />
      </section>
    </div>
  );
}

/** Wraps a stat tile so empty-state during loading / error doesn't leak into the value. */
function KpiTile<T>({
  label,
  state,
  render,
}: {
  label: string;
  state: PanelState<T>;
  render: (data: T) => {
    value: React.ReactNode;
    subValue?: React.ReactNode;
    delta?: number | null;
    deltaGoodWhenPositive?: boolean;
    sparkline?: readonly number[];
  };
}) {
  if (state.error) {
    return <StatBox label={label} value="—" subValue="Couldn't load" />;
  }
  if (!state.data) {
    return <StatBox label={label} value="…" />;
  }
  const r = render(state.data);
  return (
    <StatBox
      label={label}
      value={r.value}
      subValue={r.subValue}
      deltaPct={r.delta ?? undefined}
      deltaIsGoodWhenPositive={r.deltaGoodWhenPositive}
      sparkline={r.sparkline}
    />
  );
}

/** Renders loading / error / data using shared UI primitives. */
function SectionBody<T>({
  state,
  render,
  retry,
}: {
  state: PanelState<T>;
  render: (data: T) => React.ReactNode;
  retry: () => void;
}) {
  if (state.error) {
    return <ErrorState title="Couldn't load this section." detail={state.error} onRetry={retry} />;
  }
  if (state.data === null) {
    return <LoadingState label="Loading…" />;
  }
  return <>{render(state.data)}</>;
}
