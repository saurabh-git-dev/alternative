//! Native shell around the web app. The site in dist/ is bundled into the app
//! and does all the work; native code here is only for what a browser can't do
//! (see docs/native-apps.md).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
