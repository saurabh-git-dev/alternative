//! Native shell around the web app. The site in dist/ is bundled into the app
//! and does all the work; native code here is only for what a browser can't do
//! (see docs/native-apps.md).

use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The page is the app's own bundled code, so camera, microphone and
        // screen capture (QR scanner, calls, screen recorder) are allowed
        // without a second, browser-style prompt. Android still asks for its
        // runtime permission the first time.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::DisplayCapture => {
                PermissionResponse::Allow
            }
            _ => PermissionResponse::Default,
        })
        .setup(|_app| {
            // WebKitGTK ships with getUserMedia and WebRTC switched off.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(window) = _app.get_webview_window("main") {
                    window.with_webview(|webview| {
                        if let Some(settings) = webview.inner().settings() {
                            settings.set_enable_media_stream(true);
                            settings.set_enable_webrtc(true);
                        }
                    })?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
