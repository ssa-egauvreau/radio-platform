import crypto from "node:crypto";
import { getPool, requirePool, DEFAULT_AGENCY_SLUG } from "./db.js";
import { hashPassword, type Role } from "./auth.js";

export type Permission = "talk_priority" | "talk" | "listen_only";

/** Every role the platform recognizes. `owner` is platform-level (no agency). */
export const ROLES: Role[] = ["owner", "admin", "dispatcher", "radio"];
/** Roles an agency administrator (or the owner) may assign within an agency. */
export const AGENCY_ROLES: Role[] = ["admin", "dispatcher", "radio"];
export const PERMISSIONS: Permission[] = ["talk_priority", "talk", "listen_only"];

// --- agencies (tenants) --------------------------------------------------

export interface AgencyRow {
  id: number;
  name: string;
  slug: string;
  radio_key: string | null;
  disabled: boolean;
  created_at: string;
}

export interface AgencySummary extends AgencyRow {
  user_count: number;
  channel_count: number;
}

const AGENCY_COLS = "id, name, slug, radio_key, disabled, created_at";

/** A URL-safe shared key handsets present to bind to their agency. */
export function generateRadioKey(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Derives a stable URL slug from a free-text agency name. */
export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "agency";
}

export async function listAgencies(): Promise<AgencySummary[]> {
  const res = await requirePool().query<AgencySummary>(
    `SELECT a.id, a.name, a.slug, a.radio_key, a.disabled, a.created_at,
            (SELECT COUNT(*)::int FROM users u WHERE u.agency_id = a.id) AS user_count,
            (SELECT COUNT(*)::int FROM radio_channels c WHERE c.agency_id = a.id) AS channel_count
       FROM agencies a
      ORDER BY a.name ASC;`,
  );
  return res.rows;
}

export async function getAgencyById(id: number): Promise<AgencyRow | null> {
  const res = await requirePool().query<AgencyRow>(`SELECT ${AGENCY_COLS} FROM agencies WHERE id = $1;`, [id]);
  return res.rows[0] ?? null;
}

export async function getAgencyBySlug(slug: string): Promise<AgencyRow | null> {
  const res = await requirePool().query<AgencyRow>(`SELECT ${AGENCY_COLS} FROM agencies WHERE slug = $1;`, [slug]);
  return res.rows[0] ?? null;
}

/** Resolves the agency a handset belongs to from the radio key it presents. */
export async function getAgencyByRadioKey(key: string): Promise<AgencyRow | null> {
  if (!key.trim()) {
    return null;
  }
  const res = await requirePool().query<AgencyRow>(
    `SELECT ${AGENCY_COLS} FROM agencies WHERE radio_key = $1 AND disabled = FALSE;`,
    [key.trim()],
  );
  return res.rows[0] ?? null;
}

/**
 * Resolves the agency for a handset request from its radio key. A per-agency
 * key wins; the legacy global `RADIO_API_KEY` (`legacyEnvKey`) maps to the
 * default agency; absent any key, requests fall through to the default agency
 * only when no global key is configured.
 */
export async function resolveAgencyByKey(
  key: string | null,
  legacyEnvKey: string | undefined,
): Promise<AgencyRow | null> {
  if (key && key.trim()) {
    const byKey = await getAgencyByRadioKey(key);
    if (byKey) {
      return byKey;
    }
    if (legacyEnvKey && key === legacyEnvKey) {
      const def = await getAgencyBySlug(DEFAULT_AGENCY_SLUG);
      return def && !def.disabled ? def : null;
    }
    return null;
  }
  if (legacyEnvKey) {
    return null;
  }
  const def = await getAgencyBySlug(DEFAULT_AGENCY_SLUG);
  return def && !def.disabled ? def : null;
}

