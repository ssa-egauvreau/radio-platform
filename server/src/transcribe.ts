// Background transcription of recorded transmissions using a self-hosted Whisper
// model (transformers.js / ONNX). Best-effort: failures never block recording.

import { enqueueAiDispatchForTransmission } from "./aiDispatch/engine.js";
import { getPool } from "./db.js";
import { getTransmissionAudio, listPendingTranscriptionIds, setTranscript } from "./store.js";
import { decodeWavToFloat32 } from "./wav.js";

const ENABLED = (process.env.TRANSCRIPTION ?? "on").trim().toLowerCase() !== "off";
const MODEL = process.env.WHISPER_MODEL?.trim() || "Xenova/whisper-tiny.en";
/** After a failed model load, wait before retrying (Railway OOM / cold start). */
const LOAD_RETRY_MS = Number(process.env.WHISPER_LOAD_RETRY_MS) || 120_000;

type TranscriberState = "idle" | "loading" | "ready" | "broken";

let state: TranscriberState = "idle";
let lastLoadFailedAt = 0;
type WhisperPipeline = (audio: Float32Array, options?: unknown) => Promise<{ text?: string }>;

let pipelineFn: WhisperPipeline | null = null;
let loadPromise: Promise<WhisperPipeline | null> | null = null;
const queue: number[] = [];
let working = false;

export interface TranscriptionDiagnostics {
  enabled: boolean;
  model: string;
  state: TranscriberState;
  database_configured: boolean;
  queue_depth: number;
  last_load_failed_at: string | null;
}

export function getTranscriptionDiagnostics(): TranscriptionDiagnostics {
  return {
    enabled: ENABLED,
    model: MODEL,
    state,
    database_configured: getPool() !== null,
    queue_depth: queue.length,
    last_load_failed_at: lastLoadFailedAt > 0 ? new Date(lastLoadFailedAt).toISOString() : null,
  };
}

/** Loads the Whisper pipeline once; returns null if it cannot be loaded. Retries after cooldown. */
async function ensurePipeline(): Promise<WhisperPipeline | null> {
  if (pipelineFn) {
    return pipelineFn;
  }
  if (state === "broken") {
    if (Date.now() - lastLoadFailedAt < LOAD_RETRY_MS) {
      return null;
    }
    console.log("[transcribe] retrying Whisper model load after previous failure");
    state = "idle";
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    state = "loading";
    try {
      const moduleName = "@huggingface/transformers";
      const transformers = (await import(moduleName)) as {
        pipeline: (task: string, model: string) => Promise<WhisperPipeline>;
      };
      pipelineFn = await transformers.pipeline("automatic-speech-recognition", MODEL);
      state = "ready";
      lastLoadFailedAt = 0;
      console.log(`Transcriber ready (model ${MODEL}).`);
    } catch (error) {
      state = "broken";
      lastLoadFailedAt = Date.now();
      pipelineFn = null;
      console.warn(
        "Transcriber unavailable — transmissions will be recorded without transcripts.",
        error,
      );
    }
    return pipelineFn;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function transcribeOne(id: number): Promise<void> {
  try {
    const record = await getTransmissionAudio(id);
    if (!record) {
      return;
    }
    const run = await ensurePipeline();
    if (!run) {
      await setTranscript(id, "failed", null);
      return;
    }
    const samples = decodeWavToFloat32(record.audio);
    if (samples.length === 0) {
      await setTranscript(id, "done", "");
      return;
    }
    const result = await run(samples, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (result?.text ?? "").trim();
    await setTranscript(id, "done", text);
    // Queue AI even when STT is empty so the activity log can record "no speech" skips.
    enqueueAiDispatchForTransmission(id);
  } catch (error) {
    console.warn(`Transcription failed for transmission ${id}`, error);
    await setTranscript(id, "failed", null).catch(() => undefined);
  }
}

async function pump(): Promise<void> {
  if (working) {
    return;
  }
  working = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      await transcribeOne(id);
    }
  } finally {
    working = false;
  }
}

/** Queues a freshly recorded transmission for transcription. */
export function enqueueTranscription(id: number): void {
  if (!ENABLED) {
    void setTranscript(id, "disabled", null).catch(() => undefined);
    return;
  }
  queue.push(id);
  void pump();
}

/** Re-queues any transmissions left pending by an earlier crash/restart. */
export async function recoverPendingTranscriptions(): Promise<void> {
  if (!ENABLED) {
    return;
  }
  try {
    const ids = await listPendingTranscriptionIds();
    for (const id of ids) {
      queue.push(id);
    }
    if (ids.length > 0) {
      console.log(`Re-queued ${ids.length} pending transcription(s).`);
      void pump();
    }
  } catch (error) {
    console.warn("Could not recover pending transcriptions", error);
  }
}
