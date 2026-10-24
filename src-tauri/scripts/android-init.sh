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

# The app draws edge to edge (forced from Android 15), so keep the page clear
# of the status bar, navigation bar, notch and keyboard by padding the
# content view by those insets.
activity=$(find src-tauri/gen/android/app/src/main -name MainActivity.kt | head -1)
package=$(grep -m1 '^package ' "$activity")
cat > "$activity" <<KOTLIN
$package

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      val bars = insets.getInsets(types)
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
KOTLIN
echo "Patched $activity"
