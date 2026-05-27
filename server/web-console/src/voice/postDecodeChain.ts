// Live RX-side post-decode chain — what the voice client applies to each
// IMBE-decoded frame before scheduling it for playback. Mirrors the Audio
// Lab's post-decode preview (`processClip` in pipeline.ts) so the lab's A/B
// is an honest preview of what listeners hear.
//
// Self-contained on purpose: pipeline.ts pulls in the recorder, lab UI
// state, and a bunch of other lab-only helpers, none of which the voice
// client needs at runtime. Duplicating ~150 lines of Biquad + upsampler +
// saturation math is the cheaper trade than dragging that module into
// every consumer of the voice client.

/**
 * Subset of `AudioLabConfig.postDecode` that controls how the live RX
 * pipeline shapes decoded audio. Anything not in this type is lab-only
 * (e.g. the "linear" upsample is a diagnostic mode that lives in the lab
 * but isn't worth shipping to listeners).
 */
export interface PostDecodeConfig {
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
 * The sample rate the processor will emit for the given config — the voice
 * client needs this BEFORE constructing its AudioContext (the context's
 * sampleRate is fixed at construction). polyphase24 is the only mode that
 * pushes 24 kHz to the listener; everything else is 16 kHz.
 */
export function postDecodeOutputRate(cfg: PostDecodeConfig | null): 16000 | 24000 {
  return cfg?.upsampleMode === "polyphase24" ? 24_000 : 16_000;
}

function clamp16(x: number): number {
  return x > 32767 ? 32767 : x < -32768 ? -32768 : Math.round(x);
}

/** RBJ-cookbook biquad — direct-form-II transposed. Coefficients computed
 *  once at construction; only z1/z2 evolve per-sample. Same math as the
 *  TX-side and lab-side Biquad classes so anyone tuning a coefficient gets
 *  the same audible response across the three paths. */
class Biquad {
  private constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  private z1 = 0;
  private z2 = 0;

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }

  static highpass(fc: number, q: number, fs: number): Biquad {
    const w0 = (2 * Math.PI * fc) / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 + cw) / 2 / a0,
      -(1 + cw) / a0,
      (1 + cw) / 2 / a0,
      (-2 * cw) / a0,
      (1 - alpha) / a0,
    );
  }

  static lowpass(fc: number, q: number, fs: number): Biquad {
    const w0 = (2 * Math.PI * fc) / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha;
    return new Biquad(
      (1 - cw) / 2 / a0,
      (1 - cw) / a0,
      (1 - cw) / 2 / a0,
      (-2 * cw) / a0,
      (1 - alpha) / a0,
    );
  }

  static highshelf(fc: number, gainDb: number, fs: number): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * fc) / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const beta = Math.sqrt(A);
    const a0 = A + 1 - (A - 1) * cw + beta * sw;
    return new Biquad(
      (A * (A + 1 + (A - 1) * cw + beta * sw)) / a0,
      (-2 * A * (A - 1 + (A + 1) * cw)) / a0,
      (A * (A + 1 + (A - 1) * cw - beta * sw)) / a0,
      (2 * (A - 1 - (A + 1) * cw)) / a0,
      (A + 1 - (A - 1) * cw - beta * sw) / a0,
    );
  }

  static lowshelf(fc: number, gainDb: number, fs: number): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * fc) / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const beta = Math.sqrt(A);
    const a0 = A + 1 + (A - 1) * cw + beta * sw;
    return new Biquad(
      (A * (A + 1 - (A - 1) * cw + beta * sw)) / a0,
      (2 * A * (A - 1 - (A + 1) * cw)) / a0,
      (A * (A + 1 - (A - 1) * cw - beta * sw)) / a0,
      (-2 * (A - 1 + (A + 1) * cw)) / a0,
      (A + 1 + (A - 1) * cw - beta * sw) / a0,
    );
  }

  static peak(fc: number, gainDb: number, q: number, fs: number): Biquad {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * fc) / fs;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * q);
    const a0 = 1 + alpha / A;
    return new Biquad(
      (1 + alpha * A) / a0,
      (-2 * cw) / a0,
      (1 - alpha * A) / a0,
      (-2 * cw) / a0,
      (1 - alpha / A) / a0,
    );
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  processInPlace(pcm: Int16Array): void {
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = clamp16(this.process(pcm[i]));
    }
  }
}

// --- upsamplers ---------------------------------------------------------

