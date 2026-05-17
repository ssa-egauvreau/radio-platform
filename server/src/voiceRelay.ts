/**
 * FM-style half-duplex voice relay per logical channel over WebSockets.
 *
 * Protocol:
 * - First control message MUST be UTF-8 JSON: { type: "join", unit_id, channel }
 * - Subsequent binary frames: raw PCM mono 16-bit LE, 16000 Hz (matches Android capture).
 *
 * Authentication:
 * - Browser console clients pass a JWT as `?token=` — their agency and channel
 *   permission are taken from the token.
 * - Android handsets pass a radio key (`X-Radio-Key` header or `?key=`); the key
 *   identifies which agency the handset belongs to.
 *
 * Channels are namespaced per agency, so two tenants may both run "Green 1"
 * without ever hearing each other.
 */

import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { normalizedChannel } from "./presence.js";
import { verifyToken, type AuthUser } from "./auth.js";
import { getPool } from "./db.js";
import { getChannelByName, getMembership, resolveAgencyByKey, type Permission } from "./store.js";
import { recordFrame } from "./recorder.js";

export const VOICE_WS_PATH = "/v1/voice/stream";

/**
 * TTL after last relay frame before "off air".
 * Keep comfortably above worst-case framing/poll gaps so `/v1/air` does not flap between polls
 * (Android polls ~250–400ms) or between sparse IMBE frames / encode skips.
 */
const VOICE_AIR_TTL_MS = 2000;

type Identity = { kind: "account"; user: AuthUser } | { kind: "legacy"; agencyId: number };

interface ClientMeta {
  identity: Identity;
  agencyId: number;
  unitId: string;
  channelNorm: string | null;
  channelKey: string | null;
  channelName: string;
  channelId: number | null;
  userId: number | null;
  displayName: string | null;
  permission: Permission;
  joined: boolean;
}

type VoiceSlot = { unitUpper: string; lastPcmMs: number };

/** Who is currently keyed, keyed by `agency:channel` so tenants stay isolated. */
const voiceAirByChannel = new Map<string, VoiceSlot>();

export interface RosterMember {
  unit_id: string;
  display_name: string | null;
  kind: "account" | "legacy";
  connected_ms: number;
}

interface RosterRecord {
  channelKey: string;
  unitId: string;
  displayName: string | null;
  kind: "account" | "legacy";
  joinedAt: number;
}

/** Live voice-WebSocket roster so the console can show who is on each channel. */
const voiceRoster = new Map<WebSocket, RosterRecord>();

/** Composite channel key namespacing a normalized channel under its agency. */
function channelKey(agencyId: number, channelNorm: string): string {
  return `${agencyId} ${channelNorm}`;
}

/**
 * Resolves the agency a key-authenticated handset belongs to.
 * `requiredKey` is the legacy global `RADIO_API_KEY`, which maps to the default agency.
 */
async function resolveLegacyAgency(key: string | null, requiredKey: string | undefined): Promise<number | null> {
  if (!getPool()) {
    return 0; // no database — a single in-memory bucket for local dev
  }
  const agency = await resolveAgencyByKey(key, requiredKey).catch(() => null);
  return agency?.id ?? null;
}

/** Members currently connected to a channel's voice stream, longest-connected first. */
export function listChannelRoster(agencyId: number, channelRaw: unknown): RosterMember[] {
  const chNorm = normalizedChannel(channelRaw);
  if (!chNorm || chNorm === "----") {
    return [];
  }
  const key = channelKey(agencyId, chNorm);
  const now = Date.now();
  const members: RosterMember[] = [];
  for (const record of voiceRoster.values()) {
    if (record.channelKey === key) {
      members.push({
        unit_id: record.unitId,
        display_name: record.displayName,
        kind: record.kind,
        connected_ms: now - record.joinedAt,
      });
    }
  }
  members.sort((a, b) => b.connected_ms - a.connected_ms);
  return members;
}

export function peekVoiceTransmittingUnit(agencyId: number, channelRaw: unknown): string | null {
  const chNorm = normalizedChannel(channelRaw);
  if (!chNorm || chNorm === "----") {
    return null;
  }
  const key = channelKey(agencyId, chNorm);
  const slot = voiceAirByChannel.get(key);
  if (!slot) {
    return null;
  }
  if (Date.now() - slot.lastPcmMs > VOICE_AIR_TTL_MS) {
    voiceAirByChannel.delete(key);
    return null;
  }
  return slot.unitUpper;
}

function touchTransmission(chanKey: string, unitUpper: string): void {
  voiceAirByChannel.set(chanKey, { unitUpper, lastPcmMs: Date.now() });
}

/** Unit currently holding the channel, if it is someone other than the candidate; else null. */
function otherActiveHolder(chanKey: string, candidateUnitUpper: string): string | null {
  const slot = voiceAirByChannel.get(chanKey);
  if (!slot) {
    return null;
  }
  if (Date.now() - slot.lastPcmMs > VOICE_AIR_TTL_MS) {
    voiceAirByChannel.delete(chanKey);
    return null;
  }
  return slot.unitUpper !== candidateUnitUpper ? slot.unitUpper : null;
}

