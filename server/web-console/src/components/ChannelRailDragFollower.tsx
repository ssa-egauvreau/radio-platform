import type { RailDragPreview } from "../pages/workspaceRailDrag";
import { workspaceGhostWidthPx } from "../pages/workspaceRailDrag";

const SIZE_LABEL = { small: "S", medium: "M", large: "L" } as const;

/** Follows the cursor while dragging a channel from the rail (shows true widget width). */
export function ChannelRailDragFollower({
  preview,
  clientX,
  clientY,
}: {
  preview: RailDragPreview;
  clientX: number;
  clientY: number;
}) {
  const width = workspaceGhostWidthPx(preview.colSpan);
  return (
    <div
      className={`channel-workspace-rail-drag-follower widget-${preview.size}`}
      style={{
        width,
        left: clientX,
        top: clientY,
      }}
      aria-hidden
    >
      <div
        className="channel-workspace-rail-drag-follower-head"
        style={
          preview.color
            ? { background: preview.color, color: "#fff", borderColor: preview.color }
            : undefined
        }
      >
        <span className="channel-workspace-rail-drag-follower-name">{preview.channelName}</span>
        {preview.simulcast && <span className="chan-sim-tag">SIM</span>}
        <span className="channel-workspace-rail-drag-follower-size">{SIZE_LABEL[preview.size]}</span>
      </div>
      <div className="channel-workspace-rail-drag-follower-body">
        {preview.size === "small" && (
          <>
            <span className="ghost-line ghost-line-short" />
            <span className="ghost-btn-row">
              <span className="ghost-pill">ON</span>
              <span className="ghost-pill ghost-pill-ptt">PTT</span>
            </span>
          </>
        )}
        {preview.size === "medium" && (
          <>
            <span className="ghost-line" />
            <span className="ghost-btn-row">
              <span className="ghost-pill">ON</span>
              <span className="ghost-pill ghost-pill-ptt">PTT</span>
            </span>
            <span className="ghost-line ghost-line-tx" />
            <span className="ghost-tone-row">
              <span className="ghost-pill ghost-pill-sm">R</span>
              <span className="ghost-pill ghost-pill-sm">P</span>
              <span className="ghost-pill ghost-pill-sm">S</span>
            </span>
          </>
        )}
        {preview.size === "large" && (
          <>
            <span className="ghost-line" />
            <span className="ghost-btn-row">
              <span className="ghost-pill">ON</span>
              <span className="ghost-pill ghost-pill-ptt">PTT</span>
            </span>
            <span className="ghost-line ghost-line-tx" />
            <span className="ghost-line ghost-line-tall" />
            <span className="ghost-line ghost-line-roster" />
          </>
        )}
      </div>
    </div>
  );
}