/** Creates an agency and seeds it with three starter channels. */
export async function createAgency(input: { name: string; slug: string; radioKey: string }): Promise<AgencyRow> {
  const p = requirePool();
  const res = await p.query<AgencyRow>(
    `INSERT INTO agencies (name, slug, radio_key) VALUES ($1, $2, $3) RETURNING ${AGENCY_COLS};`,
    [input.name.trim(), input.slug, input.radioKey],
  );
  const agency = res.rows[0]!;
  await p.query(
    `INSERT INTO radio_channels (agency_id, sort_order, name) VALUES
       ($1, 1, 'Green 1'),
       ($1, 2, 'Green 2'),
       ($1, 3, 'Green 3');`,
    [agency.id],
  );
  return agency;
}

export async function updateAgency(
  id: number,
  patch: { name?: string; disabled?: boolean; radioKey?: string },
): Promise<AgencyRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name.trim()); }
  if (patch.disabled !== undefined) { sets.push(`disabled = $${i++}`); vals.push(patch.disabled); }
  if (patch.radioKey !== undefined) { sets.push(`radio_key = $${i++}`); vals.push(patch.radioKey); }
  if (sets.length === 0) {
    return getAgencyById(id);
  }
  vals.push(id);
  const res = await requirePool().query<AgencyRow>(
    `UPDATE agencies SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${AGENCY_COLS};`,
    vals,
  );
  return res.rows[0] ?? null;
}

