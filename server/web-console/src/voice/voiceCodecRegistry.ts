/**
 * Voice codec wire identity for the web console.
 *
 * Mirrors `server/src/voiceCodecs.ts` and the Android/iOS enums so all four
 * ends agree byte-for-byte. Every voice frame the relay forwards starts
 * with the codec's two-byte magic prefix, which is how receivers route
 * each frame to the right decoder when channels can use different codecs.
 *
 * IMBE keeps its existing 0xF5 0xAB so older clients that predate this
 * registry stay on-wire compatible without any change.
 *
 * All three codecs (IMBE, Codec2 3200, Opus) are wired end-to-end on the
 * web console: IMBE via the bundled WASM vocoder, Codec2 via the
 * libcodec2 WASM build at vendor/codec2Module.js, and Opus via the
 * browser's built-in WebCodecs.
 */

export const VOICE_CODECS = ["imbe", "codec2_3200", "opus"] as const;
export type VoiceCodec = (typeof VOICE_CODECS)[number];

export const DEFAULT_VOICE_CODEC: VoiceCodec = "imbe";

interface CodecMagic {
  readonly b0: number;
  readonly b1: number;
}

const CODEC_MAGIC: Record<VoiceCodec, CodecMagic> = {
  imbe: { b0: 0xf5, b1: 0xab },
  codec2_3200: { b0: 0xc2, b1: 0x01 },
  opus: { b0: 0x4f, b1: 0x70 },
};

/** First two bytes of an inbound voice frame → which codec they identify. */
export function detectFrameCodec(bytes: Uint8Array): VoiceCodec | null {
  if (bytes.length < 2) return null;
  for (const codec of VOICE_CODECS) {
    const m = CODEC_MAGIC[codec];
    if (bytes[0] === m.b0 && bytes[1] === m.b1) {
      return codec;
    }
  }
  return null;
}

export function codecMagic(codec: VoiceCodec): CodecMagic {
  return CODEC_MAGIC[codec];
}

export function isVoiceCodec(value: unknown): value is VoiceCodec {
  return (
    typeof value === "string" &&
    (VOICE_CODECS as readonly string[]).includes(value)
  );
}

/** Codecs the web console can currently encode (TX). IMBE always.
 *  Codec2 always (the libcodec2 WASM is small and loads lazily; the
 *  encoder gates on codec2Ready() at use time so a not-yet-loaded
 *  module falls back to IMBE rather than failing the join). Opus
 *  when the browser exposes WebCodecs `AudioEncoder` — feature
 *  detection is the parameter here because some older browsers
 *  ship without WebCodecs. */
export function computeWebEncodeCaps(opusAvailable: boolean): readonly VoiceCodec[] {
  return opusAvailable
    ? ["imbe", "codec2_3200", "opus"]
    : ["imbe", "codec2_3200"];
}

/** Codecs the web console can currently decode (RX). IMBE always;
 *  Codec2 via the libcodec2 WASM; Opus via WebCodecs AudioDecoder
 *  when the browser supports it. All three are advertised optimistically
 *  because each one degrades gracefully at use time (isReady=false →
 *  frames drop with a one-shot log) on browsers that don't ship the
 *  required runtime, rather than crashing. */
export const WEB_DECODE_CAPS: readonly VoiceCodec[] = [
  "imbe",
  "codec2_3200",
  "opus",
];