function upsampleDup8To16(pcm8k: Int16Array): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    out[i * 2] = pcm8k[i];
    out[i * 2 + 1] = pcm8k[i];
  }
  return out;
}

function upsampleLinear8To16(pcm8k: Int16Array, carry: { prev: number }): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  let prev = carry.prev;
  for (let i = 0; i < pcm8k.length; i++) {
    const curr = pcm8k[i];
    out[i * 2] = (prev + curr) >> 1;
    out[i * 2 + 1] = curr;
    prev = curr;
  }
  carry.prev = prev;
  return out;
}

/** 33-tap Hann-windowed sinc, fc = Fs/4. Same coefficients as the lab's
 *  upsamplePolyphase8To16. Cached once per process. */
let polyphase16Kernel: Float32Array | null = null;
function getPolyphase16Kernel(): Float32Array {
  if (polyphase16Kernel) return polyphase16Kernel;
  const N = 33;
  const HALF = (N - 1) >> 1;
  const fc = 0.25;
  const k = new Float32Array(N);
  let norm = 0;
  for (let i = 0; i < N; i++) {
    const x = i - HALF;
    const h = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    k[i] = h * w;
    norm += k[i];
  }
  for (let i = 0; i < N; i++) k[i] /= norm;
  polyphase16Kernel = k;
  return polyphase16Kernel;
}

function upsamplePolyphase8To16(pcm8k: Int16Array): Int16Array {
  const KERNEL = getPolyphase16Kernel();
  const HALF = (KERNEL.length - 1) >> 1;
  const out = new Int16Array(pcm8k.length * 2);
  for (let n = 0; n < out.length; n++) {
    const phase = n & 1;
    const centreIn = n >> 1;
    if (phase === 0) {
      out[n] = pcm8k[centreIn] ?? 0;
    } else {
      let acc = 0;
      for (let k = -HALF; k <= HALF; k++) {
        const inIdx = centreIn + k;
        const sample = inIdx >= 0 && inIdx < pcm8k.length ? pcm8k[inIdx] : 0;
        acc += sample * KERNEL[k + HALF];
      }
      out[n] = clamp16(acc);
    }
  }
  return out;
}

/** 17-tap windowed-sinc 16 → 24 kHz polyphase. 2:3 fractional resampler:
 *  for every two input samples we emit three output samples at fractional
 *  positions {0, 2/3, 1/3}. Phase 0 returns the input sample unchanged;
 *  phases 1 and 2 convolve. Mirrors `upsamplePlayback16To24` in pipeline.ts. */
const POLY24_PHASES = 3;
const POLY24_TAPS = 17;
const POLY24_FRAC_OFFSET = [0, 2 / 3, 1 / 3] as const;
let polyphase24Kernels: Float32Array[] | null = null;
function getPolyphase24Kernels(): Float32Array[] {
  if (polyphase24Kernels) return polyphase24Kernels;
  const HALF = (POLY24_TAPS - 1) >> 1;
  polyphase24Kernels = [];
  for (let p = 0; p < POLY24_PHASES; p++) {
    const k = new Float32Array(POLY24_TAPS);
    const frac = POLY24_FRAC_OFFSET[p];
    let norm = 0;
    for (let i = 0; i < POLY24_TAPS; i++) {
      const x = i - HALF - frac;
      const h =
        Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x * 0.5) / (Math.PI * x * 0.5);
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / POLY24_TAPS));
      k[i] = h * w;
      norm += k[i];
    }
    if (norm !== 0) {
      for (let i = 0; i < POLY24_TAPS; i++) k[i] /= norm;
    }
    polyphase24Kernels.push(k);
  }
  return polyphase24Kernels;
}

function upsamplePolyphase16To24(pcm16k: Int16Array): Int16Array {
  const kernels = getPolyphase24Kernels();
  const HALF = (POLY24_TAPS - 1) >> 1;
  const outLen = Math.ceil((pcm16k.length * 3) / 2);
  const out = new Int16Array(outLen);
  for (let n = 0; n < outLen; n++) {
    const phase = n % 3;
    // Input position: phase 0 → input index, phase 1 → input + 2/3, phase 2 → input + 1/3.
    // The integer "centre" is floor((n*2)/3); the kernel handles the fractional offset.
    const centreIn = Math.floor((n * 2) / 3);
    const k = kernels[phase]!;
    if (phase === 0) {
      out[n] = pcm16k[centreIn] ?? 0;
      continue;
    }
    let acc = 0;
    for (let t = -HALF; t <= HALF; t++) {
      const inIdx = centreIn + t;
      const sample = inIdx >= 0 && inIdx < pcm16k.length ? pcm16k[inIdx] : 0;
      acc += sample * k[t + HALF];
    }
    out[n] = clamp16(acc);
  }
  return out;
}

