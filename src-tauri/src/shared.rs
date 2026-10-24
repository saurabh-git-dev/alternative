//! Files shared *to* the app from outside: "Share with Tools" in the file
//! manager's right-click menu (Windows, Linux; the app is started with the
//! files' paths, or a running copy is handed them) and the Android share
//! sheet (MainActivity copies the shared files into the app and lists them
//! in `files/shared/pending.txt`). The page asks for them with
//! `app_shared_files` (on start, when the app comes to the front, and on
//! `app://shared`) and reads each with `app_read_shared`.

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct SharedState {
    pending: Mutex<Vec<PathBuf>>,
    /// Paths the page may read: only files shared to the app.
    allowed: Mutex<HashSet<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// Files among command-line arguments (the first one is the program).
pub fn files_in_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    args.into_iter().skip(1).map(PathBuf::from).filter(|p| p.is_file()).collect()
}

/// New files to share: remember them and tell the page.
pub fn add(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let state = app.state::<SharedState>();
    state.pending.lock().unwrap().extend(files);
    let _ = app.emit("app://shared", ());
}

#[cfg(target_os = "android")]
fn take_android(state: &SharedState) {
    let Some(dir) = crate::android::files_dir().map(|d| d.join("shared")) else { return };
    let list = dir.join("pending.txt");
    let Ok(text) = std::fs::read_to_string(&list) else { return };
    let _ = std::fs::remove_file(&list);
    state.pending.lock().unwrap().extend(text.lines().filter(|l| !l.is_empty()).map(PathBuf::from).filter(|p| p.is_file()));
}

/// Files shared to the app since the last call.
#[tauri::command]
pub fn app_shared_files(app: AppHandle) -> Vec<SharedFile> {
    let state = app.state::<SharedState>();
    #[cfg(target_os = "android")]
    take_android(&state);
    let files: Vec<PathBuf> = std::mem::take(&mut *state.pending.lock().unwrap());
    let mut allowed = state.allowed.lock().unwrap();
    files
        .into_iter()
        .filter_map(|path| {
            let size = std::fs::metadata(&path).ok()?.len();
            let name = path.file_name()?.to_string_lossy().into_owned();
            allowed.insert(path.clone());
            Some(SharedFile { name, path: path.to_string_lossy().into_owned(), size })
        })
        .collect()
}

/// A shared file's bytes.
#[tauri::command]
pub async fn app_read_shared(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    if !app.state::<SharedState>().allowed.lock().unwrap().contains(&path) {
        return Err("not a shared file".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Android keeps copies of shared files in the app; drop them once the page has them.
#[tauri::command]
pub fn app_done_shared(app: AppHandle, path: String) {
    let path = PathBuf::from(path);
    app.state::<SharedState>().allowed.lock().unwrap().remove(&path);
    #[cfg(target_os = "android")]
    if crate::android::files_dir().is_some_and(|d| path.starts_with(d.join("shared"))) {
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_existing_files_count() {
        let file = std::env::temp_dir().join("tools-shared-arg.txt");
        std::fs::write(&file, b"x").unwrap();
        let args = vec!["tools".to_string(), file.to_string_lossy().into(), "/no/such/file".into(), std::env::temp_dir().to_string_lossy().into()];
        assert_eq!(super::files_in_args(args), vec![file.clone()]);
        let _ = std::fs::remove_file(file);
    }
}
