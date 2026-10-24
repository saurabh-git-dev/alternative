//! Local share: finding devices on the same network and talking to them
//! directly, with no internet and no server.
//!
//! - Speaks LocalSend's protocol v2 (multicast discovery, an HTTPS API to send
//!   files), so LocalSend apps on any platform show up and can swap files with
//!   this app.
//! - Between two copies of this app, adds pairing with a 6-digit PIN
//!   (`pair.rs`) and, once paired, a lasting link for chat and call
//!   signalling (`link.rs`). Paired devices are remembered and shown online or
//!   offline; their files arrive without asking (unless over 1 GB).
//! - Received files are written straight to disk (`server.rs`); files to send
//!   are streamed in from the page in chunks (`send.rs`).
//!
//! The page talks to this through the `local_*` commands in `commands.rs` and
//! listens to `local://…` events. See docs/local-share.md.

mod client;
pub mod commands;
mod discovery;
pub mod files;
mod identity;
mod link;
mod pair;
mod send;
mod server;
mod store;
mod tls;
mod types;
pub mod web;
#[cfg(test)]
mod tests;

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
};

use rustls::{ClientConfig, ServerConfig};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Sends an event to the page (or, in tests, wherever they want it).
pub type Emit = Box<dyn Fn(&str, serde_json::Value) + Send + Sync>;
use tokio::sync::{mpsc, oneshot};

use identity::Identity;
use store::Store;
use types::*;

/// A device seen on the network.
#[derive(Clone, Debug)]
pub struct Peer {
    pub info: Info,
    pub ip: String,
    pub port: u16,
    pub https: bool,
    pub last_seen: u64,
}

/// Considered offline after this long without being heard from.
const ONLINE_FOR_MS: u64 = 75_000;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub alias: String,
    pub device_model: Option<String>,
    pub device_type: String,
}

pub struct Local {
    emit: Emit,
    /// The system's downloads folder, if it has one.
    downloads: Option<PathBuf>,
    pub id: Identity,
    pub me: RwLock<Me>,
    pub port: RwLock<u16>,
    pub peers: RwLock<HashMap<String, Peer>>,
    pub store: Mutex<Store>,
    pub server_tls: Arc<ServerConfig>,
    pub client_tls: Arc<ClientConfig>,
    /// Questions waiting on the person (accept these files?), by request id.
    pub asks: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    /// Files arriving, by session id.
    pub incoming: tokio::sync::Mutex<HashMap<String, server::Incoming>>,
    /// Files being sent, by transfer id.
    pub outgoing: tokio::sync::Mutex<HashMap<String, send::Outgoing>>,
    /// PINs on screen, by the fingerprint of the device asking to pair.
    pub pairing: Mutex<HashMap<String, pair::Pending>>,
    /// Open chat links to paired devices, by fingerprint.
    pub links: Mutex<HashMap<String, (u64, mpsc::UnboundedSender<Vec<u8>>)>>,
    pub dir: PathBuf,
    /// The page for browsers (web.rs), while switched on.
    pub web: web::WebState,
}

impl Local {
    pub fn info(&self, announce: Option<bool>) -> Info {
        let me = self.me.read().unwrap().clone();
        Info {
            alias: me.alias,
            version: PROTOCOL_VERSION.into(),
            device_model: me.device_model,
            device_type: Some(me.device_type),
            fingerprint: self.id.fingerprint.clone(),
            port: Some(*self.port.read().unwrap()),
            protocol: Some("https".into()),
            download: false,
            announce,
            tools: Some(1),
        }
    }

    /// Note a device heard from on the network.
    pub fn saw(&self, info: Info, ip: String, port: u16, https: bool) {
        if info.fingerprint.is_empty() || info.fingerprint.eq_ignore_ascii_case(&self.id.fingerprint) {
            return;
        }
        self.store.lock().unwrap().seen(&info.fingerprint, &info.alias, &ip, port);
        let fresh = {
            let mut peers = self.peers.write().unwrap();
            let before = peers.get(&info.fingerprint).map(|p| (p.info.alias.clone(), p.last_seen));
            let changed = !matches!(&before, Some((alias, seen)) if *alias == info.alias && now_ms() - seen < ONLINE_FOR_MS);
            peers.insert(info.fingerprint.clone(), Peer { info, ip, port, https, last_seen: now_ms() });
            changed
        };
        if fresh {
            self.emit_devices();
        }
    }

    /// Where to reach a device: where it was last heard from, or where a paired one was last seen.
    pub fn address(&self, fingerprint: &str) -> Option<(String, u16, bool)> {
        if let Some(p) = self.peers.read().unwrap().get(fingerprint) {
            return Some((p.ip.clone(), p.port, p.https));
        }
        self.store.lock().unwrap().get(fingerprint).map(|d| (d.ip.clone(), d.port, true))
    }

