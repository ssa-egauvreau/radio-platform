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

## MP22 (dual display, Android 8.1, no touch screen)

The MP22 has a **virtual Display 0** (PC can click/type with scrcpy) and a **physical Display 1** (hardware keys only; scrcpy cannot control it on Android 8.1).

**Workflow:**

1. Install the APK and open **safeT PTT** — it starts on the **virtual** screen for setup.
2. On your PC, mirror **without** `--display-id` (see `Start MP22 Setup Scrcpy.bat` below) so mouse and keyboard work.
3. Sign in, change settings, map buttons, etc.
4. In the app: **Settings (gear) → Device → MOVE TO PHYSICAL RADIO SCREEN**.
5. Use the radio’s **hardware keys** on the physical panel. Optional: scrcpy with `--display-id=1 --no-control` to watch only.

**IRC590 and other radios** are not affected — they launch normally on their only screen.

## TM-7 Plus on Android 10 (accessibility / PTT keys)

Some TM-7 Plus units on **Android 10** open **Settings → Accessibility** with an **empty list** — Inrico hides sideloaded apps there, so there is no on-screen toggle for safeT PTT.

**Try in the app first:** open safeT PTT → permissions prompt → **OPEN ACCESSIBILITY SETTINGS**. Newer builds deep-link to the service page when the radio allows it.

**If the list is still empty (most common on Android 10 TM-7 Plus):**

1. On the radio: turn on **USB debugging** (Developer options).
2. Connect the radio to your PC with USB (or use your existing scrcpy setup).
3. On the PC, open a Command Prompt in this repo’s **`dist`** folder.
4. Double-click **`Enable TM7 Plus Accessibility.bat`** (or run it from the prompt).
5. Unplug/reopen safeT PTT — physical **PTT** and **Emergency** keys should work.

The batch file runs the same `adb shell settings put secure ...` commands the app shows in the toast; it **keeps other accessibility services** enabled instead of replacing them.
