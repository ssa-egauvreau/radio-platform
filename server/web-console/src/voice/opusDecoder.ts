/**
 * Web Opus decoder, backed by the browser's built-in WebCodecs AudioDecoder.
 *
 * No npm dependency: AudioDecoder ships in Chromium 94+, Safari 16.4+, and
 * Firefox 130+ (behind a flag in some older builds). When the API isn't
 * present (or the codec can't be configured for any reason), this module's
 * `ready()` returns false and voiceClient drops inbound Opus frames with a
 * one-shot warning — falling back to silence on Opus channels rather than
 * playing the encoded bytes as PCM noise.
 *
 * WebCodecs is fundamentally async: AudioDecoder.decode(chunk) returns
 * immediately and the output AudioData arrives later via the configured
 * `output` callback. The wrapper bridges that to voiceClient by accepting
 * an `onPcm` callback at construction time and calling it as soon as each
 * decoded frame is ready. The existing AudioContext scheduling cushion
 * (playHead in voiceClient) absorbs the small per-frame jitter.
 *
 * Voice profile: 16 kHz mono, matching the rest of the platform.
 */

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;

type DecodedHandler = (pcm: Int16Array) => void;

interface AudioDecoderLike {
  state: string;
  configure(config: AudioDecoderConfigLike): void;
  decode(chunk: EncodedAudioChunkLike): void;
  close(): void;
}

interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
}

interface EncodedAudioChunkLike {
  type: "key" | "delta";
  timestamp: number;
  duration?: number;
  data: BufferSource;
}

interface AudioDecoderCtorOptions {
  output: (data: AudioDataLike) => void;
  error: (err: DOMException) => void;
}

interface AudioDataLike {
  format: string | null;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  allocationSize(opts: { planeIndex: number; format?: string }): number;
  copyTo(buffer: BufferSource, opts: { planeIndex: number; format?: string }): void;
  close(): void;
}

/** Runtime feature detection — doesn't reach for `globalThis.AudioDecoder`
 *  until called so the module-level evaluation never throws in a build that
 *  predates WebCodecs. */
function getAudioDecoderCtor():
  | (new (init: AudioDecoderCtorOptions) => AudioDecoderLike)
  | null {
  const ctor = (globalThis as unknown as {
    AudioDecoder?: new (init: AudioDecoderCtorOptions) => AudioDecoderLike;
  }).AudioDecoder;
  return ctor ?? null;
}

function getEncodedAudioChunkCtor():
  | (new (init: { type: "key" | "delta"; timestamp: number; data: BufferSource }) => EncodedAudioChunkLike)
  | null {
  const ctor = (globalThis as unknown as {
    EncodedAudioChunk?: new (init: { type: "key" | "delta"; timestamp: number; data: BufferSource }) => EncodedAudioChunkLike;
  }).EncodedAudioChunk;
  return ctor ?? null;
}

export class OpusWebDecoder {
  private decoder: AudioDecoderLike | null = null;
  private timestampUs: number = 0;
  /** True once `configure` succeeded. WebCodecs.configure runs validation
   *  before the first decode, so `isReady` is only meaningful after we've
   *  attempted setup. */
  private configured: boolean = false;
  private readonly onPcm: DecodedHandler;

  constructor(onPcm: DecodedHandler) {
    this.onPcm = onPcm;
    this.start();
  }

  /** True iff the browser supports the Opus AudioDecoder and configure
   *  succeeded. voiceClient checks this each frame; a runtime failure
   *  drops the decoder and is reported once at construction. */
  isReady(): boolean {
    return this.configured && this.decoder !== null && this.decoder.state !== "closed";
  }

  decodeFrame(opusPayload: Uint8Array): void {
    const dec = this.decoder;
    const chunkCtor = getEncodedAudioChunkCtor();
    if (!dec || !chunkCtor || dec.state === "closed") return;
    try {
      // BufferSource type guards against SharedArrayBuffer; an opus payload
      // sliced from a WebSocket ArrayBuffer is always plain so the cast is
      // safe. Copy into a fresh ArrayBuffer to drop the wider type.
      const payloadCopy = opusPayload.slice().buffer;
      const chunk = new chunkCtor({
        type: "key",
        timestamp: this.timestampUs,
        data: payloadCopy,
      });
      dec.decode(chunk);
      // 20 ms per frame at 16 kHz = 20_000 µs.
      this.timestampUs += 20_000;
    } catch (err) {
      console.warn("[opus] decode threw — dropping frame", err);
    }
  }

  close(): void {
    if (this.decoder) {
      try { this.decoder.close(); } catch { /* already closed */ }
      this.decoder = null;
    }
    this.configured = false;
  }

  private start(): void {
    const Ctor = getAudioDecoderCtor();
    if (!Ctor) {
      console.warn(
        "[opus] AudioDecoder (WebCodecs) is not available in this browser — Opus channels will be silent.",
      );
      return;
    }
    try {
      const decoder = new Ctor({
        output: (data) => this.dispatchDecoded(data),
        error: (err) => {
          console.warn("[opus] decoder error", err);
        },
      });
      decoder.configure({
        codec: "opus",
        sampleRate: SAMPLE_RATE,
        numberOfChannels: CHANNELS,
      });
      this.decoder = decoder;
      this.configured = true;
    } catch (err) {
      console.warn(
        "[opus] AudioDecoder configure failed — Opus channels will be silent.",
        err,
      );
      this.configured = false;
    }
  }

  /** Convert WebCodecs AudioData (float32 PCM at the codec's sample rate)
   *  to the Int16 the rest of voiceClient expects. */
  private dispatchDecoded(data: AudioDataLike): void {
    try {
      const frameCount = data.numberOfFrames;
      if (frameCount <= 0) {
        data.close();
        return;
      }
      // AudioData planes are per-channel; mono = plane 0.
      const float = new Float32Array(frameCount);
      data.copyTo(float, { planeIndex: 0, format: "f32-planar" });
      const pcm = new Int16Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        const v = float[i];
        const clamped = v < -1 ? -1 : v > 1 ? 1 : v;
        pcm[i] = Math.round(clamped * 0x7fff);
      }
      data.close();
      this.onPcm(pcm);
    } catch (err) {
      console.warn("[opus] dispatch failed", err);
      try { data.close(); } catch { /* ignore */ }
    }
  }
}