    pub fn devices(&self) -> Vec<DeviceView> {
        let now = now_ms();
        let peers = self.peers.read().unwrap();
        let store = self.store.lock().unwrap();
        let links = self.links.lock().unwrap();
        let mut list: Vec<DeviceView> = peers
            .values()
            .map(|p| DeviceView {
                fingerprint: p.info.fingerprint.clone(),
                alias: p.info.alias.clone(),
                device_model: p.info.device_model.clone(),
                device_type: p.info.device_type.clone(),
                ours: p.info.tools.is_some(),
                paired: store.is_paired(&p.info.fingerprint),
                online: now - p.last_seen < ONLINE_FOR_MS || links.contains_key(&p.info.fingerprint),
                linked: links.contains_key(&p.info.fingerprint),
                ip: p.ip.clone(),
                last_seen: p.last_seen,
            })
            .collect();
        for d in &store.devices {
            if peers.contains_key(&d.fingerprint) {
                continue;
            }
            let linked = links.contains_key(&d.fingerprint);
            list.push(DeviceView {
                fingerprint: d.fingerprint.clone(),
                alias: d.alias.clone(),
                device_model: d.device_model.clone(),
                device_type: d.device_type.clone(),
                ours: true,
                paired: true,
                online: linked,
                linked,
                ip: d.ip.clone(),
                last_seen: 0,
            });
        }
        list.sort_by(|a, b| b.paired.cmp(&a.paired).then(b.online.cmp(&a.online)).then(a.alias.to_lowercase().cmp(&b.alias.to_lowercase())));
        list
    }

    pub fn emit_devices(&self) {
        (self.emit)("local://devices", serde_json::to_value(self.devices()).unwrap());
    }

    pub fn emit(&self, event: &str, payload: serde_json::Value) {
        (self.emit)(event, payload);
    }

    /// Ask the person something on the page and wait for the answer (false if nobody answers in time).
    pub async fn ask(&self, event: &str, mut payload: serde_json::Value, wait: std::time::Duration) -> bool {
        let id = rand_id();
        let (tx, rx) = oneshot::channel();
        self.asks.lock().unwrap().insert(id.clone(), tx);
        payload["request"] = id.clone().into();
        self.emit(event, payload);
        let answer = tokio::time::timeout(wait, rx).await.ok().and_then(|r| r.ok()).unwrap_or(false);
        if self.asks.lock().unwrap().remove(&id).is_some() {
            self.emit("local://ask-closed", serde_json::json!({ "request": id }));
        }
        answer
    }

    /// Folder for received files: Downloads/Tools on computers, the shared Download folder on Android.
    pub fn download_dir(&self) -> PathBuf {
        let dir = match self.downloads.clone() {
            Some(d) if cfg!(target_os = "android") => d,
            Some(d) => d.join("Tools"),
            None => self.dir.join("received"),
        };
        // Android may not let apps write to the shared folder (older versions, or permission refused).
        let probe = dir.join(".tools-write-test");
        if std::fs::create_dir_all(&dir).is_ok() && std::fs::write(&probe, b"").is_ok() {
            let _ = std::fs::remove_file(probe);
            dir
        } else {
            let fallback = self.dir.join("received");
            let _ = std::fs::create_dir_all(&fallback);
            fallback
        }
    }
}

pub fn rand_id() -> String {
    let bytes: [u8; 16] = rand::random();
    hex::encode(bytes)
}

/// The running service, once started.
#[derive(Default)]
pub struct LocalState(pub Mutex<Option<Arc<Local>>>);

/// Start the local services (once per app run).
pub fn start(app: &AppHandle) -> Result<Arc<Local>, String> {
    let state = app.state::<LocalState>();
    let mut slot = state.0.lock().unwrap();
    if let Some(local) = slot.clone() {
        return Ok(local);
    }
    // TOOLS_LOCAL_DIR runs a second copy with its own identity, for trying pairing on one computer.
    let dir = match std::env::var_os("TOOLS_LOCAL_DIR") {
        Some(d) => PathBuf::from(d),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?.join("local"),
    };
    let emitter = app.clone();
    let emit: Emit = Box::new(move |event, payload| {
        let _ = emitter.emit(event, payload);
    });
    let local = Local::new(dir, app.path().download_dir().ok(), emit)?;
    *slot = Some(local.clone());
    let started = local.clone();
    tauri::async_runtime::spawn(async move {
        match started.clone().serve().await {
            Ok(_) => {
                discovery::run(started.clone());
                link::run(started.clone());
            }
            Err(e) => eprintln!("local share: server didn't start: {e}"),
        }
    });
    Ok(local)
}

impl Local {
    pub fn new(dir: PathBuf, downloads: Option<PathBuf>, emit: Emit) -> Result<Arc<Local>, String> {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let id = Identity::load_or_create(&dir)?;
        let me = std::fs::read_to_string(dir.join("me.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Me {
            alias: "Tools device".into(),
            device_model: None,
            device_type: if cfg!(any(target_os = "android", target_os = "ios")) { "mobile" } else { "desktop" }.into(),
        });
        Ok(Arc::new(Local {
            emit,
            downloads,
            server_tls: tls::server_config(&id)?,
            client_tls: tls::client_config(&id)?,
            id,
            me: RwLock::new(me),
            port: RwLock::new(DEFAULT_PORT),
            peers: RwLock::new(HashMap::new()),
            store: Mutex::new(Store::load(&dir)),
            asks: Mutex::new(HashMap::new()),
            incoming: tokio::sync::Mutex::new(HashMap::new()),
            outgoing: tokio::sync::Mutex::new(HashMap::new()),
            pairing: Mutex::new(HashMap::new()),
            links: Mutex::new(HashMap::new()),
            web: web::WebState::default(),
            dir,
        }))
    }

    /// Start the HTTPS server; returns its port.
    pub async fn serve(self: Arc<Self>) -> Result<u16, String> {
        let port = server::serve(self.clone()).await?;
        *self.port.write().unwrap() = port;
        Ok(port)
    }
}

impl Local {
    pub fn save_me(&self) {
        let me = self.me.read().unwrap().clone();
        let _ = std::fs::write(self.dir.join("me.json"), serde_json::to_string(&me).unwrap());
    }
}
