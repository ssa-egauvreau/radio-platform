import { useEffect, useRef, useState } from "react";

/** Perceptual 0–1 scale so quiet speech still moves the meter noticeably. */
export function meterScale(value: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, value)));
}

export type AudioLevelMeterVariant = "tx" | "rx" | "bridge";

interface AudioLevelMeterProps {
  /** Normalized level 0–1 (controlled mode). */
  level?: number;
  /** Poll level each frame while active (live mode). */
  getLevel?: () => number;
  active: boolean;
  variant?: AudioLevelMeterVariant;
  /** Bridge VOX: gate is open. */
  keyed?: boolean;
  /** Optional VOX threshold marker, 0–1. */
  threshold?: number;
  className?: string;
  /** Status text beside the bar (bridge runner). */
  showStatus?: boolean;
}

/**
 * Horizontal level meter: silent on the left, louder toward the right (same as Bridges tab).
 */
export function AudioLevelMeter({
  level: levelProp,
  getLevel,
  active,
  variant = "tx",
  keyed = false,
  threshold,
  className = "",
  showStatus = false,
}: AudioLevelMeterProps) {
  const [polled, setPolled] = useState(0);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  useEffect(() => {
    if (levelProp !== undefined || !getLevelRef.current) {
      return;
    }
    if (!active) {
      setPolled(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setPolled(getLevelRef.current?.() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, levelProp]);

  const raw = levelProp !== undefined ? levelProp : polled;
  const fillPct = active ? meterScale(raw) * 100 : 0;
  const markPct =
    threshold !== undefined && Number.isFinite(threshold) ? meterScale(threshold) * 100 : null;

  const fillClass =
    variant === "bridge" && keyed
      ? "audio-level-meter-fill keyed"
      : `audio-level-meter-fill ${variant}`;

  const status =
    variant === "bridge"
      ? !active
        ? "Not running"
        : keyed
          ? "Keying channel"
          : markPct !== null && fillPct >= markPct && fillPct > 1
            ? "Audio above gate"
            : fillPct > 4
              ? "Audio detected"
              : "Silent"
      : null;

  return (
    <div
      className={`audio-level-meter${className ? ` ${className}` : ""}`}
      aria-hidden={!showStatus}
    >
      <div className="audio-level-meter-bar" title="Audio level — quiet left, loud right">
        <div className={fillClass} style={{ width: `${fillPct}%` }} />
        {markPct !== null && (
          <div
            className="audio-level-meter-mark"
            style={{ left: `${markPct}%` }}
            title="VOX threshold"
          />
        )}
      </div>
      {showStatus && status !== null && (
        <span className={keyed ? "audio-level-meter-status keyed" : "audio-level-meter-status"}>
          {status}
        </span>
      )}
    </div>
  );
}