export async function deleteAgency(id: number): Promise<boolean> {
  const res = await requirePool().query(`DELETE FROM agencies WHERE id = $1;`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// --- users ---------------------------------------------------------------

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  unit_id: string | null;
  disabled: boolean;
  agency_id: number | null;
  created_at: string;
}

export interface UserWithHash extends UserRow {
  password_hash: string;
  agency_name: string | null;
  agency_disabled: boolean | null;
}

export interface ChannelRow {
  id: number;
  name: string;
  sort_order: number;
  color: string | null;
  zone: string | null;
}

export interface MembershipRow {
  user_id: number;
  channel_id: number;
  permission: Permission;
}

export interface UserChannelRow {
  id: number;
  name: string;
  permission: Permission;
  color: string | null;
  zone: string | null;
}

export interface AuditRow {
  id: number;
  ts: string;
  actor_user_id: number | null;
  actor_name: string | null;
  action: string;
  target: string | null;
  detail: unknown;
  ip: string | null;
}

const USER_COLS = "id, username, display_name, role, unit_id, disabled, agency_id, created_at";

/** Accounts within one agency. */
export async function listUsers(agencyId: number): Promise<UserRow[]> {
  const res = await requirePool().query<UserRow>(
    `SELECT ${USER_COLS} FROM users WHERE agency_id = $1 ORDER BY username ASC;`,
    [agencyId],
  );
  return res.rows;
}

/** Looks up one account. When `agencyId` is given the row must belong to that agency. */
export async function getUserById(id: number, agencyId?: number): Promise<UserRow | null> {
  const res =
    agencyId === undefined
      ? await requirePool().query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1;`, [id])
      : await requirePool().query<UserRow>(
          `SELECT ${USER_COLS} FROM users WHERE id = $1 AND agency_id = $2;`,
          [id, agencyId],
        );
  return res.rows[0] ?? null;
}

/** Login lookup — usernames are globally unique, so this carries the agency to the token. */
export async function getUserByUsername(username: string): Promise<UserWithHash | null> {
  const res = await requirePool().query<UserWithHash>(
    `SELECT u.id, u.username, u.display_name, u.role, u.unit_id, u.disabled, u.agency_id,
            u.created_at, u.password_hash,
            a.name AS agency_name, a.disabled AS agency_disabled
       FROM users u
       LEFT JOIN agencies a ON a.id = u.agency_id
      WHERE lower(u.username) = lower($1);`,
    [username],
  );
  return res.rows[0] ?? null;
}

export async function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: Role;
  unitId: string | null;
  agencyId: number | null;
}): Promise<UserRow> {
  const hash = await hashPassword(input.password);
  const res = await requirePool().query<UserRow>(
    `INSERT INTO users (username, display_name, password_hash, role, unit_id, agency_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${USER_COLS};`,
    [input.username.trim(), input.displayName.trim(), hash, input.role, input.unitId, input.agencyId],
  );
  return res.rows[0]!;
}

export async function updateUser(
  id: number,
  patch: { displayName?: string; role?: Role; unitId?: string | null; disabled?: boolean; password?: string },
): Promise<UserRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.displayName !== undefined) { sets.push(`display_name = $${i++}`); vals.push(patch.displayName.trim()); }
  if (patch.role !== undefined) { sets.push(`role = $${i++}`); vals.push(patch.role); }
  if (patch.unitId !== undefined) { sets.push(`unit_id = $${i++}`); vals.push(patch.unitId); }
  if (patch.disabled !== undefined) { sets.push(`disabled = $${i++}`); vals.push(patch.disabled); }
  if (patch.password !== undefined) { sets.push(`password_hash = $${i++}`); vals.push(await hashPassword(patch.password)); }
  if (sets.length === 0) {
    return getUserById(id);
  }
  vals.push(id);
  const res = await requirePool().query<UserRow>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${USER_COLS};`,
    vals,
  );
  return res.rows[0] ?? null;
}

export async function deleteUser(id: number): Promise<boolean> {
  const res = await requirePool().query(`DELETE FROM users WHERE id = $1;`, [id]);
  return (res.rowCount ?? 0) > 0;
}

/** Active admins in one agency — used to block deleting/demoting the final administrator. */
export async function countActiveAdmins(agencyId: number): Promise<number> {
  const res = await requirePool().query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users WHERE role = 'admin' AND disabled = FALSE AND agency_id = $1;`,
    [agencyId],
  );
  return Number(res.rows[0]?.c ?? "0");
}

// --- channels ------------------------------------------------------------

export async function listChannels(agencyId: number): Promise<ChannelRow[]> {
  const res = await requirePool().query<ChannelRow>(
    `SELECT id, name, sort_order, color, zone FROM radio_channels
     WHERE agency_id = $1
     ORDER BY zone NULLS FIRST, sort_order ASC, id ASC;`,
    [agencyId],
  );
  return res.rows;
}

export async function createChannel(agencyId: number, name: string): Promise<ChannelRow> {
  const res = await requirePool().query<ChannelRow>(
    `INSERT INTO radio_channels (agency_id, name, sort_order)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM radio_channels WHERE agency_id = $1), 1))
     RETURNING id, name, sort_order, color, zone;`,
    [agencyId, name.trim()],
  );
  return res.rows[0]!;
}

export async function updateChannel(
  id: number,
  agencyId: number,
  patch: { name?: string; color?: string | null; zone?: string | null },
): Promise<ChannelRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name.trim()); }
  if (patch.color !== undefined) { sets.push(`color = $${i++}`); vals.push(patch.color); }
  if (patch.zone !== undefined) { sets.push(`zone = $${i++}`); vals.push(patch.zone); }
  if (sets.length === 0) {
    return getChannelById(id, agencyId);
  }
  vals.push(id, agencyId);
  const res = await requirePool().query<ChannelRow>(
    `UPDATE radio_channels SET ${sets.join(", ")} WHERE id = $${i++} AND agency_id = $${i}
     RETURNING id, name, sort_order, color, zone;`,
    vals,
  );
  return res.rows[0] ?? null;
}

export async function deleteChannel(id: number, agencyId: number): Promise<boolean> {
  const res = await requirePool().query(`DELETE FROM radio_channels WHERE id = $1 AND agency_id = $2;`, [
    id,
    agencyId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function getChannelById(id: number, agencyId: number): Promise<ChannelRow | null> {
  const res = await requirePool().query<ChannelRow>(
    `SELECT id, name, sort_order, color, zone FROM radio_channels WHERE id = $1 AND agency_id = $2;`,
    [id, agencyId],
  );
  return res.rows[0] ?? null;
}

/** Case-insensitive channel lookup within an agency (used by the voice relay on join). */
export async function getChannelByName(agencyId: number, name: string): Promise<ChannelRow | null> {
  const res = await requirePool().query<ChannelRow>(
    `SELECT id, name, sort_order, color, zone FROM radio_channels
     WHERE agency_id = $1 AND lower(name) = lower($2);`,
    [agencyId, name.trim()],
  );
  return res.rows[0] ?? null;
}

// --- memberships ---------------------------------------------------------

export async function listMemberships(agencyId: number): Promise<MembershipRow[]> {
  const res = await requirePool().query<MembershipRow>(
    `SELECT m.user_id, m.channel_id, m.permission
     FROM channel_members m
     JOIN users u ON u.id = m.user_id
     WHERE u.agency_id = $1;`,
    [agencyId],
  );
  return res.rows;
}

export async function listChannelsForUser(userId: number): Promise<UserChannelRow[]> {
  const res = await requirePool().query<UserChannelRow>(
    `SELECT c.id, c.name, c.color, c.zone, m.permission
     FROM channel_members m
     JOIN radio_channels c ON c.id = m.channel_id
     WHERE m.user_id = $1
     ORDER BY c.zone NULLS FIRST, c.sort_order ASC, c.id ASC;`,
    [userId],
  );
  return res.rows;
}

export async function setMembership(userId: number, channelId: number, permission: Permission): Promise<void> {
  await requirePool().query(
    `INSERT INTO channel_members (user_id, channel_id, permission)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET permission = EXCLUDED.permission;`,
    [userId, channelId, permission],
  );
}

export async function removeMembership(userId: number, channelId: number): Promise<boolean> {
  const res = await requirePool().query(
    `DELETE FROM channel_members WHERE user_id = $1 AND channel_id = $2;`,
    [userId, channelId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** A single account's permission on one channel, or null when not assigned. */
export async function getMembership(userId: number, channelId: number): Promise<Permission | null> {
  const res = await requirePool().query<{ permission: Permission }>(
    `SELECT permission FROM channel_members WHERE user_id = $1 AND channel_id = $2;`,
    [userId, channelId],
  );
  return res.rows[0]?.permission ?? null;
}

// --- audit ---------------------------------------------------------------

export async function writeAudit(entry: {
  agencyId: number | null;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  target?: string | null;
  detail?: unknown;
  ip?: string | null;
}): Promise<void> {
  const p = getPool();
  if (!p) {
    return;
  }
  try {
    await p.query(
      `INSERT INTO audit_log (agency_id, actor_user_id, actor_name, action, target, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [
        entry.agencyId,
        entry.actorUserId,
        entry.actorName,
        entry.action,
        entry.target ?? null,
        entry.detail === undefined ? null : JSON.stringify(entry.detail),
        entry.ip ?? null,
      ],
    );
  } catch (error) {
    console.warn("audit write failed", error);
  }
}

