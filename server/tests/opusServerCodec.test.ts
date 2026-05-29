/**
 * Smoke test for `server/src/opusServerCodec.ts` — recorder Opus decode path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Encoder } from "@evan/opus";

import {
  OPUS_EXPECTED_PCM_BYTES,
  createOpusDecoder,
  initServerOpus,
} from "../src/opusServerCodec.js";

test("initServerOpus: loads WASM and reports ready", async () => {
  const ok = await initServerOpus();
  assert.equal(ok, true);
});

test("createOpusDecoder: decodes a framed 16 kHz Opus packet to PCM-16", async () => {
  await initServerOpus();
  const decoder = createOpusDecoder();
  assert.notEqual(decoder, null);
  if (!decoder) return;

  const enc = new Encoder({ channels: 1, sample_rate: 16_000 });
  const pcm = new Int16Array(320);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = Math.round(Math.sin(i / 8) * 12_000);
  }
  const opus = enc.encode(pcm);
  assert.ok(opus.length > 0);

  const framed = Buffer.alloc(2 + opus.length);
  framed[0] = 0x4f;
  framed[1] = 0x70;
  Buffer.from(opus).copy(framed, 2);

  try {
    const decoded = decoder.decode(framed);
    assert.notEqual(decoded, null);
    if (!decoded) return;
    assert.equal(decoded.length, OPUS_EXPECTED_PCM_BYTES);
  } finally {
    decoder.free();
  }
});

test("createOpusDecoder: rejects malformed frames", async () => {
  await initServerOpus();
  const decoder = createOpusDecoder();
  if (!decoder) {
    assert.fail("decoder should be available after initServerOpus returned true");
    return;
  }
  try {
    assert.equal(decoder.decode(Buffer.alloc(0)), null);
    assert.equal(decoder.decode(Buffer.from([0x4f, 0x70])), null);
    assert.equal(decoder.decode(Buffer.from([0xf5, 0xab, 0x00])), null);
  } finally {
    decoder.free();
  }
});

test("createOpusDecoder: free() is idempotent", async () => {
  await initServerOpus();
  const decoder = createOpusDecoder();
  if (!decoder) {
    assert.fail("decoder should be available");
    return;
  }
  decoder.free();
  decoder.free();
  assert.equal(decoder.decode(Buffer.from([0x4f, 0x70, 0x01])), null);
});
