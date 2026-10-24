//! The folder received files are saved in: list, delete, clear, and (on
//! Android, where that folder is the app's own) copy to the phone's
//! Downloads folder.

use std::path::{Path, PathBuf};

use serde::Serialize;

use super::Local;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_type: String,
    /// Milliseconds since 1970.
    pub modified: u64,
}

/// A MIME type from the extension, for previews and the tools.
pub fn guess_type(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "txt" | "log" | "md" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        "apk" => "application/vnd.android.package-archive",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

/// Files only, skipping half-received ones (`.part`) and hidden ones.
fn is_listed(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    !name.starts_with('.') && !name.ends_with(".part") && path.is_file()
}

/// Received files, newest first.
pub fn list(local: &Local) -> Vec<ReceivedFile> {
    let mut files: Vec<ReceivedFile> = std::fs::read_dir(local.download_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| is_listed(&entry.path()))
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(ReceivedFile {
                file_type: guess_type(&name).into(),
                path: entry.path().to_string_lossy().into_owned(),
                name,
                size: meta.len(),
                modified,
            })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files
}

/// A path the page passed in, if it is a received file (never anything else on the device).
pub fn received(local: &Local, path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let inside = [local.download_dir(), local.dir.join("received")]
        .iter()
        .any(|dir| path.parent() == Some(dir.as_path()));
    if inside && is_listed(&path) {
        Ok(path)
    } else {
        Err("not a received file".into())
    }
}

pub fn delete(local: &Local, path: &str) -> Result<(), String> {
    std::fs::remove_file(received(local, path)?).map_err(|e| e.to_string())
}

/// Delete every received file; returns how many.
pub fn clear(local: &Local) -> usize {
    list(local).iter().filter(|f| std::fs::remove_file(&f.path).is_ok()).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_deletes_and_clears_only_received_files() {
        let root = std::env::temp_dir().join(format!("tools-files-{}", super::super::rand_id()));
        let downloads = root.join("Downloads");
        let local = Local::new(root.join("local"), Some(downloads.clone()), Box::new(|_, _| {})).unwrap();
        let dir = local.download_dir();
        std::fs::write(dir.join("a.pdf"), b"pdf").unwrap();
        std::fs::write(dir.join("b.txt.part"), b"half").unwrap();
        std::fs::write(downloads.join("mine.txt"), b"not received").unwrap();

        let files = list(&local);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_type, "application/pdf");
        assert!(received(&local, &downloads.join("mine.txt").to_string_lossy()).is_err());
        assert!(delete(&local, &dir.join("b.txt.part").to_string_lossy()).is_err());

        std::fs::write(dir.join("c.png"), b"png").unwrap();
        delete(&local, &files[0].path).unwrap();
        assert_eq!(clear(&local), 1);
        assert!(list(&local).is_empty());
        assert!(downloads.join("mine.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