export async function listAudit(agencyId: number, limit = 200): Promise<AuditRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 200, 1), 1000);
  const res = await requirePool().query<AuditRow>(
    `SELECT id, ts, actor_user_id, actor_name, action, target, detail, ip
     FROM audit_log WHERE agency_id = $1 ORDER BY ts DESC LIMIT $2;`,
    [agencyId, capped],
  );
  return res.rows;
}

// --- unit aliases --------------------------------------------------------

export interface UnitAliasRow {
  unit_id: string;
  label: string;
  updated_at: string;
}

export async function listUnitAliases(agencyId: number): Promise<UnitAliasRow[]> {
  const res = await requirePool().query<UnitAliasRow>(
    `SELECT unit_id, label, updated_at FROM unit_aliases WHERE agency_id = $1 ORDER BY unit_id ASC;`,
    [agencyId],
  );
  return res.rows;
}

export async function setUnitAlias(agencyId: number, unitId: string, label: string): Promise<UnitAliasRow> {
  const res = await requirePool().query<UnitAliasRow>(
    `INSERT INTO unit_aliases (agency_id, unit_id, label, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (agency_id, unit_id) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
     RETURNING unit_id, label, updated_at;`,
    [agencyId, unitId.trim(), label.trim()],
  );
  return res.rows[0]!;
}

export async function deleteUnitAlias(agencyId: number, unitId: string): Promise<boolean> {
  const res = await requirePool().query(`DELETE FROM unit_aliases WHERE agency_id = $1 AND unit_id = $2;`, [
    agencyId,
    unitId.trim(),
  ]);
  return (res.rowCount ?? 0) > 0;
}

