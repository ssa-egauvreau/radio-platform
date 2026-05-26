// Pill button group for picking the analytics window. Kept tiny on purpose —
// other range-controlled surfaces (transmission log, audit log) can adopt the
// same component so the affordance is consistent across the console.

export type AnalyticsRange = "24h" | "7d" | "30d";

export const ANALYTICS_RANGES: { value: AnalyticsRange; label: string; days: number }[] = [
  { value: "24h", label: "24 hours", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
];

interface TimeRangeSelectorProps {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
  /** Disable the buttons while a refresh is in flight. */
  disabled?: boolean;
}

export function TimeRangeSelector({ value, onChange, disabled }: TimeRangeSelectorProps) {
  return (
    <div className="ui-range" role="radiogroup" aria-label="Time range">
      {ANALYTICS_RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={value === r.value}
          className={"btn sm" + (value === r.value ? " primary" : "")}
          onClick={() => onChange(r.value)}
          disabled={disabled}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
