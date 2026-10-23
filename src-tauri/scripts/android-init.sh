#!/usr/bin/env bash
# Generates the Android project (src-tauri/gen/android, not committed), gives
# it the app icons and adds the permissions the web app needs. Run from the
# repo root; needs the Android SDK and NDK (see docs/native-apps.md).
set -euo pipefail

npx tauri android init --ci
npx tauri icon public/icons/icon-512.png

# Camera and microphone: QR scanner, voice and video calls, screen recorder.
# The webview asks for each at runtime the first time a page uses it.
PERMISSIONS=(
  android.permission.CAMERA
  android.permission.RECORD_AUDIO
  android.permission.MODIFY_AUDIO_SETTINGS
  # Local share: find devices on the Wi-Fi (multicast) and talk to them.
  android.permission.INTERNET
  android.permission.ACCESS_NETWORK_STATE
  android.permission.ACCESS_WIFI_STATE
  android.permission.CHANGE_WIFI_MULTICAST_STATE
)

manifest=src-tauri/gen/android/app/src/main/AndroidManifest.xml
lines=""
for permission in "${PERMISSIONS[@]}"; do
  grep -q "\"$permission\"" "$manifest" || lines+="<uses-permission android:name=\"$permission\" />\n    "
done
sed -i "0,/<application/s##${lines}<application#" "$manifest"
grep -n "uses-permission" "$manifest"