// --- transmissions -------------------------------------------------------

export interface TransmissionRow {
  id: number;
  channel_id: number | null;
  channel_name: string;
  user_id: number | null;
  unit_id: string | null;
  display_name: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  sample_rate: number;
  audio_mime: string;
  transcript: string | null;
  transcript_status: string;
}

const TX_META_COLS =
  "id, channel_id, channel_name, user_id, unit_id, display_name, started_at, " +
  "ended_at, duration_ms, sample_rate, audio_mime, transcript, transcript_status";

export async function insertTransmission(input: {
  agencyId: number;
  channelId: number | null;
  channelName: string;
  userId: number | null;
  unitId: string;
  displayName: string | null;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  sampleRate: number;
  audio: Buffer;
}): Promise<number> {
  const res = await requirePool().query<{ id: number }>(
    `INSERT INTO transmissions
       (agency_id, channel_id, channel_name, user_id, unit_id, display_name, started_at, ended_at,
        duration_ms, sample_rate, audio, audio_mime, transcript_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'audio/wav', 'pending')
     RETURNING id;`,
    [
      input.agencyId,
      input.channelId,
      input.channelName,
      input.userId,
      input.unitId,
      input.displayName,
      input.startedAt,
      input.endedAt,
      input.durationMs,
      input.sampleRate,
      input.audio,
    ],
  );
  return res.rows[0]!.id;
}

export type TransmissionSort = "newest" | "oldest" | "longest" | "shortest" | "speaker";

const TX_SORT_SQL: Record<TransmissionSort, string> = {
  newest: "started_at DESC",
  oldest: "started_at ASC",
  longest: "duration_ms DESC, started_at DESC",
  shortest: "duration_ms ASC, started_at DESC",
  speaker: "lower(COALESCE(display_name, unit_id, '')) ASC, started_at DESC",
};

/**
 * Recent transmissions for one agency (metadata only — never selects audio bytes).
 * `channelNames` further scopes the result to a role's accessible channels.
 */
export async function listTransmissions(opts: {
  agencyId: number;
  channelNames?: string[];
  channel?: string;
  search?: string;
  user?: string;
  from?: string;
  to?: string;
  sort?: TransmissionSort;
  limit?: number;
}): Promise<TransmissionRow[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100) || 100, 1), 500);
  if (opts.channelNames && opts.channelNames.length === 0) {
    return [];
  }
  const where: string[] = ["agency_id = $1"];
  const vals: unknown[] = [opts.agencyId];
  let i = 2;
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  if (opts.channelNames) {
    where.push(`lower(channel_name) = ANY($${i++})`);
    vals.push(opts.channelNames.map((n) => n.trim().toLowerCase()));
  }
  const channel = opts.channel?.trim();
  if (channel) {
    where.push(`lower(channel_name) = lower($${i++})`);
    vals.push(channel);
  }
  const search = opts.search?.trim();
  if (search) {
    where.push(`transcript ILIKE $${i++}`);
    vals.push(like(search));
  }
  const user = opts.user?.trim();
  if (user) {
    where.push(`(display_name ILIKE $${i} OR unit_id ILIKE $${i})`);
    vals.push(like(user));
    i++;
  }
  const from = opts.from?.trim();
  if (from) {
    where.push(`started_at >= $${i++}::date`);
    vals.push(from);
  }
  const to = opts.to?.trim();
  if (to) {
    where.push(`started_at < ($${i++}::date + interval '1 day')`);
    vals.push(to);
  }
  const order = TX_SORT_SQL[opts.sort ?? "newest"] ?? TX_SORT_SQL.newest;
  vals.push(limit);
  const res = await requirePool().query<TransmissionRow>(
    `SELECT ${TX_META_COLS} FROM transmissions
     WHERE ${where.join(" AND ")}
     ORDER BY ${order} LIMIT $${i};`,
    vals,
  );
  return res.rows;
}

