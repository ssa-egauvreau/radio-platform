import { getToken } from "../api";

const TARGET_RATE = 16_000;

let cachedPcm: Int16Array | null = null;
let loadPromise: Promise<Int16Array> | null = null;

function audioBufferToPcm16(buffer: AudioBuffer): Int16Array {
  const channels = buffer.numberOfChannels;
  const len = buffer.length;
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let sample = 0;
    for (let ch = 0; ch < channels; ch++) {
      sample += buffer.getChannelData(ch)[i] ?? 0;
    }
    sample /= channels;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

function resamplePcm(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) {
    return input;
  }
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * fromRate) / toRate;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[Math.min(idx, input.length - 1)] ?? 0;
    const b = input[Math.min(idx + 1, input.length - 1)] ?? a;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

/** Loads the 10-33 marker WAV (agency custom or bundled default) as 16 kHz mono PCM-16. */
export async function loadMarker1033Pcm(): Promise<Int16Array> {
  if (cachedPcm) {
    return cachedPcm;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      const token = getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      let url = "/sounds/marker_1033.wav";
      try {
        const res = await fetch("/v1/sounds/marker_1033", { headers });
        if (res.ok) {
          const blob = await res.blob();
          url = URL.createObjectURL(blob);
        }
      } catch {
        /* bundled default */
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("marker_wav_missing");
      }
      const arrayBuffer = await response.arrayBuffer();
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      await ctx.close();
      let pcm = audioBufferToPcm16(decoded);
      if (decoded.sampleRate !== TARGET_RATE) {
        pcm = resamplePcm(pcm, decoded.sampleRate, TARGET_RATE);
      }
      cachedPcm = pcm;
      return pcm;
    })();
  }
  return loadPromise;
}

/** Drops the cached marker PCM so the next play re-fetches the current tone. */
export function resetMarker1033Cache(): void {
  cachedPcm = null;
  loadPromise = null;
}
