// Mic capture for the Audio Lab. Reuses the existing pcm-capture worklet so the recorded
// clip matches what a live talker would feed into the relay (16 kHz mono Int16, 40 ms
// frames). One-shot — caller owns start/stop and gets the accumulated PCM at stop.

const TARGET_RATE = 16_000;
const CAPTURE_WORKLET_URL = "/pcm-capture-worklet.js";

/** Maximum clip length — clips are processed entirely in memory and shipped over a WS
 *  if the user pushes to a channel, so a sane upper bound keeps both honest. */
export const MAX_CLIP_SECONDS = 15;

export interface LabRecorder {
  /** Live RMS amplitude (0–1) — call from a UI animation frame for a meter. */
  getLevel(): number;
  /** Stops the worklet, releases the mic, and returns the accumulated PCM. */
  stop(): Int16Array;
  /** True once the maximum clip length is reached and capture auto-stopped. */
  hitMaxLength: boolean;
}

/** Begins a new recording session. Throws if the mic is unavailable or denied. */
export async function startLabRecorder(opts: { onAutoStop?: () => void } = {}): Promise<LabRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate: TARGET_RATE });
  await ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");

  // Analyser tap for the level meter; lives in parallel with the worklet so the worklet
  // pipeline is unmodified.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const levelBytes = new Uint8Array(analyser.fftSize);
  src.connect(analyser);

  const chunks: Int16Array[] = [];
  let totalSamples = 0;
  const maxSamples = MAX_CLIP_SECONDS * TARGET_RATE;
  let hitMax = false;
  let stopped = false;

  const cleanup = () => {
    node.port.onmessage = null;
    try {
      node.disconnect();
      src.disconnect();
      analyser.disconnect();
    } catch {
      /* already torn down */
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    void ctx.close().catch(() => {
      /* ignore */
    });
  };

  node.port.onmessage = (event: MessageEvent) => {
    if (stopped || !(event.data instanceof ArrayBuffer)) {
      return;
    }
    const remaining = maxSamples - totalSamples;
    if (remaining <= 0) {
      return;
    }
    const incoming = new Int16Array(event.data);
    if (incoming.length <= remaining) {
      chunks.push(incoming);
      totalSamples += incoming.length;
    } else {
      // Trim the last frame so we never exceed the cap.
      const trimmed = new Int16Array(incoming.buffer, incoming.byteOffset, remaining);
      chunks.push(new Int16Array(trimmed)); // copy — buffer reuse not guaranteed
      totalSamples += remaining;
      hitMax = true;
      // Defer onAutoStop so the caller can stop() us synchronously without races.
      queueMicrotask(() => opts.onAutoStop?.());
    }
  };
  src.connect(node);
  // Silent sink keeps the worklet pulled.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);

  const handle: LabRecorder = {
    hitMaxLength: false,
    getLevel(): number {
      analyser.getByteTimeDomainData(levelBytes);
      let sumSq = 0;
      for (let i = 0; i < levelBytes.length; i++) {
        const v = (levelBytes[i] - 128) / 128;
        sumSq += v * v;
      }
      return Math.sqrt(sumSq / levelBytes.length);
    },
    stop(): Int16Array {
      if (stopped) {
        // Idempotent — concat what we already have.
        return concat(chunks, totalSamples);
      }
      stopped = true;
      cleanup();
      handle.hitMaxLength = hitMax;
      return concat(chunks, totalSamples);
    },
  };
  return handle;
}

function concat(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export const LAB_SAMPLE_RATE = TARGET_RATE;
