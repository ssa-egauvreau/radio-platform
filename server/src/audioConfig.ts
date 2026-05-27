// Derive the device-oriented mic-processing config that handsets fetch on
// connect/reconnect (`GET /v1/audio/config`) from the full AudioLabConfig an
// admin pushed through the Audio Lab.
//
// This sits on the hot path for every Android and iOS handset on every
// reconnect, plus the web voice client. A silent bug here ships a misconfigured
// mic chain (wrong AGC, wrong wind-noise gate, or — worst case — a stale gain
// boost applied on top of a "no processing" claim) to the entire fleet without
// any visible server error.
//
// Kept as a standalone, dependency-free function so the mapping can be unit-
// tested without spinning up Express or Postgres, and so any future caller
// (e.g. the desktop console, the bridge worker self-config preview) shares
// exactly the same derivation as the route.

/** Shape the device clients (Android / iOS / web) understand. */
export interface DeviceAudioConfig {
  /** Apply server-driven AGC / make-up gain on the capture side. */
  agcEnabled: boolean;
  /**
   * Engage the device's noise-suppression chain. Android only exposes a
   * single NoiseSuppressor toggle, so this is OR'd from the two upstream
   * controls (adaptive wind gate + steep wind HPF).
   */
  noiseSuppression: boolean;
  /**
   * Post-capture make-up gain factor applied before IMBE.
   *
   * Forced to `1.0` when `agcEnabled` is off, OR when `bypassMicProcessing`
   * is on (bridge-style minimal path). Otherwise mapped linearly from
   * `agcMaxGain` (1–12) into the [1.0, 3.0] range and rounded to 2 decimals
   * so the JSON serialisation is stable.
   */
  gainMultiplier: number;
  /**
   * Bridge-style minimal mic processing — handset disables browser/OS
   * EC/NS/AGC and the TX conditioner runs HPF+LPF only.
   */
  bypassMicProcessing: boolean;
  /**
   * RX-side post-decode chain (presence bell / saturation / shelves /
   * upsample mode). `null` when no admin has pushed shaping — clients
   * skip the chain entirely and play decoded IMBE at the legacy 16 kHz
   * sample-duplicate path. Otherwise the field is the verbatim
   * `AudioLabConfig.postDecode` block stored by the admin push, so any
   * tuning done in the Audio Lab matches what live listeners hear.
   */
  postDecode: DevicePostDecodeConfig | null;
}

/** Subset of `AudioLabConfig.postDecode` clients need at runtime. Lab-only
 *  fields (e.g. the diagnostic `"linear"` upsample mode is preserved here
 *  so the field shape matches the stored config verbatim — the client just
 *  picks a sane fallback if it doesn't implement that mode). */
export interface DevicePostDecodeConfig {
  upsampleMode: "duplicate" | "linear" | "polyphase" | "polyphase24";
  hpfEnabled?: boolean;
  hpfHz?: number;
  lpfEnabled?: boolean;
  lpfHz?: number;
  lowShelfEnabled?: boolean;
  lowShelfHz?: number;
  lowShelfDb?: number;
  highShelfEnabled?: boolean;
  highShelfHz?: number;
  highShelfDb?: number;
  presenceEnabled?: boolean;
  presenceHz?: number;
  presenceDb?: number;
  presenceQ?: number;
  saturationAmount?: number;
}

/**
 * Optional fields the function consumes from a stored AudioLabConfig. Any
 * absent field falls back to its safe "off" default so a partial config from
 * an older client version produces the same shape as the all-defaults config.
 */
interface AudioLabPreImbe {
  agcEnabled?: boolean;
  agcMaxGain?: number;
  windGateEnabled?: boolean;
  windHpfEnabled?: boolean;
  bypassMicProcessing?: boolean;
}

interface AudioLabConfigLike {
  preImbe?: AudioLabPreImbe;
  postDecode?: Record<string, unknown>;
}

/**
 * Map a stored full `AudioLabConfig` (the JSON blob saved by `PUT
 * /v1/admin/audio-config`) to the simplified device-oriented payload returned
 * by `GET /v1/audio/config`. Pure: no I/O, no dependence on `now()`.
 *
 * The mapping is intentionally conservative — when in doubt, return the
 * "feature off" value so a malformed config never escalates a handset's mic
 * chain unexpectedly. The one place where this matters most is the
 * `bypassMicProcessing` flag forcing `gainMultiplier` to 1.0 even when
 * `agcEnabled` is left on from a previous preset (PR-131 follow-up fix).
 */
