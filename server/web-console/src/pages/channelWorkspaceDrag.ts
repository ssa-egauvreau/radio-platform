import type { WorkspaceDropEdge } from "./channelWorkspaceOrder";

/** Row tracks for column-first grid so tiles wrap into multiple columns. */
export function workspaceGridRowSlots(itemCount: number, colCount: number): number {
  const cols = Math.max(1, colCount);
  return Math.max(6, Math.ceil(itemCount / cols) * 3);
}

/** Drop before/after from pointer position (vertical = stack order in a column). */
export function dropEdgeFromPointer(
  clientY: number,
  tileEl: HTMLElement,
): WorkspaceDropEdge {
  const rect = tileEl.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  return clientY < midY ? "before" : "after";
}

/**
 * Find which docked tile the pointer is over. Uses geometry, not elementFromPoint,
 * so the dragged tile (pointer-events: none) does not block hit-testing.
 */
export function findWorkspaceDropTarget(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  excludeId: number | null,
): { targetId: number; edge: WorkspaceDropEdge } | null {
  const tiles = Array.from(root.querySelectorAll<HTMLElement>("[data-channel-id]"));
  for (const tile of tiles) {
    const id = Number(tile.dataset.channelId);
    if (!Number.isFinite(id) || id <= 0 || id === excludeId) {
      continue;
    }
    const rect = tile.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return { targetId: id, edge: dropEdgeFromPointer(clientY, tile) };
    }
  }

  const rootRect = root.getBoundingClientRect();
  const inRoot =
    clientX >= rootRect.left &&
    clientX <= rootRect.right &&
    clientY >= rootRect.top &&
    clientY <= rootRect.bottom;
  if (!inRoot) {
    return null;
  }

  let nearest: { targetId: number; edge: WorkspaceDropEdge; dist: number } | null = null;
  for (const tile of tiles) {
    const id = Number(tile.dataset.channelId);
    if (!Number.isFinite(id) || id <= 0 || id === excludeId) {
      continue;
    }
    const rect = tile.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (nearest === null || dist < nearest.dist) {
      nearest = {
        targetId: id,
        edge: clientY < cy ? "before" : "after",
        dist,
      };
    }
  }
  return nearest ? { targetId: nearest.targetId, edge: nearest.edge } : null;
}

/** Insert index when dropping a rail channel onto the workspace. */
export function insertIndexFromPointer(
  clientX: number,
  clientY: number,
  root: HTMLElement,
  channelIds: number[],
): number {
  const drop = findWorkspaceDropTarget(root, clientX, clientY, null);
  if (!drop) {
    return channelIds.length;
  }
  const idx = channelIds.indexOf(drop.targetId);
  if (idx < 0) {
    return channelIds.length;
  }
  return drop.edge === "after" ? idx + 1 : idx;
}
