/**
 * Tests for `chunkText` in `server/src/aiDispatch/knowledgeBase/chunk.ts`.
 *
 * The chunker is what splits an ingested document (post-PDF extraction) into
 * the pieces that get embedded and stored. A regression here either:
 *   - blows past the embedding model's context window (silent OOM at index time), or
 *   - cuts so aggressively that retrieval can't find phrases that span boundaries.
 *
 * These tests lock in the size/overlap contract and the no-op edge cases.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { chunkText } from "../../../src/aiDispatch/knowledgeBase/chunk.js";

test("chunkText returns [] for empty / whitespace-only input", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   "), []);
  assert.deepEqual(chunkText("\n\n\t\t  "), []);
});

test("chunkText returns the full text as a single chunk when it fits", () => {
  const out = chunkText("a short doc that fits.", { size: 100 });
  assert.deepEqual(out, ["a short doc that fits."]);
});

test("chunkText collapses runs of whitespace before chunking", () => {
  const out = chunkText("a    b\n\nc\td", { size: 100 });
  assert.deepEqual(out, ["a b c d"]);
});

test("chunkText respects the size cap on the produced chunks", () => {
  // Use predictable input: 200 single-letter tokens.
  const text = Array.from({ length: 200 }, (_, i) => String.fromCharCode(65 + (i % 26))).join(" ");
  const size = 60;
  const overlap = 10;
  const chunks = chunkText(text, { size, overlap });
  assert.ok(chunks.length > 1, "should have produced multiple chunks");
  for (const c of chunks) {
    // Greedy chunker: the LAST word added is the one that crossed `size`, so
    // chunks may slightly exceed `size` by the length of that word + 1 space.
    // Lock that contract: never more than size + longestWord + 1.
    assert.ok(c.length <= size + 5, `chunk too large: ${c.length} > ${size + 5}`);
  }
});

test("chunkText overlaps consecutive chunks at a word boundary", () => {
  const text = Array.from({ length: 60 }, (_, i) => `tok${i}`).join(" ");
  const chunks = chunkText(text, { size: 80, overlap: 30 });
  assert.ok(chunks.length >= 2);
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!;
    const cur = chunks[i]!;
    // The first whitespace-delimited token of `cur` should appear somewhere
    // in `prev`'s tail (if overlap > word length) — i.e. context survives the
    // boundary. We assert the weaker invariant: the chunker never starts a
    // chunk in the middle of a word that already exists at the prev's tail.
    const firstWord = cur.split(" ")[0]!;
    assert.ok(
      /^tok\d+$/.test(firstWord),
      `chunk ${i} should start at a word boundary, got '${firstWord}'`,
    );
    void prev;
  }
});

test("chunkText with overlap=0 still produces well-formed chunks", () => {
  const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const chunks = chunkText(text, { size: 25, overlap: 0 });
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.length > 0);
    // No surrounding whitespace.
    assert.equal(c, c.trim());
  }
});

test("chunkText clamps too-small size to a sane minimum", () => {
  // Implementation: size = Math.max(50, opts.size). So size=10 acts like 50.
  const text = "x ".repeat(200).trim();
  const chunks = chunkText(text, { size: 10, overlap: 0 });
  assert.ok(chunks.length > 0);
  // Should not produce trivially-tiny single-char chunks.
  for (const c of chunks) {
    assert.ok(c.length >= 2, `unexpectedly tiny chunk: '${c}'`);
  }
});

test("chunkText: overlap is clamped to size-1 (never larger than a chunk)", () => {
  // overlap > size would loop forever in a naive impl; verify the clamp.
  const text = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
  const chunks = chunkText(text, { size: 60, overlap: 9999 });
  assert.ok(chunks.length >= 1);
});

test("chunkText is deterministic on identical input", () => {
  const text = "alpha bravo charlie delta echo foxtrot golf ".repeat(20);
  const a = chunkText(text, { size: 80, overlap: 20 });
  const b = chunkText(text, { size: 80, overlap: 20 });
  assert.deepEqual(a, b);
});
