//! What the page can ask of the local service (`invoke('local_…')`).

use std::sync::Arc;

use serde::Deserialize;
use tauri::{ipc::Request, AppHandle};

use super::{discovery, files, link, pair, send, types::*, web, Local};

fn local(app: &AppHandle) -> Result<Arc<Local>, String> {
    super::start(app)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    alias: String,
    device_model: Option<String>,
}

/// Start (once) and set this device's name; returns its fingerprint.
#[tauri::command]
pub fn local_start(app: AppHandle, args: StartArgs) -> Result<serde_json::Value, String> {
    let local = local(&app)?;
    {
        let mut me = local.me.write().unwrap();
        let alias: String = args.alias.trim().chars().take(40).collect();
        if !alias.is_empty() {
            me.alias = alias;
        }
        me.device_model = args.device_model.filter(|m| !m.is_empty());
    }
    local.save_me();
    Ok(serde_json::json!({ "fingerprint": local.id.fingerprint, "port": *local.port.read().unwrap() }))
}

#[tauri::command]
pub fn local_devices(app: AppHandle) -> Result<Vec<DeviceView>, String> {
    Ok(local(&app)?.devices())
}

/// Look again: announce, and ask every address nearby (for networks that block multicast).
#[tauri::command]
pub async fn local_refresh(app: AppHandle) -> Result<(), String> {
    discovery::scan(local(&app)?).await;
    Ok(())
}

#[tauri::command]
pub async fn local_pair_request(app: AppHandle, fingerprint: String) -> Result<(), String> {
    pair::request_pin(local(&app)?, fingerprint).await
}

#[tauri::command]
pub async fn local_pair_enter(app: AppHandle, fingerprint: String, pin: String) -> Result<(), String> {
    pair::enter_pin(local(&app)?, fingerprint, pin).await
}

#[tauri::command]
pub async fn local_pair_cancel(app: AppHandle, fingerprint: String) -> Result<(), String> {
    pair::cancel(local(&app)?, fingerprint).await;
    Ok(())
}

/// Stop showing a PIN on this device.
#[tauri::command]
pub fn local_pair_dismiss(app: AppHandle, fingerprint: String) -> Result<(), String> {
    local(&app)?.pairing.lock().unwrap().remove(&fingerprint);
    Ok(())
}

#[tauri::command]
pub fn local_forget(app: AppHandle, fingerprint: String) -> Result<(), String> {
    let local = local(&app)?;
    local.store.lock().unwrap().remove(&fingerprint);
    link::close(&local, &fingerprint);
    local.emit_devices();
    Ok(())
}

/// Send a chat message or call signal to a paired device; false if its link is down.
#[tauri::command]
pub fn local_link_send(app: AppHandle, fingerprint: String, data: serde_json::Value) -> Result<bool, String> {
    let local = local(&app)?;
    Ok(link::send(&local, &fingerprint, &data))
}

/// Answer a question shown on the page (accept these files?).
#[tauri::command]
pub fn local_answer(app: AppHandle, request: String, accept: bool) -> Result<(), String> {
    if let Some(tx) = local(&app)?.asks.lock().unwrap().remove(&request) {
        let _ = tx.send(accept);
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendArgs {
    fingerprint: String,
    files: Vec<FileMeta>,
    pin: Option<String>,
}

#[tauri::command]
pub async fn local_send_start(app: AppHandle, args: SendArgs) -> Result<send::Started, String> {
    send::start(local(&app)?, args.fingerprint, args.files, args.pin).await
}

/// A chunk of a file: the raw bytes as the body, `x-transfer`, `x-file` and `x-last` headers.
#[tauri::command]
pub async fn local_send_chunk(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let transfer = header("x-transfer").ok_or("missing transfer")?;
    let file = header("x-file").ok_or("missing file")?;
    let last = header("x-last").as_deref() == Some("1");
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("expected raw bytes".into()),
    };
    send::chunk(local(&app)?, &transfer, &file, bytes, last).await
}

#[tauri::command]
pub async fn local_send_finish(app: AppHandle, transfer: String, cancelled: bool) -> Result<(), String> {
    send::finish(local(&app)?, &transfer, cancelled).await;
    Ok(())
}

/// A received file's bytes, to open it in the tools.
#[tauri::command]
pub async fn local_read_file(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    // Only files this feature saved.
    let path = files::received(&*local(&app)?, &path)?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Show a received file in the system's file manager.
#[tauri::command]
pub fn local_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let _ = local(&app)?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// Received files, newest first.
#[tauri::command]
pub fn local_received(app: AppHandle) -> Result<Vec<files::ReceivedFile>, String> {
    Ok(files::list(&*local(&app)?))
}

#[tauri::command]
pub fn local_delete(app: AppHandle, path: String) -> Result<(), String> {
    files::delete(&*local(&app)?, &path)
}

/// Delete every received file; returns how many.
#[tauri::command]
pub fn local_clear(app: AppHandle) -> Result<usize, String> {
    Ok(files::clear(&*local(&app)?))
}

/// Android: copy a received file to the shared Downloads folder (received
/// files live in the app's own folder there). Returns where it went.
#[tauri::command]
pub async fn local_save_to_downloads(app: AppHandle, path: String) -> Result<String, String> {
    let path = files::received(&*local(&app)?, &path)?;
    #[cfg(target_os = "android")]
    {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
        let mime = files::guess_type(&name);
        tauri::async_runtime::spawn_blocking(move || crate::android::save_to_downloads(&path, &name, mime))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "android"))]
    {
        // On computers received files are already in Downloads/Tools.
        Ok(path.to_string_lossy().into_owned())
    }
}

/// Switch on the page for browsers on this network (A2B); returns its addresses and key.
#[tauri::command]
pub async fn local_web_start(app: AppHandle) -> Result<web::Started, String> {
    web::start(local(&app)?).await
}

#[tauri::command]
pub fn local_web_stop(app: AppHandle) -> Result<(), String> {
    web::stop(&*local(&app)?);
    Ok(())
}

/// Offer a file to browsers; its bytes follow with `local_web_offer_chunk`.
#[tauri::command]
pub fn local_web_offer(app: AppHandle, name: String, size: u64) -> Result<String, String> {
    web::offer(&*local(&app)?, &name, size)
}

/// A piece of an offered file: raw bytes as the body, `x-id` and `x-last` headers.
#[tauri::command]
pub async fn local_web_offer_chunk(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let id = header("x-id").ok_or("missing id")?;
    let last = header("x-last").as_deref() == Some("1");
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    web::offer_chunk(&*local(&app)?, &id, bytes, last).await
}

#[tauri::command]
pub fn local_web_unoffer(app: AppHandle, id: String) -> Result<(), String> {
    web::unoffer(&*local(&app)?, &id);
    Ok(())
}
