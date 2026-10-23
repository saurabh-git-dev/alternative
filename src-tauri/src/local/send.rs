//! Sending files to a device with LocalSend's upload API. The page streams
//! each file in as chunks (`local_send_chunk`), which go straight into that
//! file's upload request, so memory stays flat at any size.

use std::{collections::HashMap, sync::Arc, time::Duration};

use bytes::Bytes;
use http_body_util::{BodyExt, StreamBody};
use hyper::{body::Frame, Request, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;

use super::{client, rand_id, types::*, Local};

type Chunk = Result<Frame<Bytes>, std::io::Error>;

pub struct Outgoing {
    ip: String,
    port: u16,
    expect: Option<String>,
    session: String,
    tokens: HashMap<String, String>,
    sizes: HashMap<String, u64>,
    current: Option<Upload>,
}

struct Upload {
    file: String,
    tx: mpsc::Sender<Chunk>,
    done: JoinHandle<Result<StatusCode, String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub transfer: String,
    /// File ids the receiver wants (LocalSend lets it pick); empty if it needs none.
    pub accepted: Vec<String>,
}

/// Announce the files and wait for the other device to accept. Errors are
/// codes the page explains: `pin` (it wants a PIN), `rejected`, `busy`, `offline`.
pub async fn start(local: Arc<Local>, fingerprint: String, files: Vec<FileMeta>, pin: Option<String>) -> Result<Started, String> {
    let (ip, port, https) = local.address(&fingerprint).ok_or("offline")?;
    if !https {
        return Err("http-only".into());
    }
    let ours = local.peers.read().unwrap().get(&fingerprint).map(|p| p.info.tools.is_some()).unwrap_or(true);
    // Copies of this app are held to their fingerprint; LocalSend's isn't comparable, so anyone answering there is accepted.
    let expect = ours.then(|| fingerprint.clone());
    let body = PrepareUpload { info: local.info(None), files: files.iter().map(|f| (f.id.clone(), f.clone())).collect() };
    let path = match &pin {
        Some(pin) => format!("/api/localsend/v2/prepare-upload?pin={pin}"),
        None => "/api/localsend/v2/prepare-upload".to_string(),
    };
    let (status, bytes) = client::post_json(&local.client_tls, &ip, port, expect.as_deref(), &path, &body, Duration::from_secs(150))
        .await
        .map_err(|e| if e == "offline" || e == "no answer" { e } else { format!("failed: {e}") })?;
    match status {
        StatusCode::NO_CONTENT => return Ok(Started { transfer: String::new(), accepted: vec![] }),
        StatusCode::UNAUTHORIZED => return Err("pin".into()),
        StatusCode::FORBIDDEN => return Err("rejected".into()),
        StatusCode::CONFLICT | StatusCode::TOO_MANY_REQUESTS => return Err("busy".into()),
        s if !s.is_success() => return Err(format!("failed: the other device answered {s}")),
        _ => {}
    }
    let answer: PrepareResponse = serde_json::from_slice(&bytes).map_err(|_| "failed: unexpected answer".to_string())?;
    let transfer = rand_id();
    let accepted: Vec<String> = answer.files.keys().cloned().collect();
    local.outgoing.lock().await.insert(
        transfer.clone(),
        Outgoing {
            ip,
            port,
            expect,
            session: answer.session_id,
            tokens: answer.files,
            sizes: files.iter().map(|f| (f.id.clone(), f.size)).collect(),
            current: None,
        },
    );
    Ok(Started { transfer, accepted })
}

fn open(local: &Local, out: &Outgoing, file: &str) -> Result<Upload, String> {
    let token = out.tokens.get(file).ok_or("not accepted")?;
    let size = *out.sizes.get(file).unwrap_or(&0);
    let path = format!("/api/localsend/v2/upload?sessionId={}&fileId={}&token={}", out.session, file, token);
    let (tx, rx) = mpsc::channel::<Chunk>(4);
    let stream = futures_util::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) });
    let body: client::Body = StreamBody::new(stream).boxed();
    let config = local.client_tls.clone();
    let (ip, port, expect) = (out.ip.clone(), out.port, out.expect.clone());
    let done = tauri::async_runtime::spawn(async move {
        let tls = client::connect(&config, &ip, port, expect.as_deref()).await?;
        let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls)).await.map_err(|e| e.to_string())?;
        tokio::spawn(conn);
        let req = Request::post(path)
            .header("host", format!("{ip}:{port}"))
            .header("content-type", "application/octet-stream")
            .header("content-length", size.to_string())
            .body(body)
            .map_err(|e| e.to_string())?;
        let res = sender.send_request(req).await.map_err(|e| e.to_string())?;
        Ok(res.status())
    });
    Ok(Upload { file: file.to_string(), tx, done })
}

/// The next piece of a file. `last` closes the file and waits for the receiver to confirm it.
pub async fn chunk(local: Arc<Local>, transfer: &str, file: &str, bytes: Vec<u8>, last: bool) -> Result<(), String> {
    let tx = {
        let mut outgoing = local.outgoing.lock().await;
        let out = outgoing.get_mut(transfer).ok_or("cancelled")?;
        if out.current.as_ref().map(|u| u.file != file).unwrap_or(true) {
            let upload = open(&local, out, file)?;
            out.current = Some(upload);
        }
        out.current.as_ref().unwrap().tx.clone()
    };
    if !bytes.is_empty() && tx.send(Ok(Frame::data(Bytes::from(bytes)))).await.is_err() {
        return Err("the connection dropped".into());
    }
    drop(tx);
    if last {
        let upload = {
            let mut outgoing = local.outgoing.lock().await;
            outgoing.get_mut(transfer).and_then(|o| o.current.take())
        };
        if let Some(Upload { tx, done, .. }) = upload {
            drop(tx);
            match done.await {
                Ok(Ok(s)) if s.is_success() => {}
                Ok(Ok(s)) => return Err(format!("the other device answered {s}")),
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    Ok(())
}

/// All files sent (or given up on): forget the transfer, telling the receiver if it was cut short.
pub async fn finish(local: Arc<Local>, transfer: &str, cancelled: bool) {
    let Some(out) = local.outgoing.lock().await.remove(transfer) else { return };
    if let Some(upload) = out.current {
        upload.done.abort();
    }
    if cancelled {
        let path = format!("/api/localsend/v2/cancel?sessionId={}", out.session);
        let _ = client::request(&local.client_tls, &out.ip, out.port, out.expect.as_deref(), &path, client::empty(), Duration::from_secs(4)).await;
    }
}
