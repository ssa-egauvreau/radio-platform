// Pure-SVG mini charts used by the analytics page. No external chart library —
// the data shapes are simple (one or two short series) and we want predictable
// dark-mode styling that matches the rest of the console.

interface LineChartProps {
  /** Time-bucketed data points. The X axis is sample index, Y is the value. */
  points: readonly { label: string; value: number }[];
  height?: number;
  /** Optional Y-axis suffix shown in the tooltip-style end label. */
  unit?: string;
  /** When set, draw a filled area under the line. Default false. */
  area?: boolean;
}

/** Single-series line chart with axis labels. Caller scales / formats input. */
export function LineChart({ points, height = 160, unit, area }: LineChartProps) {
  if (points.length < 2) {
    return <div className="ui-chart-empty">Not enough data yet</div>;
  }
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const width = Math.max(320, points.length * 14);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  let maxY = 0;
  for (const p of points) {
    if (p.value > maxY) maxY = p.value;
  }
  // A minimum-1 ceiling keeps an all-zero range from collapsing the axis.
  const yMax = Math.max(maxY, 1);
  const stepX = innerW / (points.length - 1);

  const toX = (i: number) => padL + i * stepX;
  const toY = (v: number) => padT + (1 - v / yMax) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(" ");

  const areaPath = area
    ? `${linePath} L${toX(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${toX(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`
    : null;

  // Tick rows: 0, ⌈max/2⌉, max. Round so labels read cleanly for integer counts.
  const ticks = [0, Math.ceil(yMax / 2), Math.ceil(yMax)];
  // Only label every Nth X bucket so long ranges (30 days) don't collide.
  const xLabelStride = points.length > 15 ? Math.ceil(points.length / 8) : 1;

  return (
    <div className="ui-chart-wrap">
      <svg
        className="ui-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Line chart with ${points.length} data points, max ${yMax}${unit ? " " + unit : ""}`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={width - padR}
              y1={toY(t)}
              y2={toY(t)}
              className="ui-chart-grid"
            />
            <text x={padL - 6} y={toY(t) + 4} textAnchor="end" className="ui-chart-axis">
              {t}
            </text>
          </g>
        ))}
        {areaPath && <path d={areaPath} className="ui-chart-area" />}
        <path d={linePath} className="ui-chart-line" />
        {points.map((p, i) =>
          i % xLabelStride === 0 ? (
            <text
              key={i}
              x={toX(i)}
              y={height - 6}
              textAnchor="middle"
              className="ui-chart-axis"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

interface BarBreakdownProps {
  /** Each row is a category with a numeric weight. Sorted by the caller. */
  rows: readonly { label: string; value: number; sub?: string }[];
  /** Pre-formatted value (e.g. "2h 14m"). Falls back to `value`. */
  format?: (value: number) => string;
}

/** Horizontal bar breakdown used for "channel utilization" / "top units". */
export function BarBreakdown({ rows, format }: BarBreakdownProps) {
  if (rows.length === 0) {
    return null;
  }
  const total = rows.reduce((acc, r) => acc + Math.max(0, r.value), 0);
  if (total <= 0) {
    return <div className="ui-chart-empty">No activity in this range</div>;
  }
  return (
    <ul className="ui-bar-list">
      {rows.map((r) => {
        const pct = (Math.max(0, r.value) / total) * 100;
        const display = format ? format(r.value) : String(r.value);
        return (
          <li key={r.label} className="ui-bar-row">
            <div className="ui-bar-row-head">
              <span className="ui-bar-label" title={r.label}>
                {r.label}
              </span>
              <span className="ui-bar-value">{display}</span>
            </div>
            {r.sub && <div className="ui-bar-sub">{r.sub}</div>}
            <div className="ui-bar-track" aria-hidden="true">
              <div className="ui-bar-fill" style={{ width: `${pct.toFixed(1)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
