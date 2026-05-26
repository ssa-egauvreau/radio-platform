export type DeviceCodecMode = "auto" | "imbe" | "openvbe2p" | "pcm";

export interface DeviceAudioConfigSummary {
  agcEnabled: boolean;
  noiseSuppression: boolean;
  gainMultiplier: number;
  codecMode: DeviceCodecMode;
}

function normalizeCodecMode(raw: unknown, bypass: boolean): DeviceCodecMode {
  if (bypass) {
    return "pcm";
  }
  const value = String(raw ?? "imbe").trim().toLowerCase();
  if (value === "openvbe2p" || value === "openvbe") {
    return "openvbe2p";
  }
  if (value === "pcm" || value === "clear_pcm" || value === "bypass") {
    return "pcm";
  }
  if (value === "auto") {
    return "auto";
  }
  return "imbe";
}

export function summarizeGlobalAudioConfig(config: unknown): DeviceAudioConfigSummary {
  const full = (config && typeof config === "object" ? config : {}) as {
    preImbe?: {
      agcEnabled?: boolean;
      agcMaxGain?: number;
      windGateEnabled?: boolean;
      windHpfEnabled?: boolean;
    };
    vocoder?: {
      bypass?: boolean;
      codec?: unknown;
    };
  };

  const agcEnabled = Boolean(full.preImbe?.agcEnabled ?? false);
  const agcMaxGain = Number(full.preImbe?.agcMaxGain ?? 6);
  const windReduce =
    Boolean(full.preImbe?.windGateEnabled ?? false) ||
    Boolean(full.preImbe?.windHpfEnabled ?? false);
  const gainMultiplier = agcEnabled
    ? Math.max(1.0, Math.min(3.0, 1.0 + (agcMaxGain / 12.0) * 2.0))
    : 1.0;

  return {
    agcEnabled,
    noiseSuppression: windReduce,
    gainMultiplier: Math.round(gainMultiplier * 100) / 100,
    codecMode: normalizeCodecMode(full.vocoder?.codec, Boolean(full.vocoder?.bypass ?? false)),
  };
}
