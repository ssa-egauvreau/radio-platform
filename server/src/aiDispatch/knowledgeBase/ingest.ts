// Turns an uploaded PDF into retrievable knowledge: extract text → chunk →
// embed → store chunks, flipping the document's status to ready/failed. Runs
// best-effort in the background after upload so the admin response stays fast.

import {
  getKbDocumentForIngest,
  listProcessingKbDocumentIds,
  replaceKbChunks,
  setKbDocumentStatus,
} from "../../store.js";
import { chunkText } from "./chunk.js";
import { embedTexts } from "./embeddings.js";
import { extractPdfText } from "./pdfText.js";

const MAX_CHUNKS = Number(process.env.KB_MAX_CHUNKS_PER_DOC) || 400;

export async function ingestDocument(documentId: number): Promise<void> {
  let doc: { id: number; agency_id: number; content: Buffer } | null = null;
  try {
    doc = await getKbDocumentForIngest(documentId);
    if (!doc) {
      return;
    }
    // Reset to processing so a re-index reflects progress in the admin UI (and
    // its status poll re-engages); a fresh upload is already 'processing'.
    await setKbDocumentStatus(documentId, "processing", { error: null });

    const text = await extractPdfText(doc.content);
    if (!text.trim()) {
      await setKbDocumentStatus(documentId, "failed", {
        error: "No extractable text (the PDF may be a scanned image — OCR is not supported).",
        chunkCount: 0,
        extractedText: "",
      });
      return;
    }

    const chunks = chunkText(text).slice(0, MAX_CHUNKS);
    const embeddings = await embedTexts(chunks);
    if (!embeddings) {
      await setKbDocumentStatus(documentId, "failed", {
        error: "Embedding model unavailable. Re-index once it has loaded.",
      });
      return;
    }

    await replaceKbChunks(
      documentId,
      doc.agency_id,
      chunks.map((content, i) => ({ content, embedding: embeddings[i]! })),
    );
    await setKbDocumentStatus(documentId, "ready", {
      error: null,
      chunkCount: chunks.length,
      extractedText: text,
    });
    console.log(`[kb] ingested document ${documentId}: ${chunks.length} chunk(s).`);
  } catch (error) {
    console.warn(`[kb] ingest failed for document ${documentId}`, error);
    await setKbDocumentStatus(documentId, "failed", {
      error: error instanceof Error ? error.message.slice(0, 500) : "Ingest failed.",
    }).catch(() => undefined);
  }
}

// Serialize ingestion: each document loads the embedding model and runs PDF
// parsing + inference, so running several at once (e.g. a bulk upload) multiplies
// peak memory and can OOM a constrained box. One worker at a time, like the
// transcription queue.
const queue: number[] = [];
let working = false;

async function pump(): Promise<void> {
  if (working) {
    return;
  }
  working = true;
  try {
    while (queue.length > 0) {
      await ingestDocument(queue.shift()!);
    }
  } finally {
    working = false;
  }
}

/** Fire-and-forget ingest so the upload request returns immediately. */
export function enqueueKbIngest(documentId: number): void {
  queue.push(documentId);
  void pump();
}

/** Re-queues documents left in 'processing' by an earlier crash/restart. */
export async function recoverPendingKbIngests(): Promise<void> {
  try {
    const ids = await listProcessingKbDocumentIds();
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      queue.push(id);
    }
    console.log(`[kb] re-queued ${ids.length} document(s) left processing.`);
    void pump();
  } catch (error) {
    console.warn("[kb] could not recover pending ingests", error);
  }
}
