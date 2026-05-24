import { AudioLevelMeter } from "../voice/AudioLevelMeter";

/**
 * A horizontal input-level meter for a radio bridge. The fill shows the live
 * audio level; a marker line shows the VOX threshold — audio whose fill reaches
 * past the marker is loud enough to open the gate and key the channel.
 */
export function BridgeMeter({
  level,
  threshold,
  keyed,
  active,
}: {
  level: number;
  threshold: number;
  keyed: boolean;
  active: boolean;
}) {
  return (
    <div className="bridge-meter">
      <AudioLevelMeter
        level={level}
        threshold={threshold}
        keyed={keyed}
        active={active}
        variant="bridge"
        showStatus
      />
    </div>
  );
}
