# Installable APK (safeT PTT)

This folder is for **built APK files** you can copy to radios or phones. APK files are **not stored in Git** (they are large); build locally or download from GitHub Actions.

## File name

After a successful build, use:

- `safeT-PTT-debug.apk` — debug build, signed with the project debug key (good for fleet sideload / updates over the same app)

The Gradle output path is:

`android-app/app/build/outputs/apk/debug/app-debug.apk`

## Build on your PC (Android Studio)

1. Open the **`android-app`** folder in Android Studio.
2. Wait for **Gradle sync** to finish.
3. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
4. When done, click **locate** in the notification, or open the path above.
5. Copy **`app-debug.apk`** to a USB drive or email/cloud and move it to each device.

## Build from a terminal (advanced)

From the repo root:

```bash
cd android-app
./gradlew assembleDebug
```

You need the Android SDK installed (`local.properties` with `sdk.dir=...`). See `docs/railway-android-setup.md`.

## Download from GitHub (no Android Studio)

Every push to **`main`** runs the **Android APK** workflow. On GitHub:

1. Open the repository → **Actions**.
2. Click the latest **Android APK** run (green check).
3. Scroll to **Artifacts** → download **`safet-ptt-apk`** (zip containing `app-debug.apk`).
4. Unzip and copy the APK to each device.

## Install on a device (drag-and-drop style)

1. Copy **`safeT-PTT-debug.apk`** to the device (USB cable, SD card, Google Drive, etc.).
2. On the device, open **Files** or **Downloads** and tap the APK.
3. If Android asks, allow **Install unknown apps** for that app (Files / Chrome).
4. Tap **Install**.
5. Open **safeT PTT** and sign in with your agency account.

**Note:** This debug APK is preconfigured to use **`https://safet.up.railway.app/`** unless you built with a custom `radio.api.base.url` in `local.properties`.
