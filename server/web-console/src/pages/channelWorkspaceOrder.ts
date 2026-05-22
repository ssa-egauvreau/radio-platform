/** Drop edge when reordering a tile before/after another. */
export type WorkspaceDropEdge = "before" | "after";

/** Preview dock order while dragging (does not commit until drop). */
export function previewWorkspaceOrder(
  order: number[],
  sourceId: number | null,
  targetId: number | null,
  edge: WorkspaceDropEdge | null,
  insertAtEnd: boolean,
): number[] {
  if (sourceId === null) {
    return order;
  }
  const from = order.indexOf(sourceId);
  if (from < 0) {
    return order;
  }
  if (targetId === null && !insertAtEnd) {
    return order;
  }
  const without = order.filter((id) => id !== sourceId);
  if (insertAtEnd || targetId === sourceId) {
    return [...without, sourceId];
  }
  let insertAt = without.indexOf(targetId);
  if (insertAt < 0) {
    return order;
  }
  if (edge === "after") {
    insertAt += 1;
  }
  return [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];
}
