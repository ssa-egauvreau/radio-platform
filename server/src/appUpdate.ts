// Android in-app updater backend.
//
// The handset fleet is sideloaded (no Play Store, no MDM), so the app checks
// here for a newer build and downloads the APK directly. To publish a release,
// drop the signed APK and a small version.json into the updates directory:
//
//   <updatesDir>/version.json   { "versionCode": 2, "versionName": "0.2.0",
//                                 "file": "safet-ptt-0.2.0.apk",
//                                 "mandatory": false, "notes": "..." }
//   <updatesDir>/safet-ptt-0.2.0.apk
//
// The directory defaults to the built web-public/updates/android folder beside
// the compiled server; set APP_UPDATES_DIR to point at a persistent volume so
// published APKs survive redeploys. The APK must be signed with the same key as
// the installed build or Android refuses the update.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

const updatesDir = process.env.APP_UPDATES_DIR
  ? resolve(process.env.APP_UPDATES_DIR)
  : resolve(dirname(fileURLToPath(import.meta.url)), "web-public", "updates", "android");

const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

interface ManifestFile {
  versionCode?: unknown;
  versionName?: unknown;
  file?: unknown;
  mandatory?: unknown;
  notes?: unknown;
}

interface ResolvedManifest {
  versionCode: number;
  versionName: string;
  fileName: string;
  apkPath: string;
  mandatory: boolean;
  notes: string;
}

interface AndroidPublishAuthError {
  status: 401 | 503;
  error: "unauthorized" | "publish_disabled";
}

// Cache the APK hash by size+mtime so polling handsets don't re-hash on every check.
let shaCache: { key: string; sha256: string } | null = null;

function apkSha256(apkPath: string): string {
  const st = statSync(apkPath);
  // Path is part of the key so a same-size/same-mtime replacement (e.g. a
  // release artifact that preserves timestamps) can't reuse a stale hash.
  const key = `${apkPath}:${st.size}:${st.mtimeMs}`;
  if (shaCache?.key === key) {
    return shaCache.sha256;
  }
  const sha256 = createHash("sha256").update(readFileSync(apkPath)).digest("hex");
  shaCache = { key, sha256 };
  return sha256;
}

/** Shared auth check used by route pre-check + publish handler. */
export function androidUpdatePublishAuthError(
  headers: Request["headers"],
): AndroidPublishAuthError | null {
  const token = process.env.APP_UPDATE_PUBLISH_TOKEN?.trim();
  if (!token) {
    return { status: 503, error: "publish_disabled" };
  }
  const auth = headers.authorization;
  const authHeader = Array.isArray(auth) ? auth[0] ?? "" : auth ?? "";
  const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (provided.length === 0 || provided !== token) {
    return { status: 401, error: "unauthorized" };
  }
  return null;
}

/** Reads and validates version.json + the referenced APK, or null if unpublished/invalid. */
function readManifest(): ResolvedManifest | null {
  const manifestPath = join(updatesDir, "version.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  let raw: ManifestFile;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestFile;
  } catch {
    return null;
  }
  const versionCode = Number(raw.versionCode);
  const fileName = typeof raw.file === "string" ? raw.file : "";
  // Reject path traversal — the APK must sit directly inside the updates dir.
  if (!Number.isInteger(versionCode) || versionCode <= 0 || fileName === "" || /[\\/]/.test(fileName)) {
    return null;
  }
  const apkPath = join(updatesDir, fileName);
  if (!existsSync(apkPath)) {
    return null;
  }
  return {
    versionCode,
    versionName: typeof raw.versionName === "string" ? raw.versionName : String(versionCode),
    fileName,
    apkPath,
    mandatory: raw.mandatory === true,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

/** Public: returns the latest Android build descriptor for handsets to compare against. */
export function handleAndroidUpdateManifest(_req: Request, res: Response): void {
  const manifest = readManifest();
  if (!manifest) {
    res.status(404).json({ error: "no_update_published" });
    return;
  }
  res.setHeader("Cache-Control", "no-cache");
  res.json({
    versionCode: manifest.versionCode,
    versionName: manifest.versionName,
    url: "/v1/app/android/apk",
    sha256: apkSha256(manifest.apkPath),
    mandatory: manifest.mandatory,
    notes: manifest.notes,
  });
}

/**
 * CI publish endpoint: writes a freshly-built APK + version.json into the updates dir so the next
 * handset poll picks it up. Authenticated with a shared bearer token (APP_UPDATE_PUBLISH_TOKEN);
 * disabled when that env var is unset. The APK arrives as the raw request body; metadata comes in
 * headers so the body stays a clean binary stream.
 */
export function handleAndroidUpdatePublish(req: Request, res: Response): void {
  const authError = androidUpdatePublishAuthError(req.headers);
  if (authError) {
    res.status(authError.status).json({ error: authError.error });
    return;
  }

  const versionCode = Number(req.headers["x-version-code"]);
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    res.status(400).json({ error: "bad_version_code" });
    return;
  }
  const versionNameRaw = String(req.headers["x-version-name"] ?? versionCode);
  // Keep the version name filename-safe; it becomes part of the on-disk APK name.
  const versionName = versionNameRaw.replace(/[^A-Za-z0-9._-]/g, "") || String(versionCode);
  const mandatory = String(req.headers["x-mandatory"] ?? "").toLowerCase() === "true";
  const notes = typeof req.headers["x-notes"] === "string" ? req.headers["x-notes"].slice(0, 500) : "";

  const apk = req.body;
  if (!Buffer.isBuffer(apk) || apk.length === 0) {
    res.status(400).json({ error: "empty_apk" });
    return;
  }

  const fileName = `safet-ptt-${versionName}-${versionCode}.apk`;
  try {
    mkdirSync(updatesDir, { recursive: true });
    writeFileSync(join(updatesDir, fileName), apk);
    const manifest = { versionCode, versionName, file: fileName, mandatory, notes };
    writeFileSync(join(updatesDir, "version.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (e) {
    res.status(500).json({ error: "write_failed", message: e instanceof Error ? e.message : String(e) });
    return;
  }
  // Force the next manifest read to re-hash the new APK.
  shaCache = null;
  res.json({ ok: true, versionCode, versionName, file: fileName, bytes: apk.length });
}

/** Public: streams the published APK so the handset can install it. */
export function handleAndroidUpdateApk(_req: Request, res: Response): void {
  const manifest = readManifest();
  if (!manifest) {
    res.status(404).json({ error: "no_update_published" });
    return;
  }
  res.setHeader("Content-Type", APK_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${manifest.fileName}"`);
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(manifest.apkPath);
}
