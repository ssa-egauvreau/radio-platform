// Pure mapping from the global AudioLabConfig (admin-edited via the Audio Lab
// console) to the simplified device-side audio config that Android / iOS / web
// clients consume over GET /v1/audio/config.
//
// Kept in its own module so it can be unit-tested without spinning up the
// Express stack or a Postgres pool. The serving route in `apiRoutes.ts` just
// loads the row and hands the JSON blob to this function.
//
// The bypass-mode coupling in particular is load-bearing: PR #131 / commit
// 8967253 fixed a regression where `bypassMicProcessing=true` combined with a
// stale `agcEnabled=true` (e.g. left over from the Maximum-boost preset) would
// silently ship a 3× post-capture gain on top of the "no processing" claim.
// Tests in `tests/audioConfig.test.ts` lock that fix in.

/** Shape of the persisted AudioLabConfig blob, narrowed to the fields the
 *  device summary actually reads. Everything is optional so older rows still
 *  decode safely. */
export interface PersistedAudioLabConfig {
  preImbe?: {
    agcEnabled?: boolean;
    agcMaxGain?: number;
    windGateEnabled?: boolean;
    windHpfEnabled?: boolean;
    bypassMicProcessing?: boolean;
  };
}

/** Simplified device-side summary returned by GET /v1/audio/config. */
export interface DeviceAudioConfig {
  agcEnabled: boolean;
  noiseSuppression: boolean;
  /** 1.0 – 3.0, two-decimal rounded. */
  gainMultiplier: number;
  bypassMicProcessing: boolean;
}

/**
 * Map an admin-edited AudioLabConfig to the device-facing summary.
 *
 * Notes / invariants worth keeping intact:
 *
 * - `noiseSuppression` is true if EITHER the adaptive wind gate OR the steep
 *   HPF is on — Android only exposes a single NoiseSuppressor toggle, so we
 *   collapse them into one "wind reduction is on" flag for clients.
 *
 * - `agcMaxGain` is mapped 1..12 -> 1.0..3.0× via `1 + (gain/12)*2`, then
 *   clamped to [1.0, 3.0]. The curve starts at 1.0 so the lowest simple-UI
 *   preset ("A little", agcMaxGain=4) still produces an audible boost.
 *
 * - When `bypassMicProcessing=true`, `gainMultiplier` is forced to 1.0
 *   regardless of `agcEnabled` / `agcMaxGain`. This is the bug-fix from
 *   commit 8967253 — without it, a stale agcEnabled=true from an earlier
 *   "Maximum boost" preset would silently re-introduce 3× gain on top of the
 *   "no processing" claim.
 */
export function deriveDeviceAudioConfig(
  persisted: PersistedAudioLabConfig | null | undefined,
): DeviceAudioConfig {
  const pre = persisted?.preImbe;
  const agcEnabled = Boolean(pre?.agcEnabled ?? false);
  const agcMaxGain = Number(pre?.agcMaxGain ?? 6);
  const bypassMicProcessing = Boolean(pre?.bypassMicProcessing ?? false);
  const noiseSuppression =
    Boolean(pre?.windGateEnabled ?? false) ||
    Boolean(pre?.windHpfEnabled ?? false);
  const rawMultiplier =
    agcEnabled && !bypassMicProcessing
      ? Math.max(1.0, Math.min(3.0, 1.0 + (agcMaxGain / 12.0) * 2.0))
      : 1.0;
  return {
    agcEnabled,
    noiseSuppression,
    gainMultiplier: Math.round(rawMultiplier * 100) / 100,
    bypassMicProcessing,
  };
}
