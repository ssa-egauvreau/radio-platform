/**
 * Half-duplex `/v1/air` slot lifecycle — especially immediate clear on `release_air`.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";

import {
  __claimVoiceAirForTest,
  __handleVoiceControlForTest,
  __resetVoiceRosterForTest,
  peekVoiceTransmittingTalker,
} from "../src/voiceRelay.js";

const AGENCY = 42;
const CHANNEL = "Green 1";

beforeEach(() => {
  __resetVoiceRosterForTest();
});

afterEach(() => {
  __resetVoiceRosterForTest();
});

describe("voice air / release_air", () => {
  test("peekVoiceTransmittingTalker returns holder while slot is live", () => {
    const ws = {} as WebSocket;
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: CHANNEL,
      ws,
      unitId: "U100",
      displayName: "Patrol 1",
    });
    const talker = peekVoiceTransmittingTalker(AGENCY, CHANNEL);
    assert.deepEqual(talker, { unit_id: "U100", display_name: "Patrol 1" });
  });

  test("release_air clears the holder immediately", () => {
    const ws = {} as WebSocket;
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: CHANNEL,
      ws,
      unitId: "U100",
    });
    __handleVoiceControlForTest(ws, "release_air");
    assert.equal(peekVoiceTransmittingTalker(AGENCY, CHANNEL), null);
  });

  test("release_air only clears slots owned by that socket", () => {
    const wsA = {} as WebSocket;
    const wsB = {} as WebSocket;
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: CHANNEL,
      ws: wsA,
      unitId: "A",
    });
    __handleVoiceControlForTest(wsB, "release_air");
    assert.equal(peekVoiceTransmittingTalker(AGENCY, CHANNEL)?.unit_id, "A");
    __handleVoiceControlForTest(wsA, "release_air");
    assert.equal(peekVoiceTransmittingTalker(AGENCY, CHANNEL), null);
  });
});