export function deriveDeviceAudioConfig(input: unknown): DeviceAudioConfig {
  const cfg =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as AudioLabConfigLike)
      : {};
  const pre = cfg.preImbe ?? {};

  const agcEnabled = Boolean(pre.agcEnabled ?? false);
  const agcMaxGain = Number(pre.agcMaxGain ?? 6);
  const bypassMicProcessing = Boolean(pre.bypassMicProcessing ?? false);

  // Wind reduction is "on" on Android if EITHER the adaptive gate OR the
  // steep HPF is enabled — both contribute to noise rejection upstream of
  // IMBE, and Android only exposes a single NoiseSuppressor toggle.
  const noiseSuppression =
    Boolean(pre.windGateEnabled ?? false) || Boolean(pre.windHpfEnabled ?? false);

  // Map agcMaxGain (1–12) → gainMultiplier (1.0–3.0). The range starts at
  // 1.0 so the lowest simple-UI preset ("A little", agcMaxGain=4) still
  // delivers an audible boost — a linear (gain/12)*3 map collapses to 1.0×
  // at gain=4, making the preset indistinguishable from "off" on device.
  // When bypass is on, also force gainMultiplier=1.0: the whole point of
  // "Bridge-style minimal" is no post-capture gain, so even a stale
  // agcEnabled=true from a previous preset shouldn't sneak gain in.
  const rawMultiplier =
    agcEnabled && !bypassMicProcessing
      ? Math.max(1.0, Math.min(3.0, 1.0 + (agcMaxGain / 12.0) * 2.0))
      : 1.0;

  return {
    agcEnabled,
    noiseSuppression,
    gainMultiplier: Math.round(rawMultiplier * 100) / 100,
    bypassMicProcessing,
    postDecode: derivePostDecodeBlock(cfg.postDecode),
  };
}

/** Mirror of {@link DevicePostDecodeConfig} on the admin-pushed config. */
const VALID_UPSAMPLE_MODES: ReadonlySet<DevicePostDecodeConfig["upsampleMode"]> = new Set([
  "duplicate",
  "linear",
  "polyphase",
  "polyphase24",
]);

/**
 * Sanitize the stored `postDecode` block before handing it to clients. Only
 * known fields are forwarded so a malformed admin push (or a future schema
 * addition the client doesn't understand yet) can't surprise live RX. Returns
 * `null` when shaping would be a no-op so the client takes the legacy
 * sample-duplicate fast path with no branching cost.
 */
function derivePostDecodeBlock(
  raw: Record<string, unknown> | undefined,
): DevicePostDecodeConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const upsampleRaw = String(raw.upsampleMode ?? "");
  const upsampleMode = (
    VALID_UPSAMPLE_MODES.has(upsampleRaw as DevicePostDecodeConfig["upsampleMode"])
      ? upsampleRaw
      : "duplicate"
  ) as DevicePostDecodeConfig["upsampleMode"];

  const out: DevicePostDecodeConfig = { upsampleMode };

  const target = out as unknown as Record<string, unknown>;
  const optBool = (k: keyof DevicePostDecodeConfig): void => {
    if (raw[k] !== undefined) {
      target[k] = Boolean(raw[k]);
    }
  };
  const optNum = (k: keyof DevicePostDecodeConfig): void => {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      target[k] = v;
    }
  };

  optBool("hpfEnabled");
  optNum("hpfHz");
  optBool("lpfEnabled");
  optNum("lpfHz");
  optBool("lowShelfEnabled");
  optNum("lowShelfHz");
  optNum("lowShelfDb");
  optBool("highShelfEnabled");
  optNum("highShelfHz");
  optNum("highShelfDb");
  optBool("presenceEnabled");
  optNum("presenceHz");
  optNum("presenceDb");
  optNum("presenceQ");
  optNum("saturationAmount");

  // Short-circuit: if nothing is actually enabled / engaged AND the upsample
  // is the legacy default, return null so the client takes the no-op fast
  // path. The voice client checks `postDecode === null` exactly for this.
  const anyShapingEnabled =
    out.hpfEnabled === true ||
    out.lpfEnabled === true ||
    out.lowShelfEnabled === true ||
    out.highShelfEnabled === true ||
    out.presenceEnabled === true ||
    (typeof out.saturationAmount === "number" && out.saturationAmount > 0);
  if (!anyShapingEnabled && upsampleMode === "duplicate") {
    return null;
  }
  return out;
}
