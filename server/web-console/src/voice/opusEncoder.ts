/**
 * Web Opus encoder, backed by the browser's built-in WebCodecs AudioEncoder.
 *
 * No npm dependency: AudioEncoder ships in Chromium 94+, Safari 16.4+, and
 * Firefox 130+. When the API isn't present (or the codec can't be configured),
 * `ready()` returns false and voiceClient falls back to IMBE on TX so the
 * dispatcher never goes mute on Opus channels just because their browser
 * doesn't ship the codec.
 *
 * WebCodecs is fundamentally async: AudioEncoder.encode(audioData) returns
 * immediately and the output EncodedAudioChunk arrives later via the
 * configured `output` callback. The wrapper bridges that to voiceClient by
 * taking an `onFramed` callback at construction time; the callback fires
 * for each completed frame with the wire-ready bytes (magic prefix + Opus
 * packet) and voiceClient hands them straight to the WebSocket.
 *
 * Output preserves input order — WebCodecs guarantees that — so the
 * callback can write to WebSocket in the order encode() was called.
 *
 * Voice profile: 16 kHz mono, 20 ms frame, 20 kbps wideband, VOIP
 * application. AudioEncoder doesn't expose FEC / DTX directly; the
 * browser picks reasonable defaults for the speech codec class.
 */

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz
const TARGET_BITRATE = 20_000;
const FRAME_DURATION_US = 20_000;
const OPUS_MAGIC_0 = 0x4f; // 'O'
const OPUS_MAGIC_1 = 0x70; // 'p'

type FramedHandler = (framed: ArrayBuffer) => void;

interface AudioEncoderLike {
  state: string;
  configure(config: AudioEncoderConfigLike): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
}

interface AudioEncoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
}

interface AudioEncoderCtorOptions {
  output: (chunk: EncodedAudioChunkLike, metadata?: unknown) => void;
  error: (err: DOMException) => void;
}

interface EncodedAudioChunkLike {
  type: "key" | "delta";
  timestamp: number;
  duration?: number;
  byteLength: number;
  copyTo(buffer: BufferSource): void;
}

interface AudioDataLike {
  close(): void;
}

interface AudioDataInit {
  format: string;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: BufferSource;
}

function getAudioEncoderCtor():
  | (new (init: AudioEncoderCtorOptions) => AudioEncoderLike)
  | null {
  const ctor = (globalThis as unknown as {
    AudioEncoder?: new (init: AudioEncoderCtorOptions) => AudioEncoderLike;
  }).AudioEncoder;
  return ctor ?? null;
}

function getAudioDataCtor():
  | (new (init: AudioDataInit) => AudioDataLike)
  | null {
  const ctor = (globalThis as unknown as {
    AudioData?: new (init: AudioDataInit) => AudioDataLike;
  }).AudioData;
  return ctor ?? null;
}

/** True iff the browser exposes the WebCodecs encoder + AudioData
 *  constructors voiceClient needs. Used for sync feature detection at
 *  join time so the caps array advertises Opus only when we can actually
 *  encode it. Does not attempt to construct or configure the encoder. */
export function opusEncoderAvailable(): boolean {
  return getAudioEncoderCtor() !== null && getAudioDataCtor() !== null;
}

export class OpusWebEncoder {
  private encoder: AudioEncoderLike | null = null;
  private timestampUs = 0;
  private configured = false;
  private readonly onFramed: FramedHandler;

  constructor(onFramed: FramedHandler) {
    this.onFramed = onFramed;
    this.start();
  }

  isReady(): boolean {
    return this.configured && this.encoder !== null && this.encoder.state !== "closed";
  }

  /** Feed one 20 ms PCM frame to the encoder. The output appears
   *  shortly after via the constructor's `onFramed` callback, in the
   *  same order encode() was called. No return value: the wire send
   *  happens inside the callback. */
  encodeFrame(pcm16: Int16Array): void {
    const enc = this.encoder;
    const DataCtor = getAudioDataCtor();
    if (!enc || !DataCtor || enc.state === "closed") return;
    if (pcm16.length !== FRAME_SAMPLES) {
      // Defensive — voiceClient always supplies 320-sample frames.
      console.warn(`[opus] encoder dropped frame: expected ${FRAME_SAMPLES} samples, got ${pcm16.length}`);
      return;
    }
    const float = new Float32Array(FRAME_SAMPLES);
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      float[i] = pcm16[i] / 32_768;
    }
    try {
      const audioData = new DataCtor({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: CHANNELS,
        timestamp: this.timestampUs,
        data: float,
      });
      enc.encode(audioData);
      audioData.close();
      this.timestampUs += FRAME_DURATION_US;
    } catch (err) {
      console.warn("[opus] encode threw — dropping frame", err);
    }
  }

  /** Best-effort flush of any in-flight frames. Used when PTT releases
   *  so the tail of a talk-spurt doesn't get stranded inside the encoder
   *  pipeline. */
  flush(): void {
    if (!this.encoder) return;
    void this.encoder.flush().catch((err) => {
      console.warn("[opus] flush failed", err);
    });
  }

  close(): void {
    if (this.encoder) {
      try { this.encoder.close(); } catch { /* already closed */ }
      this.encoder = null;
    }
    this.configured = false;
  }

  private start(): void {
    const Ctor = getAudioEncoderCtor();
    if (!Ctor) {
      console.warn(
        "[opus] AudioEncoder (WebCodecs) is not available in this browser — Opus channels will fall back to IMBE on TX.",
      );
      return;
    }
    try {
      const encoder = new Ctor({
        output: (chunk) => this.dispatchEncoded(chunk),
        error: (err) => {
          console.warn("[opus] encoder error", err);
        },
      });
      encoder.configure({
        codec: "opus",
        sampleRate: SAMPLE_RATE,
        numberOfChannels: CHANNELS,
        bitrate: TARGET_BITRATE,
      });
      this.encoder = encoder;
      this.configured = true;
    } catch (err) {
      console.warn(
        "[opus] AudioEncoder configure failed — Opus channels will fall back to IMBE on TX.",
        err,
      );
      this.configured = false;
    }
  }

  /** Wire framing: 2-byte Opus magic (0x4F 0x70) followed by the encoded
   *  packet. Matches the server's voiceCodecs.ts registry and the
   *  Android/iOS encoders so the relay can route by magic without
   *  decoding. */
  private dispatchEncoded(chunk: EncodedAudioChunkLike): void {
    try {
      const payload = new Uint8Array(chunk.byteLength);
      chunk.copyTo(payload);
      const framed = new Uint8Array(2 + payload.length);
      framed[0] = OPUS_MAGIC_0;
      framed[1] = OPUS_MAGIC_1;
      framed.set(payload, 2);
      this.onFramed(framed.buffer);
    } catch (err) {
      console.warn("[opus] dispatch failed", err);
    }
  }
}
