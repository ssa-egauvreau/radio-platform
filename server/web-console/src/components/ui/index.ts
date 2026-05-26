// Console UI primitives. Used by the analytics surface first; intended to be
// the canonical home for status/empty/loading/error patterns and small KPI/
// chart components other panels can adopt incrementally.

export { EmptyState, LoadingState, ErrorState } from "./StatusStates";
export { StatBox, Sparkline } from "./StatBox";
export { TimeRangeSelector, ANALYTICS_RANGES, type AnalyticsRange } from "./TimeRangeSelector";
export { LineChart, BarBreakdown } from "./MiniChart";
