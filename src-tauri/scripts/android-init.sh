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

# "Share with Tools" in the Android share sheet: the activity takes one or
# several files of any type (and shared text, saved as a .txt file).
filters='<intent-filter android:label="Share with Tools">\n                <action android:name="android.intent.action.SEND" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="*\/*" />\n            </intent-filter>\n            <intent-filter android:label="Share with Tools">\n                <action android:name="android.intent.action.SEND_MULTIPLE" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <data android:mimeType="*\/*" />\n            </intent-filter>\n        </activity>'
grep -q "android.intent.action.SEND" "$manifest" || sed -i "0,/<\/activity>/s##${filters}#" "$manifest"
grep -n "intent.action" "$manifest"

# MainActivity:
# - The app draws edge to edge (forced from Android 15), so keep the page
#   clear of the status bar, navigation bar, notch and keyboard by padding
#   the content view by those insets.
# - Files shared to the app are copied into files/shared/ and listed in
#   files/shared/pending.txt, which the native side hands to the page
#   (src-tauri/src/shared.rs).
activity=$(find src-tauri/gen/android/app/src/main -name MainActivity.kt | head -1)
package=$(grep -m1 '^package ' "$activity")
cat > "$activity" <<'KOTLIN'
PACKAGE_LINE

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

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
    if (savedInstanceState == null) receiveShare(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    receiveShare(intent)
  }

  private fun receiveShare(intent: Intent?) {
    if (intent == null) return
    val uris = mutableListOf<Uri>()
    when (intent.action) {
      Intent.ACTION_SEND -> {
        val uri = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (uri != null) uris.add(uri)
      }
      Intent.ACTION_SEND_MULTIPLE -> {
        val list = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
          else @Suppress("DEPRECATION") intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        if (list != null) uris.addAll(list)
      }
      else -> return
    }
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    // Handled once, even if the activity is recreated.
    intent.action = null
    val dir = File(filesDir, "shared").apply { mkdirs() }
    Thread {
      val saved = mutableListOf<String>()
      for (uri in uris) {
        try {
          val file = uniqueFile(dir, displayName(uri))
          contentResolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } }
          if (file.exists()) saved.add(file.absolutePath)
        } catch (e: Exception) {
          android.util.Log.w("Tools", "Couldn't read a shared file", e)
        }
      }
      if (uris.isEmpty() && !text.isNullOrBlank()) {
        val file = uniqueFile(dir, "Shared text.txt")
        file.writeText(text)
        saved.add(file.absolutePath)
      }
      if (saved.isNotEmpty()) {
        synchronized(MainActivity::class.java) {
          File(dir, "pending.txt").appendText(saved.joinToString("\n", postfix = "\n"))
        }
      }
    }.start()
  }

  private fun displayName(uri: Uri): String {
    var name: String? = null
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) name = c.getString(0)
      }
    } catch (_: Exception) {}
    val clean = (name ?: uri.lastPathSegment ?: "file").replace(Regex("[/\\\\:*?\"<>|]"), "_").trim().trimStart('.')
    return clean.ifEmpty { "file" }
  }

  private fun uniqueFile(dir: File, name: String): File {
    var file = File(dir, name)
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var n = 2
    while (file.exists()) file = File(dir, "$stem ($n)$ext").also { n++ }
    return file
  }
}
KOTLIN
sed -i "s#^PACKAGE_LINE\$#${package}#" "$activity"
echo "Patched $activity"
