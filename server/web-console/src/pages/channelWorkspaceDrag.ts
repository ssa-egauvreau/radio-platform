import type { WorkspaceDropEdge } from "./channelWorkspaceOrder";

/** Tiles whose tops are within this distance share a row (row-dense reading order). */
const ROW_CLUSTER_PX = 52;

type TileRect = {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
};

/** Gap below a tile where dropping means “stack under this channel”. */
const UNDER_GAP_PX = 56;
/** Tiles whose centers are within this distance share a column. */
const COLUMN_CLUSTER_PX = 88;

function readTileRects(root: HTMLElement, order: number[], excludeId: number | null): TileRect[] {
  const out: TileRect[] = [];
  for (const id of order) {
    if (id === excludeId) {
      continue;
    }
    const el = root.querySelector<HTMLElement>(`[data-channel-id="${id}"]`);
    if (!el) {
      continue;
    }
    const r = el.getBoundingClientRect();
    out.push({
      id,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      cx: r.left + r.width / 2,
    });
  }
  return out;
}

/** Group tiles into horizontal rows (top-to-bottom), each sorted left-to-right. */
function clusterRows(tiles: TileRect[]): TileRect[][] {
  if (tiles.length === 0) {
    return [];
  }
  const sorted = [...tiles].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: TileRect[][] = [];
  for (const tile of sorted) {
    let placed = false;
    for (const row of rows) {
      const ref = row[0]!;
      const sameRow =
        Math.abs(tile.top - ref.top) <= ROW_CLUSTER_PX ||
        (tile.top < ref.bottom && tile.bottom > ref.top);
      if (sameRow) {
        row.push(tile);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([tile]);
    }
  }
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left);
  }
  rows.sort((a, b) => a[0]!.top - b[0]!.top);
  return rows;
}

/** Group tiles into vertical columns (left-to-right), each sorted top-to-bottom. */
function clusterColumns(tiles: TileRect[]): TileRect[][] {
  if (tiles.length === 0) {
    return [];
  }
  const sorted = [...tiles].sort((a, b) => a.left - b.left || a.top - b.top);
  const columns: TileRect[][] = [];
  for (const tile of sorted) {
    let placed = false;
    for (const col of columns) {
      const ref = col[0]!;
      if (Math.abs(tile.cx - ref.cx) <= COLUMN_CLUSTER_PX) {
        col.push(tile);
        placed = true;
        break;
      }
    }
    if (!placed) {
      columns.push([tile]);
    }
  }
  for (const col of columns) {
    col.sort((a, b) => a.top - b.top);
  }
  columns.sort((a, b) => a[0]!.left - b[0]!.left);
  return columns;
}

/** Reading order for row-dense grid: left-to-right within each row, then the next row. */
export function rowMajorOrderFromDom(
  root: HTMLElement,
  order: number[],
  excludeId: number | null = null,
): number[] {
  const tiles = readTileRects(root, order, excludeId);
  return clusterRows(tiles).flatMap((row) => row.map((t) => t.id));
}

/** @deprecated Use rowMajorOrderFromDom — kept for imports during transition. */
export const columnMajorOrderFromDom = rowMajorOrderFromDom;

function columnBounds(col: TileRect[]): { left: number; right: number } {
  let left = Infinity;
  let right = -Infinity;
  for (const t of col) {
    left = Math.min(left, t.left);
    right = Math.max(right, t.right);
  }
  return { left, right };
}

function pointerInColumnBand(x: number, col: TileRect[], pad = 12): boolean {
  const { left, right } = columnBounds(col);
  return x >= left - pad && x <= right + pad;
}

/**
 * Find drop target using column stacks — supports gaps *under* a channel, not only
 * hovering on the tile body (which felt like “side only” with column layout).
 */
export function findWorkspaceDropTarget(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  order: number[],
  excludeId: number | null,
): { targetId: number; edge: WorkspaceDropEdge } | null {
  const tiles = readTileRects(root, order, excludeId);
  if (tiles.length === 0) {
    return null;
  }
  const columns = clusterColumns(tiles);

  let targetColumn: TileRect[] | null = null;
  for (const col of columns) {
    if (pointerInColumnBand(clientX, col)) {
      targetColumn = col;
      break;
    }
  }
  if (!targetColumn) {
    let bestDist = Infinity;
    for (const col of columns) {
      const { left, right } = columnBounds(col);
      const cx = (left + right) / 2;
      const dist = Math.abs(clientX - cx);
      if (dist < bestDist) {
        bestDist = dist;
        targetColumn = col;
      }
    }
  }
  if (!targetColumn || targetColumn.length === 0) {
    return null;
  }

  const col = targetColumn;

  for (let i = 0; i < col.length; i++) {
    const tile = col[i]!;
    const next = col[i + 1];

    if (clientY >= tile.top && clientY <= tile.bottom) {
      const midY = tile.top + (tile.bottom - tile.top) / 2;
      return { targetId: tile.id, edge: clientY < midY ? "before" : "after" };
    }

    const underBottom = next ? Math.min(tile.bottom + UNDER_GAP_PX, next.top) : tile.bottom + UNDER_GAP_PX;
    if (clientY > tile.bottom && clientY <= underBottom && pointerInColumnBand(clientX, col, 4)) {
      return { targetId: tile.id, edge: "after" };
    }

    if (next && clientY > underBottom && clientY < next.top) {
      const gapMid = (tile.bottom + next.top) / 2;
      return {
        targetId: gapMid - tile.bottom < next.top - gapMid ? tile.id : next.id,
        edge: gapMid - tile.bottom < next.top - gapMid ? "after" : "before",
      };
    }
  }

  const first = col[0]!;
  const last = col[col.length - 1]!;
  if (clientY < first.top) {
    return { targetId: first.id, edge: "before" };
  }
  if (clientY > last.bottom) {
    return { targetId: last.id, edge: "after" };
  }

  return { targetId: last.id, edge: "after" };
}

/** Insert index when dropping a rail channel onto the workspace (column-major). */
export function insertIndexFromPointer(
  clientX: number,
  clientY: number,
  root: HTMLElement,
  channelIds: number[],
): number {
  const visual = rowMajorOrderFromDom(root, channelIds, null);
  const drop = findWorkspaceDropTarget(root, clientX, clientY, visual, null);
  if (!drop) {
    return channelIds.length;
  }
  const idx = visual.indexOf(drop.targetId);
  if (idx < 0) {
    return channelIds.length;
  }
  return drop.edge === "after" ? idx + 1 : idx;
}

/** Apply a column-major order after preview insert (for commit on drop). */
export function orderAfterDrop(
  visualOrder: number[],
  sourceId: number,
  targetId: number,
  edge: WorkspaceDropEdge,
): number[] {
  const without = visualOrder.filter((id) => id !== sourceId);
  let insertAt = without.indexOf(targetId);
  if (insertAt < 0) {
    return [...without, sourceId];
  }
  if (edge === "after") {
    insertAt += 1;
  }
  return [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];
}
