# Native apps

Windows, Linux and Android apps wrap the same site in a thin
[Tauri 2](https://tauri.app) shell (`src-tauri/`). The built site (`dist/`)
is bundled inside the app, so every tool works offline exactly as on the web,
and a tool added under `src/actions/` shows up in all the apps with no extra
work. Native code is only for what a browser can't do: Local share, which
finds devices on the local network and pairs, chats, calls and sends files
with them directly (see [local-share.md](local-share.md)).

| Platform | Files | Runs on |
|---|---|---|
| Windows x64 | `…_x64-setup.exe` (installer), `…_x64_en-US.msi` | Windows 10/11 (WebView2) |
| Linux x64 | `.AppImage`, `.deb`, `.rpm` | glibc 2.35+ (Ubuntu 22.04, Debian 12, Fedora 36 …) |
| Linux arm64 | `.AppImage`, `.deb`, `.rpm` | same, on ARM (Raspberry Pi 5, ARM laptops) |
| Android | `…_android.apk` (arm64, armv7, x86_64) | Android 7+ |

## Inside the app

- The page is served from the app's own origin with the same cross-origin
  isolation headers as the site (`app.security.headers` in
  `src-tauri/tauri.conf.json`), so multi-threaded WASM engines still work.
- `isNativeApp()` (`src/pwa/install.svelte.ts`) tells the page it is inside
  the app; the service worker is skipped there because every file is already
  bundled.
- Camera, microphone and screen capture are allowed for the app's own page
  (`on_permission_request` in `src-tauri/src/lib.rs`). On Linux the app also
  switches on WebKitGTK's media stream and WebRTC settings, which are off by
  default; on Android, `src-tauri/scripts/android-init.sh` adds the camera,
  microphone and network permissions, and the system asks for the camera and
  microphone the first time.
- Local share runs in the native side (`src-tauri/src/local/`), started with
  the app; on Android it holds a Wi-Fi multicast lock so discovery works.
- Linux uses the system WebKitGTK rather than Chromium: video tools fall back
  to ffmpeg.wasm where WebCodecs is missing.

## Releases

Every merge to `main` runs `.github/workflows/release.yml`:

1. **Version**: the next semver from the commit messages since the last
   `v*` tag. A breaking change (`feat!:`, `fix!:` or "BREAKING CHANGE") bumps
   major, `feat:` bumps minor, anything else bumps patch. Merge commits carry
   the PR title, so title a PR `feat: …` for a minor release.
2. **Site**: checked, tested, built and published to GitHub Pages.
3. **Apps**: Windows, Linux x64, Linux arm64 and Android are built in
   parallel with that version.
4. **Release**: the commit is tagged `vX.Y.Z` and a GitHub release is created
   with all the app files and generated notes.

Pull requests that change `src-tauri/` or the workflow run the app builds
too, without releasing.

### Android signing

Add these repository secrets (Settings → Secrets and variables → Actions) so
every APK is signed with the same key and installs as an update over the
last one. Without them each APK is signed with a throwaway key.

```sh
keytool -genkey -v -keystore tools-release.jks -alias tools -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 tools-release.jks
```

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the base64 output |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `tools` |
| `ANDROID_KEY_PASSWORD` | key password (often the same) |

Keep the `.jks` file and passwords safe: losing them means users have to
uninstall to get updates.

Windows and Linux builds are unsigned; Windows SmartScreen asks "More info →
Run anyway" on first launch until a code-signing certificate is added.

## Building locally

```sh
npm ci
npm run tauri dev                      # desktop window with hot reload
npm run tauri build                    # installers in src-tauri/target/release/bundle/
src-tauri/scripts/android-init.sh && npm run tauri android dev   # needs Android SDK + NDK
```

Linux needs `libwebkit2gtk-4.1-dev librsvg2-dev patchelf`; see
[Tauri's prerequisites](https://tauri.app/start/prerequisites/).
