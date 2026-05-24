// Audio Lab preset storage. User-saved presets live in localStorage; built-ins are
// read-only and always present at the top of the list.

import { BUILTIN_PRESETS, DEFAULT_PRESET, type AudioLabConfig } from "./pipeline";

const STORAGE_KEY = "securityradio.audioLab.presets.v1";

export interface PresetRecord {
  /** Display name. Built-in names are reserved (Default IMBE, Phase 2 voice, Bypass). */
  name: string;
  config: AudioLabConfig;
  /** True for built-ins; user-saved presets are editable / deletable. */
  builtin: boolean;
}

function isBuiltinName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, name);
}

/** Lists all presets — built-ins first, then user-saved alphabetically. */
export function listPresets(): PresetRecord[] {
  const builtins: PresetRecord[] = Object.entries(BUILTIN_PRESETS).map(([name, config]) => ({
    name,
    config,
    builtin: true,
  }));
  const user = loadUserPresets();
  user.sort((a, b) => a.name.localeCompare(b.name));
  return [...builtins, ...user];
}

/** Backfills any newer fields (e.g. low-shelf, added after a user already saved presets)
 *  with defaults so legacy localStorage entries keep working after a schema bump. */
function migrateConfig(cfg: AudioLabConfig): AudioLabConfig {
  return {
    preImbe: { ...DEFAULT_PRESET.preImbe, ...cfg.preImbe },
    vocoder: { ...DEFAULT_PRESET.vocoder, ...cfg.vocoder },
    postDecode: { ...DEFAULT_PRESET.postDecode, ...cfg.postDecode },
  };
}

function loadUserPresets(): PresetRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ name?: unknown; config?: AudioLabConfig }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is { name: string; config: AudioLabConfig } => typeof p.name === "string" && !!p.config)
      .filter((p) => !isBuiltinName(p.name))
      .map((p) => ({ name: p.name, config: migrateConfig(p.config), builtin: false }));
  } catch {
    return [];
  }
}

function saveUserPresets(presets: PresetRecord[]): void {
  const serialisable = presets
    .filter((p) => !p.builtin)
    .map(({ name, config }) => ({ name, config }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialisable));
  } catch {
    /* quota or storage off — silently ignore; user just loses persistence */
  }
}

/** Saves a new user preset under the given name. Returns false and does nothing if the
 *  name collides with a built-in (built-ins are reserved). Overwrites an existing
 *  user preset of the same name. */
export function saveUserPreset(name: string, config: AudioLabConfig): boolean {
  const trimmed = name.trim();
  if (!trimmed || isBuiltinName(trimmed)) {
    return false;
  }
  const existing = loadUserPresets().filter((p) => p.name !== trimmed);
  saveUserPresets([...existing, { name: trimmed, config, builtin: false }]);
  return true;
}

/** Deletes a user preset by name. Built-ins are never deletable. */
export function deleteUserPreset(name: string): void {
  if (isBuiltinName(name)) return;
  const remaining = loadUserPresets().filter((p) => p.name !== name);
  saveUserPresets(remaining);
}
