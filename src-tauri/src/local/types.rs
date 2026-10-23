//! Messages of the LocalSend protocol v2 (https://github.com/localsend/protocol)
//! and what the web page sees.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "2.1";
pub const MULTICAST_ADDR: [u8; 4] = [224, 0, 0, 167];
pub const DEFAULT_PORT: u16 = 53317;
/// Batches bigger than this always ask before arriving, even from a paired device.
pub const HUGE_BYTES: u64 = 1024 * 1024 * 1024;

/// A device's description: the multicast announcement, `/register` and `/info`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub alias: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub device_model: Option<String>,
    #[serde(default)]
    pub device_type: Option<String>,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(default)]
    pub download: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announce: Option<bool>,
    /// Set by this app (LocalSend ignores it): the device can pair and chat, not just take files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<u32>,
}

fn default_version() -> String {
    "1.0".into()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    #[serde(default)]
    pub file_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PrepareUpload {
    pub info: Info,
    pub files: HashMap<String, FileMeta>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrepareResponse {
    pub session_id: String,
    pub files: HashMap<String, String>,
}

/// A device as the Local share page lists it.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub fingerprint: String,
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: Option<String>,
    /// Runs this app (can pair, chat and call), rather than LocalSend.
    pub ours: bool,
    pub paired: bool,
    /// Seen on the network recently.
    pub online: bool,
    /// A paired device whose chat link is open.
    pub linked: bool,
    pub ip: String,
    pub last_seen: u64,
}

/// A file that arrived, saved to disk.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub file_type: String,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
