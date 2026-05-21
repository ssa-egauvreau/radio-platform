import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { playMarkerBurstOnChannel } from "./playback.js";

const SAMPLE_RATE = 16_000;
const MARKER_BEEP_MS = 1200;
const MARKER_BEEP_HZ = 950;

function markerBeepPcm(): Buffer {
  const total = Math.round((SAMPLE_RATE * MARKER_BEEP_MS) / 1000);
  const fade = Math.round(SAMPLE_RATE * 0.01);
  const buf = Buffer.alloc(total * 2);
  for (let i = 0; i < total; i++) {
    let gain = 0.5;
    if (i < fade) {
      gain *= i / fade;
    } else if (i > total - fade) {
      gain *= (total - i) / fade;
    }
    const sample = Math.round(Math.sin((2 * Math.PI * MARKER_BEEP_HZ * i) / SAMPLE_RATE) * gain * 32767);
    buf.writeInt16LE(sample, i * 2);
  }
  return buf;
}

function decodeMarkerWav(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "pipe:1",
    ]);
    const out: Buffer[] = [];
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}`))));
  });
}

let cachedMarkerPcm: Buffer | null = null;

async function getMarkerPcm(): Promise<Buffer> {
  if (cachedMarkerPcm) {
    return cachedMarkerPcm;
  }
  const roots = [
    join(process.cwd(), "dist/web-public/sounds/marker_1033.wav"),
    join(process.cwd(), "web-console/public/sounds/marker_1033.wav"),
    join(dirname(fileURLToPath(import.meta.url)), "../../../dist/web-public/sounds/marker_1033.wav"),
  ];
  for (const wavPath of roots) {
    if (existsSync(wavPath)) {
      try {
        cachedMarkerPcm = await decodeMarkerWav(wavPath);
        return cachedMarkerPcm;
      } catch {
        /* try next */
      }
    }
  }
  cachedMarkerPcm = markerBeepPcm();
  return cachedMarkerPcm;
}

/** One 10-33 marker burst on the channel (same relay path as dispatch console marker). */
export async function playMarkerToneOnChannel(opts: {
  loopbackPort: number;
  agencyId: number;
  channelName: string;
  unitId: string;
}): Promise<void> {
  const pcm = await getMarkerPcm();
  await playMarkerBurstOnChannel({ ...opts, pcm });
}
