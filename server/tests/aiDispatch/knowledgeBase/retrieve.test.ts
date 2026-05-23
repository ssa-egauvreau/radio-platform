/**
 * Tests for the pure ranking + formatting helpers in
 * `server/src/aiDispatch/knowledgeBase/retrieve.ts`.
 *
 * These functions are what decide which agency knowledge chunks the AI
 * dispatcher actually sees on a given transmission. A regression here can:
 *   - inject the wrong policy/property snippet into the dispatcher prompt
 *     (officers get bad guidance over the air), or
 *   - blow past the user-turn token cap and break the LLM call entirely.
 *
 * The full `retrieveKnowledge` flow is intentionally not exercised here
 * because it depends on a Postgres pool and the Hugging Face transformers
 * model loader; both are unavailable in the unit-test environment. The
 * pure scoring + formatting is exercised directly via the exported helpers.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatKnowledgeContext,
  rankChunks,
  type RetrievedChunk,
} from "../../../src/aiDispatch/knowledgeBase/retrieve.js";
import type { KbChunkRow } from "../../../src/store.js";

function chunk(over: Partial<KbChunkRow> = {}): KbChunkRow {
  return {
    id: over.id ?? "chunk-1",
    document_id: over.document_id ?? 100,
    title: over.title ?? "Property handbook",
    category: over.category ?? "property_info",
    property_code: over.property_code ?? null,
    content: over.content ?? "Access via main gate.",
    embedding: over.embedding ?? [1, 0, 0],
  };
}

// -------------------- rankChunks --------------------

test("rankChunks ranks chunks by cosine similarity to the query", () => {
  // Query [1,0,0] is most similar to [1,0,0], then [.7,.7,0], then [0,1,0].
  const chunks: KbChunkRow[] = [
    chunk({ id: "c1", title: "exact",   embedding: [1, 0, 0] }),
    chunk({ id: "c2", title: "diag",    embedding: [Math.SQRT1_2, Math.SQRT1_2, 0] }),
    chunk({ id: "c3", title: "ortho",   embedding: [0, 1, 0] }),
  ];
  const out = rankChunks([1, 0, 0], chunks, { topK: 3 });
  // The orthogonal vector scores 0 which is below the default MIN_SCORE=0.25
  // and gets filtered out.
  assert.equal(out.length, 2);
  assert.equal(out[0]!.title, "exact");
  assert.equal(out[1]!.title, "diag");
  assert.ok(out[0]!.score > out[1]!.score);
});

test("rankChunks drops chunks whose score is below the MIN_SCORE threshold", () => {
  const chunks: KbChunkRow[] = [
    chunk({ id: "weak", title: "weak", embedding: [0.1, 0.99, 0] }),
    chunk({ id: "strong", title: "strong", embedding: [1, 0, 0] }),
  ];
  const out = rankChunks([1, 0, 0], chunks, { topK: 5 });
  // Only "strong" survives (cosine ~= 0.1 vs 1.0).
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "strong");
});

test("rankChunks honors the topK cap (with topK<=0 floored to 1)", () => {
  const chunks: KbChunkRow[] = [
    chunk({ id: "a", title: "a", embedding: [1, 0, 0] }),
    chunk({ id: "b", title: "b", embedding: [0.95, 0, 0] }),
    chunk({ id: "c", title: "c", embedding: [0.9, 0, 0] }),
  ];
  const top1 = rankChunks([1, 0, 0], chunks, { topK: 1 });
  assert.equal(top1.length, 1);
  assert.equal(top1[0]!.title, "a");

  // Implementation floors negative/zero topK to 1 (Math.max(1, topK)).
  const zero = rankChunks([1, 0, 0], chunks, { topK: 0 });
  assert.equal(zero.length, 1);
});

test("rankChunks gives a property-tagged chunk an explicit boost", () => {
  // Without the boost, "matched" would lose to "high-only" by a hair.
  const chunks: KbChunkRow[] = [
    chunk({
      id: "matched",
      title: "property match",
      property_code: "1806",
      embedding: [0.9, 0, 0], // cosine ≈ 0.9
    }),
    chunk({
      id: "highOnly",
      title: "no property",
      property_code: null,
      embedding: [0.95, 0, 0], // cosine ≈ 0.95
    }),
  ];
  const without = rankChunks([1, 0, 0], chunks, { topK: 5 });
  assert.equal(without[0]!.title, "no property", "no boost without propertyCode");

  const withBoost = rankChunks([1, 0, 0], chunks, { topK: 5, propertyCode: "1806" });
  // Boost (default 0.15) lifts "property match" above "no property".
  assert.equal(withBoost[0]!.title, "property match");
});

test("rankChunks ignores property boost when codes don't match", () => {
  const chunks: KbChunkRow[] = [
    chunk({
      id: "wrongprop",
      title: "wrong property",
      property_code: "9999",
      embedding: [0.9, 0, 0],
    }),
    chunk({
      id: "highOnly",
      title: "no property",
      embedding: [0.95, 0, 0],
    }),
  ];
  const out = rankChunks([1, 0, 0], chunks, { topK: 5, propertyCode: "1806" });
  // Property code doesn't match → no boost → "no property" wins.
  assert.equal(out[0]!.title, "no property");
});

test("rankChunks scores zero (and filters) when the embedding lengths don't match", () => {
  // A model swap leaves old chunks with a different vector length; cosine()
  // returns 0 in that case to keep them out of the result set.
  const chunks: KbChunkRow[] = [
    chunk({ id: "stale", title: "stale", embedding: [1, 0] }),     // 2-dim
    chunk({ id: "fresh", title: "fresh", embedding: [1, 0, 0] }),  // 3-dim
  ];
  const out = rankChunks([1, 0, 0], chunks, { topK: 5 });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, "fresh");
});

test("rankChunks returns [] when no chunks beat the threshold", () => {
  const chunks: KbChunkRow[] = [
    chunk({ embedding: [0, 1, 0] }),
    chunk({ embedding: [0, 0, 1] }),
  ];
  const out = rankChunks([1, 0, 0], chunks, { topK: 5 });
  assert.deepEqual(out, []);
});

// -------------------- formatKnowledgeContext --------------------

test("formatKnowledgeContext returns '' when there are no ranked chunks", () => {
  assert.equal(formatKnowledgeContext([]), "");
});

test("formatKnowledgeContext labels each chunk with [<category>: <title>]", () => {
  const chunks: RetrievedChunk[] = [
    {
      documentId: 1,
      title: "Main gate codes",
      category: "property_info",
      score: 0.9,
      content: "Gate code is 1234.",
    },
    {
      documentId: 2,
      title: "After-hours roster",
      category: "contact_directory",
      score: 0.8,
      content: "Call 555-0100.",
    },
  ];
  const out = formatKnowledgeContext(chunks);
  // Each entry: [<friendly category label>: <title>]\n<content>
  // Joined by a blank line.
  assert.match(out, /^\[Property information: Main gate codes\]\nGate code is 1234\.\n\n\[Contacts and escalation: After-hours roster\]\nCall 555-0100\.$/);
});

test("formatKnowledgeContext uses 'Reference' as the fallback label for unknown categories", () => {
  const out = formatKnowledgeContext([
    {
      documentId: 1,
      title: "Mystery",
      category: "novel_category",
      score: 0.9,
      content: "x",
    },
  ]);
  assert.match(out, /^\[Reference: Mystery\]/);
});

test("formatKnowledgeContext stops appending once it would exceed the char cap", () => {
  // The cap is MAX_CONTEXT_CHARS=4000 (env: KB_MAX_CONTEXT_CHARS). We construct
  // entries with predictable sizes and verify the second one is dropped.
  const big = "X".repeat(3500);
  const chunks: RetrievedChunk[] = [
    { documentId: 1, title: "First", category: "property_info", score: 1, content: big },
    { documentId: 2, title: "Second", category: "property_info", score: 0.9, content: big },
    { documentId: 3, title: "Third", category: "property_info", score: 0.8, content: big },
  ];
  const out = formatKnowledgeContext(chunks);
  // First chunk is always kept (>=1 line); subsequent chunks are skipped once
  // the running total would exceed the cap.
  assert.ok(out.includes("First"), "first chunk should be present");
  assert.ok(!out.includes("Second"), "second chunk should have been dropped");
  assert.ok(!out.includes("Third"), "third chunk should have been dropped");
});
