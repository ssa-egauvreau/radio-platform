// Shared, cross-window console state — which channels are open, the keyboard
// PTT binding, and shortcut on/off. The console and each pop-out window run in
// separate JavaScript contexts, so the source of truth lives in localStorage
// and changes propagate between windows via the "storage" event.

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PTT_CODE,
  KEYBOARD_ENABLED_KEY,
  LAST_CHANNEL_KEY,
  OPEN_CHANNELS_KEY,
  PTT_CODE_KEY,
} from "./pages/consoleShared";

const STATE_KEY = "securityradio.console.state";

/** Free-form tile on the channel workspace grid (12 columns). */
export interface WorkspaceTileLayout {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export const WORKSPACE_COLS = 12;
export const WORKSPACE_ROW_PX = 28;
export const WORKSPACE_DEFAULT_COL_SPAN = 6;
export const WORKSPACE_DEFAULT_ROW_SPAN = 11;
export const WORKSPACE_MIN_COL_SPAN = 3;
export const WORKSPACE_MAX_COL_SPAN = 12;
export const WORKSPACE_MIN_ROW_SPAN = 6;
export const WORKSPACE_MAX_ROW_SPAN = 28;

export interface ConsoleState {
  /** Channel ids with live voice connected ("on" / monitoring). */
  open: number[];
  /** Channel ids whose full control surface is expanded (independent of on/off). */
  expanded: number[];
  /** The channel the keyboard PTT key controls, or null. Always a monitoring channel. */
  primary: number | null;
  /** KeyboardEvent.code bound to push-to-talk. */
  pttCode: string;
  /** Whether console keyboard shortcuts are active. */
  keyboardOn: boolean;
  /** Docked channel positions on the workspace grid (channel id → tile). */
  workspaceLayout: Record<string, WorkspaceTileLayout>;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : [];
}

function withValidPrimary(open: number[], primary: unknown): number | null {
  if (typeof primary === "number" && open.includes(primary)) {
    return primary;
  }
  return open.length > 0 ? open[open.length - 1]! : null;
}

function parseWorkspaceLayout(raw: unknown): Record<string, WorkspaceTileLayout> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, WorkspaceTileLayout> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) {
      continue;
    }
    const t = val as Record<string, unknown>;
    const col = Number(t.col);
    const row = Number(t.row);
    const colSpan = Number(t.colSpan);
    const rowSpan = Number(t.rowSpan);
    if (
      Number.isFinite(col) &&
      Number.isFinite(row) &&
      Number.isFinite(colSpan) &&
      Number.isFinite(rowSpan)
    ) {
      out[key] = {
        col: Math.max(0, Math.min(WORKSPACE_COLS - 1, col)),
        row: Math.max(0, row),
        colSpan: Math.max(WORKSPACE_MIN_COL_SPAN, Math.min(WORKSPACE_MAX_COL_SPAN, colSpan)),
        rowSpan: Math.max(WORKSPACE_MIN_ROW_SPAN, Math.min(WORKSPACE_MAX_ROW_SPAN, rowSpan)),
      };
    }
  }
  return out;
}

function parse(raw: string | null): ConsoleState | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const open = numbers(value.open);
    return {
      open,
      // Pre-redesign state has no "expanded" — keep continuity by expanding the
      // channels that were already open (shown as full panels) on first load.
      expanded: Array.isArray(value.expanded) ? numbers(value.expanded) : [...open],
      primary: withValidPrimary(open, value.primary),
      pttCode: typeof value.pttCode === "string" && value.pttCode ? value.pttCode : DEFAULT_PTT_CODE,
      keyboardOn: typeof value.keyboardOn === "boolean" ? value.keyboardOn : true,
      workspaceLayout: parseWorkspaceLayout(value.workspaceLayout),
    };
  } catch {
    return null;
  }
}

/** Builds the initial state from the pre-pop-out localStorage keys. */
function migrate(): ConsoleState {
  let open: number[] = [];
  try {
    open = numbers(JSON.parse(localStorage.getItem(OPEN_CHANNELS_KEY) ?? "null"));
  } catch {
    /* fall through to the legacy single-channel key */
  }
  if (open.length === 0) {
    const last = Number(localStorage.getItem(LAST_CHANNEL_KEY));
    if (Number.isFinite(last) && last > 0) {
      open = [last];
    }
  }
  return {
    open,
    expanded: [...open],
    primary: open.length > 0 ? open[0]! : null,
    pttCode: localStorage.getItem(PTT_CODE_KEY) || DEFAULT_PTT_CODE,
    keyboardOn: localStorage.getItem(KEYBOARD_ENABLED_KEY) !== "0",
    workspaceLayout: {},
  };
}

let state: ConsoleState = parse(localStorage.getItem(STATE_KEY)) ?? migrate();
const listeners = new Set<() => void>();

function commit(next: ConsoleState): void {
  state = next;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — keep the in-memory state */
  }
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  // Another window (a pop-out, or the console) changed the shared state.
  window.addEventListener("storage", (event) => {
    if (event.key === STATE_KEY) {
      const next = parse(event.newValue);
      if (next) {
        state = next;
        listeners.forEach((listener) => listener());
      }
    }
  });
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Subscribes a component to the shared console state. */
export function useConsoleState(): ConsoleState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Turns a channel's live voice on or off. Turning on makes it the keyboard-PTT primary. */
export function setChannelMonitoring(id: number, on: boolean): void {
  if (on) {
    const open = state.open.includes(id) ? state.open : [...state.open, id];
    commit({ ...state, open, primary: id });
  } else {
    if (!state.open.includes(id)) {
      return;
    }
    const open = state.open.filter((x) => x !== id);
    const primary = state.primary === id ? (open[open.length - 1] ?? null) : state.primary;
    commit({ ...state, open, primary });
  }
}

