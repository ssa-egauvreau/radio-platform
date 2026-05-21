import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  getChannelAiDispatchRow,
  getTransmissionDispatchContext,
} from "../store.js";
import { insertAiDispatchLog } from "./activityLog.js";
import { adaptDispatcherResponseForChannel, detectEmergencyCodeFromTranscript } from "./emergencyCodes.js";
import { handlePlateFromParse } from "./plateHandler.js";
import { parseDispatcherTransmission } from "./parse.js";
import {
  getAiDispatchPlatformConfig,
  isAiDispatchUnit,
  resolveAiDispatchSystemPrompt,
} from "./platformConfig.js";
import { playMp3UrlOnChannel } from "./playback.js";
import { synthesizeElevenLabsMp3 } from "./tts.js";
import { postOutboundWebhook } from "./webhook.js";
import { applyChannelTen33Marker } from "./ten33Marker.js";
import { listTen8ActiveIncidents } from "../ten8/store.js";
import { ten8AddComment, ten8Configured } from "../ten8/client.js";
import type { PlateLookupResult } from "./plateLookup.js";
import type { AiDispatchParseResult } from "./parse.js";

const queue: number[] = [];
let working = false;
let loopbackPort = 8080;

export function configureAiDispatchEngine(options: { port: number }): void {
  loopbackPort = options.port;
}

export function getAiDispatchLoopbackPort(): number {
  return loopbackPort;
}

export function enqueueAiDispatchForTransmission(transmissionId: number): void {
  const platform = getAiDispatchPlatformConfig();
  if (!platform.enabled) {
    return;
  }
  queue.push(transmissionId);
  void pump();
}

async function pump(): Promise<void> {
  if (working) {
    return;
  }
  working = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      await processTransmission(id);
    }
  } finally {
    working = false;
  }
}

