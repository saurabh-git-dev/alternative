//! The lasting link between two paired copies of this app, for chat messages
//! and call signalling (files go through LocalSend's upload API, which these
//! devices also speak). It is a TLS connection where both sides presented the
//! certificate they paired with, upgraded from `GET /api/tools/v1/link`, then
//! carrying frames of `[u32 length][JSON]`; an empty frame is a keep-alive.
//! The device with the smaller fingerprint dials, so the two never race, and
//! keeps redialling while the link is down.

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use hyper::{body::Incoming as HyperBody, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::mpsc,
};

use super::{client, server::Caller, Local};
use crate::local::client::Body;

const PING_EVERY: Duration = Duration::from_secs(15);
const SILENT_FOR: Duration = Duration::from_secs(45);
const MAX_FRAME: u32 = 1024 * 1024;

static NEXT: AtomicU64 = AtomicU64::new(1);
static DIALING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Whether this device is the one that dials `theirs`.
fn i_dial(local: &Local, theirs: &str) -> bool {
    local.id.fingerprint.as_str() < theirs
}

/// Server side: a paired device asking to open the link.
pub fn accept(local: Arc<Local>, caller: Caller, req: Request<HyperBody>) -> Response<Body> {
    let Some(theirs) = caller.fingerprint.filter(|f| local.store.lock().unwrap().is_paired(f)) else {
        return super::server::status(StatusCode::FORBIDDEN);
    };
    tauri::async_runtime::spawn(async move {
        if let Ok(upgraded) = hyper::upgrade::on(req).await {
            run_link(local, theirs, TokioIo::new(upgraded)).await;
        }
    });
    let mut res = super::server::status(StatusCode::SWITCHING_PROTOCOLS);
    res.headers_mut().insert("connection", "upgrade".parse().unwrap());
    res.headers_mut().insert("upgrade", "tools-link".parse().unwrap());
    res
}

async fn dial(local: Arc<Local>, theirs: String) -> Result<(), String> {
    let (ip, port, _) = local.address(&theirs).ok_or("unknown address")?;
    let mut tls = client::connect(&local.client_tls, &ip, port, Some(&theirs)).await?;
    let head = format!("GET /api/tools/v1/link HTTP/1.1\r\nHost: {ip}:{port}\r\nConnection: Upgrade\r\nUpgrade: tools-link\r\n\r\n");
    tls.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;
    // Read the response head byte by byte, so nothing after it is lost.
    let mut seen = Vec::new();
    while !seen.ends_with(b"\r\n\r\n") {
        let mut byte = [0u8; 1];
        let n = tokio::time::timeout(Duration::from_secs(5), tls.read(&mut byte)).await.map_err(|_| "no answer")?.map_err(|e| e.to_string())?;
        if n == 0 || seen.len() > 8192 {
            return Err("closed".into());
        }
        seen.push(byte[0]);
    }
    if !seen.starts_with(b"HTTP/1.1 101") {
        return Err("refused".into());
    }
    run_link(local, theirs, tls).await;
    Ok(())
}

/// Try to open the link to a paired device now (if this side is the dialer).
pub fn dial_soon(local: Arc<Local>, theirs: String) {
    if !i_dial(&local, &theirs) || local.links.lock().unwrap().contains_key(&theirs) {
        return;
    }
    {
        let mut dialing = DIALING.lock().unwrap();
        let set = dialing.get_or_insert_with(HashSet::new);
        if !set.insert(theirs.clone()) {
            return;
        }
    }
    tauri::async_runtime::spawn(async move {
        let _ = dial(local, theirs.clone()).await;
        if let Some(set) = DIALING.lock().unwrap().as_mut() {
            set.remove(&theirs);
        }
    });
}

/// Keep links to paired devices open.
pub fn run(local: Arc<Local>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let paired: Vec<String> = local.store.lock().unwrap().devices.iter().map(|d| d.fingerprint.clone()).collect();
            for theirs in paired {
                dial_soon(local.clone(), theirs);
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

/// Send a JSON message over the link; false if it isn't open.
pub fn send(local: &Local, theirs: &str, data: &serde_json::Value) -> bool {
    let bytes = serde_json::to_vec(data).unwrap();
    local.links.lock().unwrap().get(theirs).map(|(_, tx)| tx.send(bytes).is_ok()).unwrap_or(false)
}

/// Close the link to a device (e.g. after forgetting it).
pub fn close(local: &Local, theirs: &str) {
    local.links.lock().unwrap().remove(theirs);
}

async fn run_link<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(local: Arc<Local>, theirs: String, stream: S) {
    let (mut reader, mut writer) = tokio::io::split(stream);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let generation = NEXT.fetch_add(1, Ordering::Relaxed);
    // The map holds the only sender, so removing it (or replacing it) stops the writer.
    local.links.lock().unwrap().insert(theirs.clone(), (generation, tx));
    local.emit("local://link-state", serde_json::json!({ "fingerprint": theirs, "up": true }));
    local.emit_devices();

    let write = tauri::async_runtime::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        loop {
            let frame = tokio::select! {
                frame = rx.recv() => match frame { Some(f) => f, None => break },
                _ = ping.tick() => Vec::new(),
            };
            let len = (frame.len() as u32).to_be_bytes();
            if writer.write_all(&len).await.is_err() || writer.write_all(&frame).await.is_err() || writer.flush().await.is_err() {
                break;
            }
        }
        let _ = writer.shutdown().await;
    });

    loop {
        let mut len = [0u8; 4];
        match tokio::time::timeout(SILENT_FOR, reader.read_exact(&mut len)).await {
            Ok(Ok(_)) => {}
            _ => break,
        }
        let len = u32::from_be_bytes(len);
        if len == 0 {
            continue;
        }
        if len > MAX_FRAME {
            break;
        }
        let mut buf = vec![0u8; len as usize];
        if reader.read_exact(&mut buf).await.is_err() {
            break;
        }
        if let Ok(data) = serde_json::from_slice::<serde_json::Value>(&buf) {
            local.emit("local://link", serde_json::json!({ "fingerprint": theirs, "data": data }));
        }
        // A newer link to the same device replaced this one.
        if local.links.lock().unwrap().get(&theirs).map(|(g, _)| *g) != Some(generation) {
            break;
        }
    }
    write.abort();
    let removed = {
        let mut links = local.links.lock().unwrap();
        if links.get(&theirs).map(|(g, _)| *g) == Some(generation) {
            links.remove(&theirs);
            true
        } else {
            false
        }
    };
    if removed {
        local.emit("local://link-state", serde_json::json!({ "fingerprint": theirs, "up": false }));
        local.emit_devices();
    }
}