function layoutKey(id: number): string {
  return String(id);
}

/** First open grid slot that does not overlap existing tiles. */
export function defaultWorkspaceTile(
  layout: Record<string, WorkspaceTileLayout>,
  preferCol = 0,
): WorkspaceTileLayout {
  const colSpan = WORKSPACE_DEFAULT_COL_SPAN;
  const rowSpan = WORKSPACE_DEFAULT_ROW_SPAN;
  for (let row = 0; row < 80; row++) {
    for (let col = preferCol; col <= WORKSPACE_COLS - colSpan; col += 3) {
      const candidate = { col, row, colSpan, rowSpan };
      const overlaps = Object.values(layout).some((t) => tilesOverlap(t, candidate));
      if (!overlaps) {
        return candidate;
      }
    }
    for (let col = 0; col < WORKSPACE_COLS - colSpan; col += 3) {
      const candidate = { col, row, colSpan, rowSpan };
      const overlaps = Object.values(layout).some((t) => tilesOverlap(t, candidate));
      if (!overlaps) {
        return candidate;
      }
    }
  }
  return { col: 0, row: 0, colSpan, rowSpan };
}

function tilesOverlap(a: WorkspaceTileLayout, b: WorkspaceTileLayout): boolean {
  return (
    a.col < b.col + b.colSpan &&
    a.col + a.colSpan > b.col &&
    a.row < b.row + b.rowSpan &&
    a.row + a.rowSpan > b.row
  );
}

export function getWorkspaceTile(id: number): WorkspaceTileLayout {
  return state.workspaceLayout[layoutKey(id)] ?? defaultWorkspaceTile(state.workspaceLayout);
}

export function setWorkspaceTile(id: number, tile: WorkspaceTileLayout): void {
  const key = layoutKey(id);
  commit({
    ...state,
    workspaceLayout: {
      ...state.workspaceLayout,
      [key]: {
        col: Math.max(0, Math.min(WORKSPACE_COLS - WORKSPACE_MIN_COL_SPAN, tile.col)),
        row: Math.max(0, tile.row),
        colSpan: Math.max(WORKSPACE_MIN_COL_SPAN, Math.min(WORKSPACE_MAX_COL_SPAN, tile.colSpan)),
        rowSpan: Math.max(WORKSPACE_MIN_ROW_SPAN, Math.min(WORKSPACE_MAX_ROW_SPAN, tile.rowSpan)),
      },
    },
  });
}

/** Dock a channel on the workspace (full-size panel on the right). */
export function dockChannel(id: number): void {
  const expanded = state.expanded.includes(id) ? state.expanded : [...state.expanded, id];
  const key = layoutKey(id);
  const workspaceLayout = { ...state.workspaceLayout };
  if (!workspaceLayout[key]) {
    workspaceLayout[key] = defaultWorkspaceTile(workspaceLayout);
  }
  commit({ ...state, expanded, workspaceLayout });
}

/** Remove a channel from the workspace (returns to the left rail only). */
export function undockChannel(id: number): void {
  if (!state.expanded.includes(id)) {
    return;
  }
  const key = layoutKey(id);
  const workspaceLayout = { ...state.workspaceLayout };
  delete workspaceLayout[key];
  commit({ ...state, expanded: state.expanded.filter((x) => x !== id), workspaceLayout });
}

/** Toggle workspace dock (full panel on the right). */
export function toggleChannelExpanded(id: number): void {
  if (state.expanded.includes(id)) {
    undockChannel(id);
  } else {
    dockChannel(id);
  }
}

/** Keyboard/quick action: turn the channel on, dock it, and make it primary. */
export function focusChannel(id: number): void {
  const open = state.open.includes(id) ? state.open : [...state.open, id];
  let expanded = state.expanded;
  let workspaceLayout = state.workspaceLayout;
  if (!expanded.includes(id)) {
    expanded = [...expanded, id];
    const key = layoutKey(id);
    if (!workspaceLayout[key]) {
      workspaceLayout = { ...workspaceLayout, [key]: defaultWorkspaceTile(workspaceLayout) };
    }
  }
  commit({ ...state, open, expanded, workspaceLayout, primary: id });
}

export function setPrimaryChannel(id: number): void {
  if (!state.open.includes(id) || state.primary === id) {
    return;
  }
  commit({ ...state, primary: id });
}

/**
 * Drops channels the account can no longer see from the open/expanded sets. Call
 * only with a freshly fetched channel list — never speculatively, or it would
 * wipe the monitoring set.
 */
export function reconcileChannels(availableIds: number[]): void {
  const allowed = new Set(availableIds);
  const open = state.open.filter((id) => allowed.has(id));
  const expanded = state.expanded.filter((id) => allowed.has(id));
  const workspaceLayout: Record<string, WorkspaceTileLayout> = {};
  for (const [key, tile] of Object.entries(state.workspaceLayout)) {
    if (allowed.has(Number(key))) {
      workspaceLayout[key] = tile;
    }
  }
  if (
    open.length === state.open.length &&
    expanded.length === state.expanded.length &&
    Object.keys(workspaceLayout).length === Object.keys(state.workspaceLayout).length
  ) {
    return;
  }
  commit({ ...state, open, expanded, workspaceLayout, primary: withValidPrimary(open, state.primary) });
}

export function setPttCode(code: string): void {
  commit({ ...state, pttCode: code });
}

export function setKeyboardOn(on: boolean): void {
  commit({ ...state, keyboardOn: on });
}
