// Local in-process text embeddings for the AI dispatcher knowledge base
// (transformers.js / ONNX). Mirrors the lazy, degrade-to-null loader in
// transcribe.ts: a failed model load (Railway OOM / cold start) never throws —
// callers treat a null result as "no knowledge base" and proceed unchanged.

const MODEL = process.env.KB_EMBED_MODEL?.trim() || "Xenova/all-MiniLM-L6-v2";
/** q8 quarters the memory footprint vs fp32 — same reasoning as WHISPER_DTYPE. */
const DTYPE = process.env.KB_EMBED_DTYPE?.trim() || "q8";
/** After a failed model load, wait before retrying (Railway OOM / cold start). */
const LOAD_RETRY_MS = Number(process.env.KB_EMBED_LOAD_RETRY_MS) || 120_000;
/** Cap how long a caller waits on the first model load before giving up for now. */
const LOAD_TIMEOUT_MS = Number(process.env.KB_EMBED_LOAD_TIMEOUT_MS) || 180_000;

type EmbedPipeline = (
  texts: string[],
  options?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ tolist: () => number[][] }>;

let pipelineFn: EmbedPipeline | null = null;
let loadPromise: Promise<EmbedPipeline | null> | null = null;
let state: "idle" | "loading" | "ready" | "broken" = "idle";
let lastLoadFailedAt = 0;

export function getEmbeddingDiagnostics(): {
  model: string;
  state: string;
  last_load_failed_at: string | null;
} {
  return {
    model: MODEL,
    state,
    last_load_failed_at: lastLoadFailedAt > 0 ? new Date(lastLoadFailedAt).toISOString() : null,
  };
}

async function ensurePipeline(): Promise<EmbedPipeline | null> {
  if (pipelineFn) {
    return pipelineFn;
  }
  if (state === "broken") {
    if (Date.now() - lastLoadFailedAt < LOAD_RETRY_MS) {
      return null;
    }
    console.log("[kb] retrying embedding model load after previous failure");
    state = "idle";
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      state = "loading";
      try {
        const moduleName = "@huggingface/transformers";
        const transformers = (await import(moduleName)) as {
          pipeline: (
            task: string,
            model: string,
            options?: Record<string, unknown>,
          ) => Promise<EmbedPipeline>;
        };
        pipelineFn = await transformers.pipeline("feature-extraction", MODEL, {
          dtype: DTYPE,
          device: "cpu",
        });
        state = "ready";
        lastLoadFailedAt = 0;
        console.log(`[kb] embedding model ready (model ${MODEL}, dtype ${DTYPE}).`);
      } catch (error) {
        state = "broken";
        lastLoadFailedAt = Date.now();
        pipelineFn = null;
        console.warn("[kb] embedding model unavailable — knowledge base retrieval disabled.", error);
      } finally {
        loadPromise = null;
      }
      return pipelineFn;
    })();
  }

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[kb] embedding model load exceeded ${LOAD_TIMEOUT_MS}ms; skipping for now.`);
      resolve(null);
    }, LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([loadPromise ?? Promise.resolve(pipelineFn), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Embeds texts into normalized vectors (cosine similarity == dot product).
 * Returns null when the model cannot be loaded so callers degrade gracefully.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) {
    return [];
  }
  const run = await ensurePipeline();
  if (!run) {
    return null;
  }
  try {
    const output = await run(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  } catch (error) {
    console.warn("[kb] embedding inference failed", error);
    return null;
  }
}
