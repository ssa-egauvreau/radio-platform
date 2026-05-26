import test from "node:test";
import assert from "node:assert/strict";
import {
  OPENVBE2P_MAGIC_0,
  OPENVBE2P_MAGIC_1,
  OPENVBE2P_PACKET_BYTES,
  OpenVbe2pStreamDecoder,
  isOpenVbe2pFrame,
} from "../src/openvbe2pCodec.js";
import { summarizeGlobalAudioConfig } from "../src/audioConfigSummary.js";

test("OpenVBE2P decoder accepts framed packets and emits 16 kHz PCM", () => {
  const packet = Buffer.alloc(OPENVBE2P_PACKET_BYTES);
  packet[0] = OPENVBE2P_MAGIC_0;
  packet[1] = OPENVBE2P_MAGIC_1;
  packet[2] = 0; // unvoiced
  packet[3] = 120; // moderate energy
  packet[4] = 0; // no pitch

  assert.equal(isOpenVbe2pFrame(packet), true);

  const decoded = new OpenVbe2pStreamDecoder().decode(packet);
  assert.ok(decoded);
  assert.equal(decoded.byteLength, 640);
});

test("OpenVBE2P detector rejects raw PCM", () => {
  assert.equal(isOpenVbe2pFrame(Buffer.alloc(640)), false);
});

test("global audio config summary exposes OpenVBE2P codec mode", () => {
  const summary = summarizeGlobalAudioConfig({
    preImbe: {
      agcEnabled: true,
      agcMaxGain: 6,
      windGateEnabled: true,
    },
    vocoder: {
      codec: "openvbe2p",
      bypass: false,
    },
  });

  assert.deepEqual(summary, {
    agcEnabled: true,
    noiseSuppression: true,
    gainMultiplier: 2,
    codecMode: "openvbe2p",
  });
});
