# Android OTA releases

The sideloaded handset fleet self-updates: on launch the app polls
`GET /v1/app/android/version`, and if a higher `versionCode` is published it
downloads and installs the APK (`AppUpdater.kt`). The `Android APK` GitHub
Action builds a **signed release APK** on every change under `android-app/` on
`main`, then publishes it to the server, so a normal merge ships an update to the
whole fleet.

```
push to main (android-app/**) → CI builds signed release APK
   → POST /v1/app/android/publish → server writes APK + version.json
   → handsets pick it up on next poll and auto-install
```

## One-time setup

### 1. Create a release keystore (do NOT commit it)

```bash
keytool -genkeypair -v -keystore release.keystore -alias safet \
  -keyalg RSA -keysize 2048 -validity 10000
# remember the store password, key alias (safet), and key password
base64 -w0 release.keystore > release.keystore.b64   # macOS: base64 release.keystore | tr -d '\n'
```

Keep `release.keystore` somewhere safe and backed up. **If it is ever lost, you
can no longer ship OTA updates** — every handset would need a manual reinstall.

### 2. Add GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `RELEASE_KEYSTORE_BASE64` | contents of `release.keystore.b64` |
| `RELEASE_KEYSTORE_PASSWORD` | the store password |
| `RELEASE_KEY_ALIAS` | `safet` (or your alias) |
| `RELEASE_KEY_PASSWORD` | the key password |
| `APP_UPDATE_PUBLISH_URL` | base server URL, e.g. `https://safet.up.railway.app` |
| `APP_UPDATE_PUBLISH_TOKEN` | a long random string (shared with the server below) |

### 3. Configure the server (Railway)

- Add a **persistent volume** and mount it (e.g. at `/data`). Published APKs must
  survive redeploys.
- Set environment variables:
  - `APP_UPDATES_DIR=/data/updates`  (anywhere on the volume)
  - `APP_UPDATE_PUBLISH_TOKEN=<same value as the GitHub secret>`

Without `APP_UPDATE_PUBLISH_TOKEN`, the publish endpoint returns `503` and OTA
publishing is disabled (the version/apk read endpoints still work).

### 4. Switch the fleet to the release key (one time)

Android refuses an update signed with a different key than what is installed. The
existing fleet is debug-signed, so each handset needs **one** manual install of
the new release-signed APK:

1. Run the `Android APK` workflow (or merge an android change) so a release APK is
   built; download `safet-ptt-release-apk` from the run's artifacts.
2. On each handset, uninstall the current app, then sideload the release APK.

After that, all future updates install automatically over the air.

## Day-to-day

Nothing — merge Android changes to `main` and the fleet updates itself. The
commit subject becomes the release notes. `versionCode` is `1000 + run number`
(monotonic); `versionName` is `0.1.<run number>`.

After the handset downloads a newer APK, the radio LCD shows an amber banner:
**UPDATE … DOWNLOADED — REBOOT RADIO TO INSTALL** (and the status line
**REBOOT TO INSTALL UPDATE**). The banner stays until the radio reboots onto the
new build or the app sees the updated `versionCode`.

## Manual publish (fallback)

```bash
curl -fsS -X POST "$URL/v1/app/android/publish" \
  -H "Authorization: Bearer $APP_UPDATE_PUBLISH_TOKEN" \
  -H "X-Version-Code: 1050" \
  -H "X-Version-Name: 0.1.50" \
  -H "X-Notes: hotfix" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @app-release.apk
```
