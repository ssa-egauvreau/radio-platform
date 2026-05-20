# Custom radio sounds

Copy your Motorola / Zello tone files into the project as follows.

## Android handset (IRC590 volume check)

**Replace on GitHub (exact path — keep the name `volume.wav`):**

`android-app/app/src/main/assets/sounds/volume.wav`

Use a **PCM WAV** file (same name). A longer clip loops more smoothly on the volume-check key (IRC590 key **232**).

After you upload/commit on GitHub, **rebuild and install** the Android app on the radio (Git pull in Android Studio → Build APK → install). Replacing the file on GitHub alone does not change a radio that already has the old APK installed.

## Dispatch console — 10-33 channel marker (12 second loop)

**Source (your PC):**

`I:\Shared drives\Executive\Vendors and Services\Zello Motrola Tones and Alerts\10-33 Tone 700hz 12 seconds.wav`

**Destination (bundled default for all agencies):**

`server/web-console/public/sounds/marker_1033.wav`

Copy and rename to exactly `marker_1033.wav`, then rebuild/redeploy the web console.

Agencies can also upload a custom marker under **Admin → Sounds → 10-33 channel marker**.

The marker replays every **12 seconds** while 10-33 is active on a channel panel.

## Busy / out-of-range tone (Android handsets + web console)

**Replace on GitHub (copy your file in as exactly `busy.wav` in both places):**

1. `android-app/app/src/main/assets/sounds/busy.wav` — handsets (IRC590, TM7, etc.)
2. `server/web-console/public/sounds/busy.wav` — dispatch web console

If your original file is named something like `Busy-OutofRange.wav`, **rename it to `busy.wav`** before uploading.

Use a **PCM WAV**. While you hold PTT on a busy or listen-only channel, the app plays the **full length** of the file and then **loops** until you release PTT.

**Behavior:**

- **Channel busy** or **listen-only** while you hold PTT: the tone **loops** (full clip each time) until you release PTT.
- **No connection / lost link**: play **2 seconds**, then stop; if still offline after **15 seconds**, play 2s again. When connection returns, the sound **stops immediately**.

After changing the Android path, rebuild and install the app. After changing the web path, redeploy Railway (or your host) so the console gets the new file.

Agencies can also upload a custom busy tone under **Admin → Sounds → busy** (server kind `busy`).
