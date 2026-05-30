/**
 * `/v1/talk-activity` mirrors live voice air slots for UI attribution.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";

import {
  __claimVoiceAirForTest,
  __resetVoiceRosterForTest,
  peekVoiceTransmittingTalker,
} from "../src/voiceRelay.js";

const AGENCY = 9;
const HOME = "Green 1";
const SCAN = "Green 2";

beforeEach(() => {
  __resetVoiceRosterForTest();
});

afterEach(() => {
  __resetVoiceRosterForTest();
});

describe("talk-activity data source", () => {
  test("peekVoiceTransmittingTalker drives main/scan segments", () => {
    const wsHome = {} as WebSocket;
    const wsScan = {} as WebSocket;
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: HOME,
      ws: wsHome,
      unitId: "U1",
      displayName: "Patrol",
    });
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: SCAN,
      ws: wsScan,
      unitId: "U2",
      displayName: "Car 2",
    });

    const main = peekVoiceTransmittingTalker(AGENCY, HOME);
    const scan = peekVoiceTransmittingTalker(AGENCY, SCAN);
    assert.deepEqual(main, { unit_id: "U1", display_name: "Patrol", yields: false });
    assert.deepEqual(scan, { unit_id: "U2", display_name: "Car 2", yields: false });
  });

  test("peekVoiceTransmittingTalker reports yields for yielding bridge traffic", () => {
    const ws = {} as WebSocket;
    __claimVoiceAirForTest({
      agencyId: AGENCY,
      channel: HOME,
      ws,
      unitId: "AI-DISPATCH",
      displayName: "Dispatch",
      yields: true,
    });
    const talker = peekVoiceTransmittingTalker(AGENCY, HOME);
    assert.deepEqual(talker, { unit_id: "AI-DISPATCH", display_name: "Dispatch", yields: true });
  });
});
