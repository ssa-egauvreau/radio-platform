# safeT Mobile (iOS)

## Generate the Xcode project

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
2. Open Terminal, go to this folder (`ios-app`).
3. Run: `xcodegen generate`
4. Open `SafeTMobile.xcodeproj` in Xcode on a Mac.

## P25 IMBE vocoder

The iOS app bundles the same **dvmvocoder** library as Android (GPL-2.0; see `android-app/app/src/main/cpp/dvmvocoder`). Native sources are compiled from that tree; the thin C bridge lives in `SafeTMobile/Native/p25_vocoder_bridge.cpp`.

When the vocoder loads successfully, voice uplink uses **88-bit IMBE** frames (matching Android and the web console). If the native library fails to link on a device, the app falls back to **clear PCM** uplink so you can still talk, but peers on digital mode may hear garbled audio until the vocoder is fixed.

After pulling repo changes that touch vocoder paths, run **Product → Clean Build Folder** in Xcode, then build again.