/** Audio bytes for one transmission. When `agencyId` is given, the row must belong to it. */
export async function getTransmissionAudio(
  id: number,
  agencyId?: number,
): Promise<{ audio: Buffer; mime: string } | null> {
  const res =
    agencyId === undefined
      ? await requirePool().query<{ audio: Buffer | null; audio_mime: string }>(
          `SELECT audio, audio_mime FROM transmissions WHERE id = $1;`,
          [id],
        )
      : await requirePool().query<{ audio: Buffer | null; audio_mime: string }>(
          `SELECT audio, audio_mime FROM transmissions WHERE id = $1 AND agency_id = $2;`,
          [id, agencyId],
        );
  const row = res.rows[0];
  if (!row || !row.audio) {
    return null;
  }
  return { audio: row.audio, mime: row.audio_mime };
}

export async function setTranscript(id: number, status: string, text: string | null): Promise<void> {
  await requirePool().query(
    `UPDATE transmissions SET transcript_status = $2, transcript = $3 WHERE id = $1;`,
    [id, status, text],
  );
}

export async function listPendingTranscriptionIds(): Promise<number[]> {
  const res = await requirePool().query<{ id: number }>(
    `SELECT id FROM transmissions WHERE transcript_status = 'pending' ORDER BY started_at ASC LIMIT 200;`,
  );
  return res.rows.map((r) => r.id);
}

// --- radio positions (GPS) ----------------------------------------------

export interface RadioPosition {
  unit_id: string;
  user_id: number | null;
  display_name: string | null;
  channel_name: string | null;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  updated_at: string;
}

export async function upsertPosition(input: {
  agencyId: number;
  unitId: string;
  userId: number | null;
  displayName: string | null;
  channelName: string | null;
  lat: number;
  lon: number;
  accuracyM: number | null;
  heading: number | null;
  speedMps: number | null;
}): Promise<void> {
  await requirePool().query(
    `INSERT INTO radio_positions
       (agency_id, unit_id, user_id, display_name, channel_name, lat, lon, accuracy_m, heading, speed_mps, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (agency_id, unit_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       display_name = COALESCE(EXCLUDED.display_name, radio_positions.display_name),
       channel_name = EXCLUDED.channel_name,
       lat = EXCLUDED.lat,
       lon = EXCLUDED.lon,
       accuracy_m = EXCLUDED.accuracy_m,
       heading = EXCLUDED.heading,
       speed_mps = EXCLUDED.speed_mps,
       updated_at = now();`,
    [
      input.agencyId,
      input.unitId,
      input.userId,
      input.displayName,
      input.channelName,
      input.lat,
      input.lon,
      input.accuracyM,
      input.heading,
      input.speedMps,
    ],
  );
}

export async function listPositions(agencyId: number): Promise<RadioPosition[]> {
  const res = await requirePool().query<RadioPosition>(
    `SELECT unit_id, user_id, display_name, channel_name, lat, lon, accuracy_m, heading, speed_mps, updated_at
     FROM radio_positions WHERE agency_id = $1 ORDER BY updated_at DESC;`,
    [agencyId],
  );
  return res.rows;
}

// --- alerts (emergencies + pages) ---------------------------------------

export type AlertKind = "emergency" | "page";

export interface AlertRow {
  id: number;
  kind: string;
  channel_name: string | null;
  target_unit: string | null;
  from_user_id: number | null;
  from_name: string | null;
  from_unit: string | null;
  message: string | null;
  active: boolean;
  created_at: string;
  cleared_by: string | null;
  cleared_at: string | null;
}

const ALERT_COLS =
  "id, kind, channel_name, target_unit, from_user_id, from_name, from_unit, message, " +
  "active, created_at, cleared_by, cleared_at";

export async function createAlert(input: {
  agencyId: number;
  kind: AlertKind;
  channelName: string | null;
  targetUnit: string | null;
  fromUserId: number | null;
  fromName: string | null;
  fromUnit: string | null;
  message: string | null;
}): Promise<AlertRow> {
  const res = await requirePool().query<AlertRow>(
    `INSERT INTO alerts (agency_id, kind, channel_name, target_unit, from_user_id, from_name, from_unit, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${ALERT_COLS};`,
    [
      input.agencyId,
      input.kind,
      input.channelName,
      input.targetUnit,
      input.fromUserId,
      input.fromName,
      input.fromUnit,
      input.message,
    ],
  );
  return res.rows[0]!;
}

