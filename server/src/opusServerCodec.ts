// Server-side Opus decode for the transmission recorder. Uses the
// `opus-decoder` WASM build (libopus) so Railway/Linux deploys do not need
// native codecs. Wire format matches Android/iOS/web: 0x4F 0x70 magic +
// one Opus packet per 20 ms frame @ 16 kHz mono.

import { OpusDecoder } from "opus-decoder";

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
/** Typical 20 ms @ 16 kHz; actual decoded length follows the packet. */
const EXPECTED_SAMPLES_PER_FRAME = 320;
/** Pre-warmed decoders — one per concurrent Opus talk-spurt on the recorder. */
const POOL_SIZE = 8;

type OpusDecoderInstance = InstanceType<typeof OpusDecoder>;

let initPromise: Promise<boolean> | null = null;
let wasmReady = false;
const pool: OpusDecoderInstance[] = [];
let poolFill: Promise<void> | null = null;

async function load(): Promise<boolean> {
  try {
    await fillPool();
    wasmReady = true;
    return true;
  } catch (error) {
    console.warn(
      "Opus vocoder unavailable — Opus transmissions will fall back to the clear-PCM sideband for recording.",
      error,
    );
    wasmReady = false;
    return false;
  }
}

async function fillPool(): Promise<void> {
  while (pool.length < POOL_SIZE) {
    const decoder = new OpusDecoder({
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      preSkip: 0,
    });
    await decoder.ready;
    pool.push(decoder);
  }
}

/** Loads libopus WASM once and pre-warms a decoder pool. */
export async function initServerOpus(): Promise<boolean> {
  if (!initPromise) {
    initPromise = load();
  }
  return initPromise;
}

/** A decoder dedicated to one digital talk-spurt. Call free() when it ends. */
export interface OpusStreamDecoder {
  /** Decodes a framed Opus packet (2-byte magic + payload) to 16 kHz PCM-16. */
  decode(framed: Buffer): Buffer | null;
  free(): void;
}

function float32ToPcm16LE(samples: Float32Array, count: number): Buffer {
  const out = Buffer.allocUnsafe(count * 2);
  for (let i = 0; i < count; i++) {
    let s = samples[i];
    if (s > 1) {
      s = 1;
    } else if (s < -1) {
      s = -1;
    }
    out.writeInt16LE((s * 32767) | 0, i * 2);
  }
  return out;
}

/** Creates an isolated Opus decoder, or null if the vocoder is unavailable. */
export function createOpusDecoder(): OpusStreamDecoder | null {
  if (!wasmReady) {
    return null;
  }
  const decoder = pool.pop();
  if (!decoder) {
    if (!poolFill) {
      poolFill = fillPool().finally(() => {
        poolFill = null;
      });
    }
    return null;
  }
  let freed = false;

  return {
    decode(framed: Buffer): Buffer | null {
      if (freed || framed.length < 3) {
        return null;
      }
      if (framed[0] !== 0x4f || framed[1] !== 0x70) {
        return null;
      }
      const payload = framed.subarray(2);
      if (payload.length === 0 || payload.length > 1275) {
        return null;
      }
      try {
        const result = decoder.decodeFrame(payload);
        if (result.errors.length > 0 || result.samplesDecoded <= 0) {
          return null;
        }
        const channel = result.channelData[0];
        if (!channel) {
          return null;
        }
        return float32ToPcm16LE(channel, result.samplesDecoded);
      } catch {
        return null;
      }
    },
    free() {
      if (freed) {
        return;
      }
      freed = true;
      try {
        void decoder.reset().then(() => {
          if (pool.length < POOL_SIZE) {
            pool.push(decoder);
          } else {
            decoder.free();
          }
        });
      } catch {
        try {
          decoder.free();
        } catch {
          /* already torn down */
        }
      }
    },
  };
}

/** Exported for tests — expected PCM bytes when a full 20 ms frame decodes. */
export const OPUS_EXPECTED_PCM_BYTES = EXPECTED_SAMPLES_PER_FRAME * 2;
