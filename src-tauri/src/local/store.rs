//! Paired devices, kept in the app's data folder.

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Paired {
    pub fingerprint: String,
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: Option<String>,
    /// Where it was last seen, to reach it when multicast doesn't get through.
    pub ip: String,
    pub port: u16,
    pub paired_at: u64,
}

pub struct Store {
    path: PathBuf,
    pub devices: Vec<Paired>,
}

impl Store {
    pub fn load(dir: &std::path::Path) -> Self {
        let path = dir.join("paired.json");
        let devices = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Self { path, devices }
    }

    pub fn get(&self, fingerprint: &str) -> Option<&Paired> {
        self.devices.iter().find(|d| d.fingerprint == fingerprint)
    }

    pub fn is_paired(&self, fingerprint: &str) -> bool {
        self.get(fingerprint).is_some()
    }

    pub fn upsert(&mut self, device: Paired) {
        self.devices.retain(|d| d.fingerprint != device.fingerprint);
        self.devices.push(device);
        self.save();
    }

    /// Keep a paired device's name and address up to date; false if it isn't paired.
    pub fn seen(&mut self, fingerprint: &str, alias: &str, ip: &str, port: u16) -> bool {
        let Some(d) = self.devices.iter_mut().find(|d| d.fingerprint == fingerprint) else { return false };
        if d.alias != alias || d.ip != ip || d.port != port {
            d.alias = alias.to_string();
            d.ip = ip.to_string();
            d.port = port;
            self.save();
        }
        true
    }

    pub fn remove(&mut self, fingerprint: &str) {
        self.devices.retain(|d| d.fingerprint != fingerprint);
        self.save();
    }

    fn save(&self) {
        if let Ok(text) = serde_json::to_string_pretty(&self.devices) {
            let _ = fs::write(&self.path, text);
        }
    }
}
