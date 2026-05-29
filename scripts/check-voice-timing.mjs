#!/usr/bin/env node
/**
 * Fails CI when voice timing constants drift across server, web, iOS, and Android.
 * Canonical values: docs/voice-timing.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_MS = {
  VOICE_AIR_TTL_MS: 900,
  TALK_SPURT_GAP_MS: 300,
  RX_GAP_MS: 300,
  TALK_ACTIVITY_POLL_MS: 1200,
  TALK_ACTIVITY_FAST_POLL_MS: 400,
  AIR_POLL_WHILE_PTT_MS: 250,
};

const EXPECTED_SEC = {
  talkSpurtGapSeconds: 0.3,
  airPollWhilePttSeconds: 0.25,
  talkActivityPollSeconds: 1.2,
  talkActivityFastPollSeconds: 0.4,
  inboxPollSeconds: 2.0,
  presencePollSeconds: 12.0,
};

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function expectMatch(file, pattern, label) {
  const text = read(file);
  const m = text.match(pattern);
  if (!m) {
    console.error(`[voice-timing] ${file}: could not find ${label}`);
    process.exitCode = 1;
    return null;
  }
  return m;
}

function checkMs(file, pattern, name, expected) {
  const m = expectMatch(file, pattern, name);
  if (!m) return;
  const value = Number(m[1].replace(/_/g, ""));
  if (value !== expected) {
    console.error(
      `[voice-timing] ${file}: ${name} is ${value}, expected ${expected}`,
    );
    process.exitCode = 1;
  }
}

function checkSec(file, pattern, name, expected) {
  const m = expectMatch(file, pattern, name);
  if (!m) return;
  const value = Number(m[1].replace(/_/g, ""));
  if (Math.abs(value - expected) > 1e-9) {
    console.error(
      `[voice-timing] ${file}: ${name} is ${value}, expected ${expected}`,
    );
    process.exitCode = 1;
  }
}

// Server relay TTL
checkMs(
  "server/src/voiceRelay.ts",
  /const\s+VOICE_AIR_TTL_MS\s*=\s*(\d+)/,
  "VOICE_AIR_TTL_MS",
  EXPECTED_MS.VOICE_AIR_TTL_MS,
);

// Web console (RX_GAP_MS aliases TALK_SPURT_GAP_MS — only check literals)
const webFile = "server/web-console/src/voice/voiceTiming.ts";
for (const [name, expected] of Object.entries(EXPECTED_MS)) {
  if (name === "RX_GAP_MS") continue;
  checkMs(
    webFile,
    new RegExp(`export const ${name}\\s*=\\s*(\\d+)`),
    name,
    expected,
  );
}
if (!read(webFile).includes("RX_GAP_MS = TALK_SPURT_GAP_MS")) {
  console.error(`[voice-timing] ${webFile}: RX_GAP_MS must alias TALK_SPURT_GAP_MS`);
  process.exitCode = 1;
}

// Android
const androidFile =
  "android-app/app/src/main/java/com/securityradio/ptt/support/VoiceTiming.kt";
const androidLiterals = [
  "VOICE_AIR_TTL_MS",
  "TALK_SPURT_GAP_MS",
  "AIR_POLL_WHILE_PTT_MS",
  "TALK_ACTIVITY_POLL_MS",
  "TALK_ACTIVITY_FAST_POLL_MS",
  "INBOX_POLL_MS",
  "PRESENCE_POLL_MS",
];
const ANDROID_MS = {
  ...EXPECTED_MS,
  INBOX_POLL_MS: 2000,
  PRESENCE_POLL_MS: 12000,
};
for (const name of androidLiterals) {
  checkMs(
    androidFile,
    new RegExp(`const val ${name} = ([\\d_]+)L`),
    name,
    ANDROID_MS[name],
  );
}
if (!read(androidFile).includes("RX_GAP_MS = TALK_SPURT_GAP_MS")) {
  console.error(`[voice-timing] ${androidFile}: RX_GAP_MS must alias TALK_SPURT_GAP_MS`);
  process.exitCode = 1;
}
if (!read(androidFile).includes("TALK_SPURT_GAP_NS = TALK_SPURT_GAP_MS * 1_000_000L")) {
  console.error(`[voice-timing] ${androidFile}: TALK_SPURT_GAP_NS must derive from TALK_SPURT_GAP_MS`);
  process.exitCode = 1;
}

// iOS (seconds)
const iosFile = "ios-app/SafeTMobile/Support/VoiceTiming.swift";
checkMs(
  iosFile,
  /voiceAirTtlMs = (\d+)/,
  "voiceAirTtlMs",
  EXPECTED_MS.VOICE_AIR_TTL_MS,
);
checkSec(
  iosFile,
  /talkSpurtGapSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "talkSpurtGapSeconds",
  EXPECTED_SEC.talkSpurtGapSeconds,
);
checkSec(
  iosFile,
  /airPollWhilePttSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "airPollWhilePttSeconds",
  EXPECTED_SEC.airPollWhilePttSeconds,
);
checkSec(
  iosFile,
  /talkActivityPollSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "talkActivityPollSeconds",
  EXPECTED_SEC.talkActivityPollSeconds,
);
checkSec(
  iosFile,
  /talkActivityFastPollSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "talkActivityFastPollSeconds",
  EXPECTED_SEC.talkActivityFastPollSeconds,
);
checkSec(
  iosFile,
  /inboxPollSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "inboxPollSeconds",
  EXPECTED_SEC.inboxPollSeconds,
);
checkSec(
  iosFile,
  /presencePollSeconds:\s*TimeInterval\s*=\s*([\d.]+)/,
  "presencePollSeconds",
  EXPECTED_SEC.presencePollSeconds,
);

if (process.exitCode) {
  console.error(
    "[voice-timing] Sync failed — update docs/voice-timing.md and all platform constants together.",
  );
  process.exit(1);
}

console.log("[voice-timing] All platform constants match docs/voice-timing.md");
