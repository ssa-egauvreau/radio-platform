import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import type { UserChannel } from "../api";
import { ChannelPanel } from "./ChannelPanel";
import {
  WORKSPACE_COLS,
  WORKSPACE_MAX_COL_SPAN,
  WORKSPACE_MAX_ROW_SPAN,
  WORKSPACE_MIN_COL_SPAN,
  WORKSPACE_MIN_ROW_SPAN,
  WORKSPACE_GRID_GAP_PX,
  WORKSPACE_ROW_PX,
  defaultWorkspaceTile,
  getWorkspaceTile,
  setWorkspaceTile,
  workspaceColSpanForViewport,
} from "../consoleStore";

function snapCol(pixelX: number, gridWidth: number): number {
  const col = Math.round((pixelX / gridWidth) * WORKSPACE_COLS);
  return Math.max(0, Math.min(WORKSPACE_COLS - WORKSPACE_MIN_COL_SPAN, col));
}

function snapRow(pixelY: number): number {
  return Math.max(0, Math.round(pixelY / WORKSPACE_ROW_PX));
}

function pointerToGrid(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { col: number; row: number } {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return { col: snapCol(x, rect.width), row: snapRow(y) };
}

export function ChannelWorkspace({
  dockedChannels,
  open,
  primary,
  pttCode,
  keyboardOn,
  onToggleMonitor,
  onUndock,
  onMakePrimary,
  onDockFromRail,
}: {
  dockedChannels: UserChannel[];
  open: number[];
  primary: number | null;
  pttCode: string;
  keyboardOn: boolean;
  onToggleMonitor: (id: number) => void;
  onUndock: (id: number) => void;
  onMakePrimary: (id: number) => void;
  onDockFromRail: (id: number) => void;
}) {
  const gridRef = useRef<HTMLElement | null>(null);
  const [dockDragOver, setDockDragOver] = useState(false);
  const [dragChannelId, setDragChannelId] = useState<number | null>(null);
  const [resizeChannelId, setResizeChannelId] = useState<number | null>(null);
  const [viewportWide, setViewportWide] = useState(() => workspaceColSpanForViewport());

  useEffect(() => {
    function onResize() {
      setViewportWide(workspaceColSpanForViewport());
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const maxRow = dockedChannels.reduce((m, ch) => {
    const t = getWorkspaceTile(ch.id);
    return Math.max(m, t.row + t.rowSpan);
  }, 10);
  const gridMinHeight = Math.max(
    360,
    maxRow * WORKSPACE_ROW_PX + (maxRow - 1) * WORKSPACE_GRID_GAP_PX + 48,
  );

  const handleDockDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDockDragOver(false);
      const raw = e.dataTransfer.getData("text/channel-id");
      const id = Number(raw);
      if (!Number.isFinite(id) || id <= 0 || !gridRef.current) {
        return;
      }
      onDockFromRail(id);
      const rect = gridRef.current.getBoundingClientRect();
      const { col, row } = pointerToGrid(e.clientX, e.clientY, rect);
      const tile = defaultWorkspaceTile(
        Object.fromEntries(
          dockedChannels
            .filter((c) => c.id !== id)
            .map((c) => [String(c.id), getWorkspaceTile(c.id)]),
        ),
        col,
      );
      setWorkspaceTile(id, { ...tile, col, row });
    },
    [dockedChannels, onDockFromRail],
  );

  function tilePixelHeight(rowSpan: number): number {
    return rowSpan * WORKSPACE_ROW_PX + (rowSpan - 1) * WORKSPACE_GRID_GAP_PX;
  }

  function beginMove(e: PointerEvent<HTMLDivElement>, channelId: number) {
    if (
      (e.target as HTMLElement).closest(
        "button, input, select, a, .tx-button, .vol-slider, .channel-workspace-resize-h, .channel-workspace-resize-w",
      )
    ) {
      return;
    }
    const tile = getWorkspaceTile(channelId);
    const origin = { ...tile };
    const startX = e.clientX;
    const startY = e.clientY;
    setDragChannelId(channelId);
    const onMove = (ev: globalThis.PointerEvent) => {
      if (!gridRef.current) {
        return;
      }
      const colW = gridRef.current.getBoundingClientRect().width / WORKSPACE_COLS;
      const deltaCol = Math.round((ev.clientX - startX) / colW);
      const deltaRow = Math.round((ev.clientY - startY) / WORKSPACE_ROW_PX);
      setWorkspaceTile(channelId, {
        ...origin,
        col: Math.max(0, Math.min(WORKSPACE_COLS - origin.colSpan, origin.col + deltaCol)),
        row: Math.max(0, origin.row + deltaRow),
      });
    };
    const onUp = () => {
      setDragChannelId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginResize(e: PointerEvent<HTMLButtonElement>, channelId: number) {
    e.preventDefault();
    e.stopPropagation();
    const origin = getWorkspaceTile(channelId);
    const startY = e.clientY;
    setResizeChannelId(channelId);
    const onMove = (ev: globalThis.PointerEvent) => {
      const deltaRow = Math.round((ev.clientY - startY) / WORKSPACE_ROW_PX);
      setWorkspaceTile(channelId, {
        ...origin,
        rowSpan: Math.max(
          WORKSPACE_MIN_ROW_SPAN,
          Math.min(WORKSPACE_MAX_ROW_SPAN, origin.rowSpan + deltaRow),
        ),
      });
    };
    const onUp = () => {
      setResizeChannelId(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginResizeWidth(e: PointerEvent<HTMLButtonElement>, channelId: number) {
    e.preventDefault();
    e.stopPropagation();
    if (!gridRef.current) {
      return;
    }
    const origin = getWorkspaceTile(channelId);
    const colW = gridRef.current.getBoundingClientRect().width / WORKSPACE_COLS;
    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = Math.round((ev.clientX - e.clientX) / colW);
      setWorkspaceTile(channelId, {
        ...origin,
        colSpan: Math.max(
          WORKSPACE_MIN_COL_SPAN,
          Math.min(WORKSPACE_MAX_COL_SPAN, origin.colSpan + delta),
        ),
      });
    };
    const onUp = () => {
      setWorkspaceTile(channelId, getWorkspaceTile(channelId), true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <section
      ref={gridRef}
      className={`channel-workspace-grid${dockDragOver ? " drag-over" : ""}`}
      style={{
        gridAutoRows: `${WORKSPACE_ROW_PX}px`,
        gap: `${WORKSPACE_GRID_GAP_PX}px`,
        minHeight: gridMinHeight,
      }}
      data-workspace-cols={viewportWide}
      aria-label="Channel workspace"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDockDragOver(true);
      }}
      onDragLeave={() => setDockDragOver(false)}
      onDrop={handleDockDrop}
    >
      {dockedChannels.length === 0 ? (
        <div className="channel-workspace-empty">
          <p>Drag channels here from the list on the left.</p>
          <p className="muted">
            Snap next to other channels · drag the bottom edge to resize taller · right edge for width
          </p>
        </div>
      ) : (
        dockedChannels.map((channel) => {
          const tile = getWorkspaceTile(channel.id);
          const monitoring = open.includes(channel.id);
          return (
            <div
              key={channel.id}
              className={`channel-workspace-tile${!monitoring ? " channel-off" : ""}${
                dragChannelId === channel.id ? " dragging" : ""
              }${resizeChannelId === channel.id ? " resizing" : ""}`}
              style={{
                gridColumn: `${tile.col + 1} / span ${tile.colSpan}`,
                gridRow: `${tile.row + 1} / span ${tile.rowSpan}`,
                minHeight: tilePixelHeight(tile.rowSpan),
              }}
            >
              <div
                className="channel-workspace-tile-inner"
                onPointerDown={(e) => beginMove(e, channel.id)}
              >
                <ChannelPanel
                  channel={channel}
                  layout="workspace"
                  monitoring={monitoring}
                  expanded
                  primary={primary === channel.id}
                  pttCode={pttCode}
                  keyboardOn={keyboardOn}
                  onToggleMonitor={() => onToggleMonitor(channel.id)}
                  onToggleExpanded={() => onUndock(channel.id)}
                  onMakePrimary={() => onMakePrimary(channel.id)}
                />
                {!monitoring && <div className="channel-off-overlay" aria-hidden />}
              </div>
              <button
                type="button"
                className="channel-workspace-resize-w"
                aria-label="Resize width"
                onPointerDown={(e) => beginResizeWidth(e, channel.id)}
              />
              <button
                type="button"
                className="channel-workspace-resize-h"
                aria-label="Resize height"
                onPointerDown={(e) => beginResize(e, channel.id)}
              />
            </div>
          );
        })
      )}
    </section>
  );
}