/** Active alerts plus anything from the last 24h for one agency, newest first. */
export async function listAlerts(agencyId: number, limit = 100): Promise<AlertRow[]> {
  const capped = Math.min(Math.max(Math.trunc(limit) || 100, 1), 200);
  const res = await requirePool().query<AlertRow>(
    `SELECT ${ALERT_COLS} FROM alerts
     WHERE agency_id = $1 AND (active = TRUE OR created_at > now() - interval '24 hours')
     ORDER BY created_at DESC LIMIT $2;`,
    [agencyId, capped],
  );
  return res.rows;
}

export async function clearAlert(id: number, agencyId: number, clearedBy: string): Promise<AlertRow | null> {
  const res = await requirePool().query<AlertRow>(
    `UPDATE alerts SET active = FALSE, cleared_by = $3, cleared_at = now()
     WHERE id = $1 AND agency_id = $2 RETURNING ${ALERT_COLS};`,
    [id, agencyId, clearedBy],
  );
  return res.rows[0] ?? null;
}

export async function clearEmergenciesFromUnit(agencyId: number, unit: string, clearedBy: string): Promise<number> {
  const res = await requirePool().query(
    `UPDATE alerts SET active = FALSE, cleared_by = $3, cleared_at = now()
     WHERE agency_id = $1 AND kind = 'emergency' AND active = TRUE AND from_unit = $2;`,
    [agencyId, unit, clearedBy],
  );
  return res.rowCount ?? 0;
}

/** Alerts addressed to a radio (direct, its channel, or broadcast) newer than `sinceId`. */
export async function listInboxAlerts(
  agencyId: number,
  unit: string,
  channel: string | null,
  sinceId: number,
): Promise<AlertRow[]> {
  const res = await requirePool().query<AlertRow>(
    `SELECT ${ALERT_COLS} FROM alerts
     WHERE agency_id = $1
       AND id > $2
       AND ( target_unit = $3
             OR ( target_unit IS NULL
                  AND ( channel_name IS NULL OR lower(channel_name) = lower($4) ) ) )
     ORDER BY id ASC LIMIT 50;`,
    [agencyId, sinceId, unit, channel ?? ""],
  );
  return res.rows;
}

/**
 * Ensures the owner portal and the admin portal are both reachable:
 * - a platform `owner` account exists (created on fresh databases and on
 *   existing single-tenant databases that predate multi-agency support);
 * - the default agency has an administrator on a brand-new database.
 */
export async function seedInitialAccounts(): Promise<void> {
  const p = getPool();
  if (!p) {
    return;
  }

  const owners = await p.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users WHERE role = 'owner';`);
  if (Number(owners.rows[0]?.c ?? "0") === 0) {
    const ownerPassword = process.env.OWNER_INITIAL_PASSWORD?.trim() || "platform-owner";
    await createUser({
      username: "owner",
      displayName: "Platform Owner",
      password: ownerPassword,
      role: "owner",
      unitId: null,
      agencyId: null,
    });
    console.log(`Seeded platform owner — username "owner", password "${ownerPassword}". Change it after first login.`);
  }

  const agencyUsers = await p.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users WHERE role <> 'owner';`);
  if (Number(agencyUsers.rows[0]?.c ?? "0") === 0) {
    const defaultAgency = await getAgencyBySlug(DEFAULT_AGENCY_SLUG);
    const adminPassword = process.env.ADMIN_INITIAL_PASSWORD?.trim() || "radio-admin";
    await createUser({
      username: "admin",
      displayName: "Administrator",
      password: adminPassword,
      role: "admin",
      unitId: null,
      agencyId: defaultAgency?.id ?? null,
    });
    console.log(`Seeded initial admin — username "admin", password "${adminPassword}". Change it after first login.`);
  }
}
