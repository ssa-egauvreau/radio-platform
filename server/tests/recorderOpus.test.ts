/**
 * Recorder routes Opus frames through the server decoder when clear-PCM is off.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Encoder } from "@evan/opus";

import { initServerOpus } from "../src/opusServerCodec.js";
import { detectFrameCodec } from "../src/voiceCodecs.js";

describe("recorder Opus path", () => {
  test("Opus wire magic is detected for routing", () => {
    const frame = Buffer.from([0x4f, 0x70, 0x01, 0x02]);
    assert.equal(detectFrameCodec(frame), "opus");
  });

  test("server Opus decoder is available after init", async () => {
    const ok = await initServerOpus();
    assert.equal(ok, true);
    const enc = new Encoder({ channels: 1, sample_rate: 16_000 });
    const opus = enc.encode(new Int16Array(320));
    const framed = Buffer.alloc(2 + opus.length);
    framed[0] = 0x4f;
    framed[1] = 0x70;
    Buffer.from(opus).copy(framed, 2);
    assert.equal(detectFrameCodec(framed), "opus");
  });
});