export function attachVoiceRelay(
  server: HttpServer,
  options: { radioApiKey?: string },
): WebSocketServer {
  const requiredKey = options.radioApiKey?.trim();

  const wss = new WebSocketServer({ noServer: true });
  const clientMeta = new Map<WebSocket, ClientMeta>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      try {
        const host = req.headers.host ?? "localhost";
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (url.pathname !== VOICE_WS_PATH) {
          socket.destroy();
          return;
        }

        let identity: Identity;
        const token = url.searchParams.get("token");
        if (token) {
          const user = verifyToken(token);
          if (!user) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          if (user.agencyId == null) {
            // Platform owners have no agency and cannot join a voice channel.
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
          identity = { kind: "account", user };
        } else {
          const headerRaw = req.headers["x-radio-key"];
          const headerVal = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
          const key = headerVal ?? url.searchParams.get("key");
          const agencyId = await resolveLegacyAgency(key ?? null, requiredKey);
          if (agencyId == null) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          identity = { kind: "legacy", agencyId };
        }

        const agencyId = identity.kind === "account" ? identity.user.agencyId! : identity.agencyId;
        wss.handleUpgrade(req, socket, head, (ws) => {
          clientMeta.set(ws, {
            identity,
            agencyId,
            unitId: "",
            channelNorm: null,
            channelKey: null,
            channelName: "",
            channelId: null,
            userId: null,
            displayName: null,
            permission: "listen_only",
            joined: false,
          });
          wss.emit("connection", ws, req);
        });
      } catch {
        socket.destroy();
      }
    })();
  });

  function broadcastExcept(from: WebSocket, chanKey: string, payload: Buffer): void {
    for (const [peer, meta] of clientMeta) {
      if (peer === from) continue;
      if (!meta.channelKey || meta.channelKey !== chanKey) continue;
      if (peer.readyState !== WebSocket.OPEN) continue;
      try {
        peer.send(payload);
      } catch {
        /* ignore stale peer */
      }
    }
  }

  async function handleJoin(
    ws: WebSocket,
    meta: ClientMeta,
    json: { channel?: string; unit_id?: string },
  ): Promise<void> {
    const channelName = String(json.channel ?? "").trim();
    const chNorm = normalizedChannel(channelName);
    if (!chNorm || chNorm === "----") {
      ws.send(JSON.stringify({ type: "error", code: "bad_join" }));
      return;
    }

    let channelRow: { id: number } | null = null;
    try {
      channelRow = await getChannelByName(meta.agencyId, channelName);
    } catch {
      channelRow = null; // no database — recording/permissions degrade gracefully
    }

    let unitId: string;
    let permission: Permission;
    let userId: number | null = null;
    let displayName: string | null = null;

    if (meta.identity.kind === "account") {
      const user = meta.identity.user;
      userId = user.id;
      displayName = user.displayName;
      unitId = (user.unitId ?? user.username).trim().toUpperCase() || "WEB";
      if (user.role === "admin" || user.role === "dispatcher") {
        permission = "talk_priority";
      } else {
        if (!channelRow) {
          ws.send(JSON.stringify({ type: "error", code: "unknown_channel" }));
          return;
        }
        const membership = await getMembership(user.id, channelRow.id).catch(() => null);
        if (!membership) {
          ws.send(JSON.stringify({ type: "error", code: "not_a_member" }));
          return;
        }
        permission = membership;
      }
    } else {
      unitId = String(json.unit_id ?? "").trim().toUpperCase();
      if (!unitId) {
        ws.send(JSON.stringify({ type: "error", code: "bad_join" }));
        return;
      }
      permission = "talk";
    }

    const chanKey = channelKey(meta.agencyId, chNorm);
    meta.unitId = unitId;
    meta.channelNorm = chNorm;
    meta.channelKey = chanKey;
    meta.channelName = channelName;
    meta.channelId = channelRow?.id ?? null;
    meta.userId = userId;
    meta.displayName = displayName;
    meta.permission = permission;
    meta.joined = true;
    const prior = voiceRoster.get(ws);
    voiceRoster.set(ws, {
      channelKey: chanKey,
      unitId,
      displayName,
      kind: meta.identity.kind,
      // Keep the original join time across re-joins to the same channel
      // (Android re-sends `join` on the same socket periodically).
      joinedAt: prior && prior.channelKey === chanKey ? prior.joinedAt : Date.now(),
    });
    ws.send(JSON.stringify({ type: "joined", channel: channelName, permission, unit_id: unitId }));
  }

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const meta = clientMeta.get(ws);
      if (!meta) {
        return;
      }
      try {
        if (!isBinary) {
          const text = Buffer.isBuffer(raw)
            ? raw.toString("utf8")
            : Buffer.from(raw as ArrayBuffer).toString("utf8");
          const json = JSON.parse(text) as { type?: string; channel?: string; unit_id?: string };
          if (json.type === "join") {
            void handleJoin(ws, meta, json);
          }
          return;
        }

        if (!meta.joined || !meta.channelNorm || !meta.channelKey) {
          return;
        }
        // Listen-only members may monitor a channel but never key up.
        if (meta.permission === "listen_only") {
          return;
        }
        // One transmitter per channel per air window. talk_priority pre-empts the current holder.
        const holder = otherActiveHolder(meta.channelKey, meta.unitId);
        if (holder && meta.permission !== "talk_priority") {
          return;
        }

        let payload: Buffer;
        if (Buffer.isBuffer(raw)) {
          payload = raw;
        } else if (Array.isArray(raw)) {
          payload = Buffer.concat(raw);
        } else {
          payload = Buffer.from(raw);
        }
        if (payload.length === 0) {
          return;
        }
        touchTransmission(meta.channelKey, meta.unitId);
        broadcastExcept(ws, meta.channelKey, payload);
        recordFrame(
          {
            agencyId: meta.agencyId,
            channelNorm: meta.channelNorm,
            channelName: meta.channelName,
            channelId: meta.channelId,
            userId: meta.userId,
            unitId: meta.unitId,
            displayName: meta.displayName,
          },
          payload,
        );
      } catch (e) {
        console.warn("voiceRelay message handling error", e);
      }
    });

    ws.on("close", () => {
      clientMeta.delete(ws);
      voiceRoster.delete(ws);
    });
  });

  return wss;
}
