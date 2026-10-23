//! This device's identity on the local network: a self-signed certificate
//! whose SHA-256 is its fingerprint. Made once and kept in the app's data
//! folder, so paired devices recognise it after a restart.

use std::{fs, path::Path};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub struct Identity {
    pub cert: Vec<u8>,
    pub key: Vec<u8>,
    pub fingerprint: String,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    cert: String,
    key: String,
}

/// Uppercase hex SHA-256 of a DER certificate.
pub fn fingerprint(cert: &[u8]) -> String {
    hex::encode_upper(Sha256::digest(cert))
}

impl Identity {
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        let path = dir.join("identity.json");
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(saved) = serde_json::from_str::<Saved>(&text) {
                if let (Ok(cert), Ok(key)) = (B64.decode(saved.cert), B64.decode(saved.key)) {
                    let fingerprint = fingerprint(&cert);
                    return Ok(Self { cert, key, fingerprint });
                }
            }
        }
        let made = rcgen::generate_simple_self_signed(vec!["localsend".to_string()]).map_err(|e| e.to_string())?;
        let cert = made.cert.der().to_vec();
        let key = made.signing_key.serialize_der();
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let saved = Saved { cert: B64.encode(&cert), key: B64.encode(&key) };
        fs::write(&path, serde_json::to_string(&saved).unwrap()).map_err(|e| e.to_string())?;
        let fingerprint = fingerprint(&cert);
        Ok(Self { cert, key, fingerprint })
    }
}