async function processTransmission(transmissionId: number): Promise<void> {
  const t0 = Date.now();
  let parsed: AiDispatchParseResult | null = null;
  let plateLookup: PlateLookupResult | null = null;
  let ten8Actions: Record<string, unknown> | null = null;
  let error: string | null = null;
  let transcript = "";
  let tx: NonNullable<Awaited<ReturnType<typeof getTransmissionDispatchContext>>> | null = null;
  let unitId = "UNIT";
  let yieldsToUnits = true;

  try {
    tx = await getTransmissionDispatchContext(transmissionId);
    if (!tx) {
      return;
    }
    if (isAiDispatchUnit(tx.unit_id)) {
      return;
    }

    const channelRow = await getChannelAiDispatchRow(tx.agency_id, tx.channel_name);
    if (!channelRow?.enabled) {
      return;
    }
    yieldsToUnits = channelRow.yields_to_units;

    const text = await loadTranscriptText(transmissionId);
    if (!text) {
      return;
    }
    transcript = text;

    const platform = getAiDispatchPlatformConfig();
    unitId = (tx.unit_id ?? "UNIT").trim().toUpperCase() || "UNIT";

    const emergencyRegex = detectEmergencyCodeFromTranscript(transcript);
    if (emergencyRegex === "activate") {
      await applyChannelTen33Marker({
        loopbackPort,
        agencyId: tx.agency_id,
        channelName: tx.channel_name,
        active: true,
        markerUnitId: platform.dispatchUnitId,
        source: "regex",
      });
    } else if (emergencyRegex === "clear") {
      await applyChannelTen33Marker({
        loopbackPort,
        agencyId: tx.agency_id,
        channelName: tx.channel_name,
        active: false,
        markerUnitId: platform.dispatchUnitId,
        source: "regex",
      });
    }

    const systemPrompt = await resolveAiDispatchSystemPrompt(tx.agency_id);
    parsed = await parseDispatcherTransmission({
      systemPrompt,
      unitId,
      channelName: tx.channel_name,
      transcript,
    });

    if (parsed) {
      if (parsed.trigger_emergency_tone || parsed.intent === "emergency") {
        await applyChannelTen33Marker({
          loopbackPort,
          agencyId: tx.agency_id,
          channelName: tx.channel_name,
          active: true,
          markerUnitId: platform.dispatchUnitId,
          source: "ai",
        });
      } else if (parsed.intent === "emergency_clear") {
        await applyChannelTen33Marker({
          loopbackPort,
          agencyId: tx.agency_id,
          channelName: tx.channel_name,
          active: false,
          markerUnitId: platform.dispatchUnitId,
          source: "ai",
        });
      }

      const plate = await handlePlateFromParse({
        agencyId: tx.agency_id,
        unitId,
        parsed,
      });
      plateLookup = plate.lookup;

      ten8Actions = {};
      if (parsed.recommended_action) {
        ten8Actions.recommended_action = parsed.recommended_action;
      }
      if (plate.lookup) {
        ten8Actions.plate_lookup = plate.lookup;
      }

      if (await ten8Configured(tx.agency_id)) {
        const cadNote = `[AI] ${parsed.summary}`.slice(0, 500);
        const active = await listTen8ActiveIncidents(tx.agency_id);
        if (active.length > 0 && parsed.actionable) {
          const target = active[0]!.call_id;
          const res = await ten8AddComment(tx.agency_id, target, cadNote);
          ten8Actions.ten8_comment = { call_id: target, ...res };
        } else {
          ten8Actions.ten8_comment = { skipped: "no_active_incident" };
        }
      }

      let speakText = plate.speakText || parsed.dispatcher_response?.trim() || "";
      if (!speakText) {
        const needDefaultEmergency =
          emergencyRegex === "activate" ||
          parsed.trigger_emergency_tone ||
          parsed.intent === "emergency";
        if (needDefaultEmergency) {
          speakText = `All units 10-33 on ${tx.channel_name}, all units 10-33 on ${tx.channel_name}.`;
        }
      }

      if (speakText) {
        const reply = adaptDispatcherResponseForChannel(speakText, tx.channel_name);
        parsed = { ...parsed, dispatcher_response: reply };
        await speakDispatcherReply(tx, transmissionId, unitId, transcript, reply, yieldsToUnits);
      }
    } else {
      error = "AI parse failed";
      if (emergencyRegex === "activate") {
        const defaultEmergency = `All units 10-33 on ${tx.channel_name}, all units 10-33 on ${tx.channel_name}.`;
        await speakDispatcherReply(tx, transmissionId, unitId, transcript, defaultEmergency, yieldsToUnits);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.warn(`[ai-dispatch] failed for transmission ${transmissionId}`, err);
  } finally {
    if (tx && transcript) {
      await insertAiDispatchLog({
        agencyId: tx.agency_id,
        transmissionId,
        channelName: tx.channel_name,
        unitId,
        transcript,
        parsed,
        plateLookup,
        ten8Actions,
        error,
        durationMs: Date.now() - t0,
      }).catch((e) => console.warn("[ai-dispatch] log insert failed", e));
    }
  }
}

async function speakDispatcherReply(
  tx: NonNullable<Awaited<ReturnType<typeof getTransmissionDispatchContext>>>,
  transmissionId: number,
  unitId: string,
  transcript: string,
  reply: string,
  yieldsToUnits: boolean,
): Promise<void> {
  const mp3 = await synthesizeElevenLabsMp3(tx.agency_id, reply);
  if (!mp3) {
    return;
  }

  const platform = getAiDispatchPlatformConfig();
  const tmpPath = join(tmpdir(), `ai-dispatch-${randomBytes(8).toString("hex")}.mp3`);
  await writeFile(tmpPath, mp3);
  try {
    await playMp3UrlOnChannel({
      loopbackPort,
      agencyId: tx.agency_id,
      channelName: tx.channel_name,
      unitId: platform.dispatchUnitId,
      yieldsToUnits,
      mp3Url: tmpPath,
    });
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }

  void postOutboundWebhook(tx.agency_id, {
    type: "ai_dispatch_reply",
    transmission_id: transmissionId,
    channel: tx.channel_name,
    unit_id: unitId,
    transcript_in: transcript,
    reply_text: reply,
  });

  console.log(
    `[ai-dispatch] agency=${tx.agency_id} channel=${tx.channel_name} unit=${unitId} reply="${reply.slice(0, 80)}"`,
  );
}

async function loadTranscriptText(transmissionId: number): Promise<string | null> {
  const { getPool } = await import("../db.js");
  const pool = getPool();
  if (!pool) {
    return null;
  }
  const res = await pool.query<{ transcript: string | null; transcript_status: string }>(
    `SELECT transcript, transcript_status FROM transmissions WHERE id = $1;`,
    [transmissionId],
  );
  const row = res.rows[0];
  if (!row || row.transcript_status !== "done") {
    return null;
  }
  const text = row.transcript?.trim() ?? "";
  return text.length > 0 ? text : null;
}