// --- soft saturation ----------------------------------------------------

function applySoftSaturationInPlace(pcm: Int16Array, amount: number): void {
  const clamped = Math.max(0, Math.min(1, amount));
  if (clamped === 0) return;
  const drive = 1 + clamped * 2;
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i] / 32768;
    pcm[i] = clamp16(Math.tanh(x * drive) * norm * 32768);
  }
}

// --- processor ----------------------------------------------------------

/**
 * Per-channel post-decode chain. Biquads hold state across frames within a
 * talk-spurt so filter response doesn't reset each 20 ms hop; call
 * `reset()` at talk-spurt boundaries (silence > a few hundred ms, or new
 * transmitter) so a previous talker's HPF / shelf transient doesn't bleed
 * into the next talker's first frame.
 */
export class PostDecodeProcessor {
  private readonly outputRate: 16000 | 24000;
  private readonly stages: Biquad[] = [];
  // Linear-upsample carryover so frame boundaries stay seamless.
  private readonly linearCarry = { prev: 0 };
  private readonly saturationAmount: number;
  private readonly upsampleMode: PostDecodeConfig["upsampleMode"];

  constructor(cfg: PostDecodeConfig) {
    this.upsampleMode = cfg.upsampleMode;
    this.outputRate = postDecodeOutputRate(cfg);
    // Biquads run at the output rate, AFTER upsampling. That matches the
    // Audio Lab's chain (the lab also runs post-decode shaping post-upsample
    // — see processClip in pipeline.ts).
    const fs = this.outputRate;
    if (cfg.hpfEnabled && cfg.hpfHz) {
      this.stages.push(Biquad.highpass(cfg.hpfHz, 0.707, fs));
    }
    if (cfg.lpfEnabled && cfg.lpfHz) {
      this.stages.push(Biquad.lowpass(cfg.lpfHz, 0.707, fs));
    }
    if (cfg.lowShelfEnabled) {
      this.stages.push(Biquad.lowshelf(cfg.lowShelfHz ?? 200, cfg.lowShelfDb ?? 0, fs));
    }
    if (cfg.highShelfEnabled) {
      this.stages.push(Biquad.highshelf(cfg.highShelfHz ?? 2500, cfg.highShelfDb ?? 0, fs));
    }
    if (cfg.presenceEnabled) {
      this.stages.push(
        Biquad.peak(cfg.presenceHz ?? 2200, cfg.presenceDb ?? 0, cfg.presenceQ ?? 1, fs),
      );
    }
    this.saturationAmount = cfg.saturationAmount ?? 0;
  }

  /** Sample rate of `process()`'s output. The voice client constructs its
   *  AudioContext at this rate; tearing the context down to swap rates
   *  mid-session is too disruptive for live audio. */
  rate(): 16000 | 24000 {
    return this.outputRate;
  }

  /** Clear filter state so a new talk-spurt opens from silence. */
  reset(): void {
    for (const stage of this.stages) {
      stage.reset();
    }
    this.linearCarry.prev = 0;
  }

  /** 160 samples @ 8 kHz in → 320 (16 kHz) or 480 (24 kHz) samples out. */
  process(pcm8k: Int16Array): Int16Array {
    // Stage 1: upsample 8 → 16.
    let pcm16: Int16Array;
    switch (this.upsampleMode) {
      case "linear":
        pcm16 = upsampleLinear8To16(pcm8k, this.linearCarry);
        break;
      case "polyphase":
      case "polyphase24":
        pcm16 = upsamplePolyphase8To16(pcm8k);
        break;
      case "duplicate":
      default:
        pcm16 = upsampleDup8To16(pcm8k);
        break;
    }
    // Stage 2: optional 16 → 24 polyphase.
    let shaped = this.upsampleMode === "polyphase24" ? upsamplePolyphase16To24(pcm16) : pcm16;
    // Stage 3: biquad chain at the output rate.
    for (const stage of this.stages) {
      stage.processInPlace(shaped);
    }
    // Stage 4: soft saturation (output already int16-clamped by the biquads).
    if (this.saturationAmount > 0) {
      applySoftSaturationInPlace(shaped, this.saturationAmount);
    }
    return shaped;
  }
}
