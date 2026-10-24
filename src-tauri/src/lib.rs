//! Native shell around the web app. The site in dist/ is bundled into the app
//! and does all the work; native code here is only for what a browser can't do
//! (see docs/native-apps.md): Local share (src/local/), finding and talking to
//! devices on the same network, and files shared to the app from the file
//! manager or the Android share sheet (src/shared.rs).

#[cfg(target_os = "android")]
mod android;
mod local;
mod shared;

use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // "Share with Tools" on a file while the app is open starts a second
    // copy: hand its files to the running one and show it instead.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        use tauri::Manager;
        shared::add(app, shared::files_in_args(args));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_opener::init())
        .manage(local::LocalState::default())
        .manage(shared::SharedState::default())
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
            local::commands::local_received,
            local::commands::local_delete,
            local::commands::local_clear,
            local::commands::local_save_to_downloads,
            local::commands::local_web_start,
            local::commands::local_web_stop,
            local::commands::local_web_offer,
            local::commands::local_web_offer_chunk,
            local::commands::local_web_unoffer,
            shared::app_shared_files,
            shared::app_read_shared,
            shared::app_done_shared,
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
            // Started from "Share with Tools" with files.
            shared::add(app.handle(), shared::files_in_args(std::env::args()));
            // Paired devices can reach this one as soon as the app is open.
            if let Err(e) = local::start(app.handle()) {
                eprintln!("local share: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
