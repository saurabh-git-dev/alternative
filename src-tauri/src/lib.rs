//! Native shell around the web app. The site in dist/ is bundled into the app
//! and does all the work; native code here is only for what a browser can't do
//! (see docs/native-apps.md): Local share (src/local/), finding and talking to
//! devices on the same network.

#[cfg(target_os = "android")]
mod android;
mod local;

use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(local::LocalState::default())
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
        .invoke_handler(tauri::generate_handler![
            local::commands::local_start,
            local::commands::local_devices,
            local::commands::local_refresh,
            local::commands::local_pair_request,
            local::commands::local_pair_enter,
            local::commands::local_pair_cancel,
            local::commands::local_pair_dismiss,
            local::commands::local_forget,
            local::commands::local_link_send,
            local::commands::local_answer,
            local::commands::local_send_start,
            local::commands::local_send_chunk,
            local::commands::local_send_finish,
            local::commands::local_read_file,
            local::commands::local_reveal,
        ])
        .setup(|app| {
            // WebKitGTK ships with getUserMedia and WebRTC switched off.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(window) = app.get_webview_window("main") {
                    window.with_webview(|webview| {
                        if let Some(settings) = webview.inner().settings() {
                            settings.set_enable_media_stream(true);
                            settings.set_enable_webrtc(true);
                        }
                    })?;
                }
            }
            // Paired devices can reach this one as soon as the app is open.
            if let Err(e) = local::start(app.handle()) {
                eprintln!("local share: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
