// Turns an uploaded PDF into retrievable knowledge: extract text → chunk →
// embed → store chunks, flipping the document's status to ready/failed. Runs
// best-effort in the background after upload so the admin response stays fast.

import {
  getKbDocumentForIngest,
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

/** Fire-and-forget ingest so the upload request returns immediately. */
export function enqueueKbIngest(documentId: number): void {
  void ingestDocument(documentId).catch((error) => {
    console.warn(`[kb] background ingest threw for document ${documentId}`, error);
  });
}
