// Client-side IMBE encode/decode roundtrip + WAV packaging.
//
// Used by the Transmission Log's "Play as broadcast" button so admins can A/B
// the stored clear PCM against what listeners actually heard over the air.
// The roundtrip is intentionally a simulation rather than the exact bytes
// that went on-air — IMBE is deterministic for the same input, so the
// perceptual result is identical, and storing both versions per transmission
// would double recording-blob storage with no audible difference.

import { imbeDecode, imbeEncode, imbeReady, initImbe } from "./imbeVocoder";

const IMBE_FRAME_8K_SAMPLES = 160;

/**
 * Take 16 kHz PCM-16 mono and run it through the IMBE encode/decode roundtrip
 * the production TX/RX path uses (16→8 kHz average downsample, encode, decode,
 * 8→16 kHz sample-duplicate upsample). Returns 16 kHz PCM-16. Frames that fail
 * to encode/decode are dropped, so the output may be slightly shorter than the
 * input. Throws if the IMBE WASM module is unavailable.
 */
export async function imbeRoundtripPcm16k(pcm16k: Int16Array): Promise<Int16Array> {
  if (!imbeReady()) {
    const ok = await initImbe();
    if (!ok) {
      throw new Error("IMBE vocoder unavailable — WASM failed to load");
    }
  }

  // 16 → 8 kHz by averaging adjacent samples — matches the voice-client TX
  // downsample so the roundtrip simulation feeds the codec the same data
  // the live encoder would see.
  const pcm8k = new Int16Array(pcm16k.length >> 1);
  for (let i = 0; i < pcm8k.length; i++) {
    pcm8k[i] = (pcm16k[2 * i] + pcm16k[2 * i + 1]) >> 1;
  }

  // Encode + decode frame-by-frame. A dropped frame is rare (only when the
  // WASM call returns null) and just removes a single 20 ms slice from the
  // output — preferable to padding silence which would shift downstream
  // perception.
  const decoded8k = new Int16Array(pcm8k.length);
  let outOff = 0;
  for (let off = 0; off + IMBE_FRAME_8K_SAMPLES <= pcm8k.length; off += IMBE_FRAME_8K_SAMPLES) {
    const cw = imbeEncode(pcm8k.subarray(off, off + IMBE_FRAME_8K_SAMPLES));
    if (!cw) continue;
    const out = imbeDecode(cw);
    if (!out) continue;
    decoded8k.set(out, outOff);
    outOff += IMBE_FRAME_8K_SAMPLES;
  }
  const decoded = decoded8k.subarray(0, outOff);

  // 8 → 16 kHz by sample duplication — mirrors the default production
  // upsample (the polyphase modes are listening-only on the lab path).
  const out16k = new Int16Array(decoded.length * 2);
  for (let i = 0; i < decoded.length; i++) {
    out16k[2 * i] = decoded[i];
    out16k[2 * i + 1] = decoded[i];
  }
  return out16k;
}

/**
 * Wrap 16-bit mono PCM in a minimal RIFF/WAVE header so an <audio> element
 * (or createObjectURL) can play it directly. 44-byte header + raw little-
 * endian samples — same layout as `server/src/wav.ts` so files produced here
 * are byte-for-byte compatible with the server-side recorder.
 */
export function pcm16ToWavBlob(pcm: Int16Array, sampleRate: number): Blob {
  const byteRate = sampleRate * 2;
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  // fmt chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // num channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align (mono * 16-bit / 8)
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  // Samples
  const samples = new Int16Array(buf, 44);
  samples.set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
