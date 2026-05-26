// KPI tile used by the analytics page. Label + value + optional delta vs the
// prior comparison window + optional sparkline. Pure presentational — caller
// supplies pre-formatted display strings so the same component works for
// counts, durations, percentages, etc.

import type { ReactNode } from "react";

interface StatBoxProps {
  /** Short label rendered above the value. */
  label: string;
  /** Pre-formatted value. Leave undefined while loading. */
  value: ReactNode;
  /** Optional secondary line — e.g. "3 escalated" beneath an AI count. */
  subValue?: ReactNode;
  /** Optional percentage delta vs the prior window. Positive = up. */
  deltaPct?: number | null;
  /** When false, larger numbers are bad (e.g. response time). Default true. */
  deltaIsGoodWhenPositive?: boolean;
  /** Optional sparkline points (0..1 normalised height, left to right). */
  sparkline?: readonly number[];
  /** Optional click handler — turns the tile into a button. */
  onClick?: () => void;
}

/** Render a single KPI card. */
export function StatBox({
  label,
  value,
  subValue,
  deltaPct,
  deltaIsGoodWhenPositive = true,
  sparkline,
  onClick,
}: StatBoxProps) {
  const interactive = typeof onClick === "function";
  const Tag = interactive ? "button" : "div";
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={"ui-stat" + (interactive ? " ui-stat-clickable" : "")}
    >
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value">{value ?? "—"}</div>
      {subValue && <div className="ui-stat-sub">{subValue}</div>}
      {(deltaPct !== undefined && deltaPct !== null) || sparkline ? (
        <div className="ui-stat-foot">
          {deltaPct !== undefined && deltaPct !== null && (
            <DeltaPill pct={deltaPct} goodWhenPositive={deltaIsGoodWhenPositive} />
          )}
          {sparkline && sparkline.length > 1 && <Sparkline points={sparkline} />}
        </div>
      ) : null}
    </Tag>
  );
}

function DeltaPill({ pct, goodWhenPositive }: { pct: number; goodWhenPositive: boolean }) {
  if (!Number.isFinite(pct)) {
    return null;
  }
  const rounded = Math.round(pct);
  // Treat ±2% as "flat" — avoids noisy day-to-day flicker in low-volume agencies.
  const direction = rounded > 2 ? "up" : rounded < -2 ? "down" : "flat";
  const good =
    direction === "flat" ? true : direction === "up" ? goodWhenPositive : !goodWhenPositive;
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "•";
  const display = direction === "flat" ? "0%" : `${Math.abs(rounded)}%`;
  return (
    <span className={`ui-delta ui-delta-${direction} ${good ? "ui-delta-good" : "ui-delta-bad"}`}>
      <span className="ui-delta-arrow" aria-hidden="true">
        {arrow}
      </span>
      {display}
    </span>
  );
}

/** Inline tiny SVG line for the trailing window. Points are 0..1, left→right. */
export function Sparkline({
  points,
  width = 72,
  height = 22,
}: {
  points: readonly number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return null;
  }
  // Normalise to [0, 1] within the data itself so a flat-but-non-zero series
  // still renders as a flat line in the middle rather than at the bottom.
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const pad = 2;
  const usable = height - pad * 2;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = pad + (1 - (p - min) / span) * usable;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="ui-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
