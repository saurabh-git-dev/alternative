//! The HTTPS server other devices call: LocalSend's API (register, info,
//! prepare-upload, upload, cancel) plus this app's pairing and chat link.
//! Port 53317 like LocalSend, or any free port if that's taken (announced, so
//! others still find it).

use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use http_body_util::BodyExt;
use hyper::{body::Incoming as HyperBody, service::service_fn, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::{io::AsyncWriteExt, net::TcpListener};
use tokio_rustls::TlsAcceptor;

use super::{client::{self, Body}, identity::fingerprint, link, pair, rand_id, types::*, Local};

/// A batch of files on its way in.
pub struct Incoming {
    pub fingerprint: String,
    pub alias: String,
    pub ip: String,
    /// Accepted files and their upload tokens, by file id.
    pub files: HashMap<String, (FileMeta, String)>,
    pub finished: HashSet<String>,
    pub saved: Vec<SavedFile>,
    pub total: u64,
    pub received: Arc<AtomicU64>,
}

/// Who is calling: their address, and their certificate's fingerprint if they sent one (this app does, LocalSend doesn't).
#[derive(Clone)]
pub struct Caller {
    pub ip: String,
    pub fingerprint: Option<String>,
}

pub async fn serve(local: Arc<Local>) -> Result<u16, String> {
    let listener = match TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], DEFAULT_PORT))).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0))).await.map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let acceptor = TlsAcceptor::from(local.server_tls.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((tcp, addr)) = listener.accept().await else { continue };
            let acceptor = acceptor.clone();
            let local = local.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(Ok(tls)) = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(tcp)).await else { return };
                let caller = Caller {
                    ip: match addr.ip() {
                        std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped().map(|v4| v4.to_string()).unwrap_or(v6.to_string()),
                        ip => ip.to_string(),
                    },
                    fingerprint: tls.get_ref().1.peer_certificates().and_then(|c| c.first()).map(|c| fingerprint(c)),
                };
                let service = service_fn(move |req| {
                    let local = local.clone();
                    let caller = caller.clone();
                    async move { Ok::<_, std::convert::Infallible>(route(local, caller, req).await) }
                });
                let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(tls), service).with_upgrades().await;
            });
        }
    });
    Ok(port)
}

pub fn status(code: StatusCode) -> Response<Body> {
    let mut res = Response::new(client::empty());
    *res.status_mut() = code;
    res
}

pub fn json(value: &impl serde::Serialize) -> Response<Body> {
    let mut res = Response::new(client::full(serde_json::to_vec(value).unwrap()));
    res.headers_mut().insert("content-type", "application/json".parse().unwrap());
    res
}

pub async fn read_json<T: serde::de::DeserializeOwned>(req: Request<HyperBody>) -> Option<T> {
    let body = http_body_util::Limited::new(req.into_body(), 4 * 1024 * 1024).collect().await.ok()?.to_bytes();
    serde_json::from_slice(&body).ok()
}

fn query(req: &Request<HyperBody>) -> HashMap<String, String> {
    req.uri()
        .query()
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

async fn route(local: Arc<Local>, caller: Caller, req: Request<HyperBody>) -> Response<Body> {
    let path = req.uri().path().to_string();
    match (req.method(), path.as_str()) {
        (&Method::POST, "/api/localsend/v2/register") | (&Method::POST, "/api/localsend/v1/register") => {
            let https = true;
            if let Some(info) = read_json::<Info>(req).await {
                let fingerprint = caller.fingerprint.clone().unwrap_or(info.fingerprint.clone());
                let port = info.port.unwrap_or(DEFAULT_PORT);
                local.saw(Info { fingerprint, ..info }, caller.ip.clone(), port, https);
            }
            json(&local.info(None))
        }
        (&Method::GET, "/api/localsend/v2/info") | (&Method::GET, "/api/localsend/v1/info") => json(&local.info(None)),
        (&Method::POST, "/api/localsend/v2/prepare-upload") => prepare_upload(local, caller, req).await,
        (&Method::POST, "/api/localsend/v2/upload") => upload(local, caller, req).await,
        (&Method::POST, "/api/localsend/v2/cancel") => {
            let q = query(&req);
            if let Some(id) = q.get("sessionId") {
                if local.incoming.lock().await.remove(id).is_some() {
                    local.emit("local://cancelled", serde_json::json!({ "session": id }));
                }
            }
            status(StatusCode::OK)
        }
        (&Method::POST, p) if p.starts_with("/api/tools/v1/pair/") => pair::handle(local, caller, req).await,
        (&Method::GET, "/api/tools/v1/link") => link::accept(local, caller, req),
        _ => status(StatusCode::NOT_FOUND),
    }
}

async fn prepare_upload(local: Arc<Local>, caller: Caller, req: Request<HyperBody>) -> Response<Body> {
    let Some(body) = read_json::<PrepareUpload>(req).await else { return status(StatusCode::BAD_REQUEST) };
    let fingerprint = caller.fingerprint.clone().unwrap_or(body.info.fingerprint.clone());
    let paired = caller.fingerprint.as_deref().map(|f| local.store.lock().unwrap().is_paired(f)).unwrap_or(false);
    let port = body.info.port.unwrap_or(DEFAULT_PORT);
    let https = body.info.protocol.as_deref() != Some("http");
    local.saw(Info { fingerprint: fingerprint.clone(), ..body.info.clone() }, caller.ip.clone(), port, https);
    if body.files.is_empty() {
        return status(StatusCode::NO_CONTENT);
    }
    let total: u64 = body.files.values().map(|f| f.size).sum();
    let huge = total > HUGE_BYTES;
    let files: Vec<_> = body.files.values().map(|f| serde_json::json!({ "name": f.file_name, "size": f.size, "type": f.file_type })).collect();
    // Paired devices' files come straight in, except very big batches; anyone else is asked about.
    if !paired || huge {
        let question = serde_json::json!({
            "kind": "files",
            "fingerprint": fingerprint,
            "alias": body.info.alias,
            "ours": body.info.tools.is_some(),
            "paired": paired,
            "files": files,
            "total": total,
            "huge": huge,
        });
        if !local.ask("local://ask", question, Duration::from_secs(120)).await {
            return status(StatusCode::FORBIDDEN);
        }
    }
    let session = rand_id();
    let mut tokens = HashMap::new();
    let mut accepted = HashMap::new();
    for (id, meta) in body.files {
        let token = rand_id();
        tokens.insert(id.clone(), token.clone());
        accepted.insert(id, (meta, token));
    }
    local.incoming.lock().await.insert(
        session.clone(),
        Incoming {
            fingerprint: fingerprint.clone(),
            alias: body.info.alias.clone(),
            ip: caller.ip.clone(),
            files: accepted,
            finished: HashSet::new(),
            saved: Vec::new(),
            total,
            received: Arc::new(AtomicU64::new(0)),
        },
    );
    local.emit("local://incoming", serde_json::json!({ "session": session, "fingerprint": fingerprint, "alias": body.info.alias, "files": files, "total": total }));
    json(&PrepareResponse { session_id: session, files: tokens })
}

/// A file name that is safe to create in the downloads folder.
fn clean_name(name: &str) -> String {
    let base: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c }).collect();
    let base = base.trim().trim_start_matches('.').to_string();
    if base.is_empty() { "file".into() } else { base }
}

/// `dir/name`, or `dir/name (2).ext` if that exists.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

async fn upload(local: Arc<Local>, caller: Caller, req: Request<HyperBody>) -> Response<Body> {
    let q = query(&req);
    let (Some(session), Some(file_id), Some(token)) = (q.get("sessionId"), q.get("fileId"), q.get("token")) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let (meta, fingerprint, alias, total, received) = {
        let incoming = local.incoming.lock().await;
        let Some(inc) = incoming.get(session) else { return status(StatusCode::FORBIDDEN) };
        let Some((meta, expected)) = inc.files.get(file_id) else { return status(StatusCode::FORBIDDEN) };
        if expected != token || inc.ip != caller.ip {
            return status(StatusCode::FORBIDDEN);
        }
        (meta.clone(), inc.fingerprint.clone(), inc.alias.clone(), inc.total, inc.received.clone())
    };
    let dir = local.download_dir();
    let path = unique_path(&dir, &clean_name(&meta.file_name));
    let part = path.with_extension(format!("{}part", path.extension().map(|e| format!("{}.", e.to_string_lossy())).unwrap_or_default()));
    let Ok(mut file) = tokio::fs::File::create(&part).await else { return status(StatusCode::INTERNAL_SERVER_ERROR) };
    let mut body = req.into_body();
    let mut written = 0u64;
    let mut last_report = 0u64;
    let ok = loop {
        match body.frame().await {
            Some(Ok(frame)) => {
                if let Ok(data) = frame.into_data() {
                    if file.write_all(&data).await.is_err() {
                        break false;
                    }
                    written += data.len() as u64;
                    let done = received.fetch_add(data.len() as u64, Ordering::Relaxed) + data.len() as u64;
                    let now = now_ms();
                    if now - last_report > 200 {
                        last_report = now;
                        local.emit("local://progress", serde_json::json!({ "session": session, "fingerprint": fingerprint, "done": done, "total": total, "file": meta.file_name }));
                    }
                    if written > meta.size {
                        break false;
                    }
                }
            }
            Some(Err(_)) => break false,
            None => break written == meta.size,
        }
    };
    let _ = file.flush().await;
    drop(file);
    if !ok || !local.incoming.lock().await.contains_key(session) {
        let _ = tokio::fs::remove_file(&part).await;
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let _ = tokio::fs::rename(&part, &path).await;
    let mut incoming = local.incoming.lock().await;
    let Some(inc) = incoming.get_mut(session) else { return status(StatusCode::OK) };
    inc.finished.insert(file_id.clone());
    inc.saved.push(SavedFile { name: meta.file_name.clone(), path: path.to_string_lossy().into(), size: meta.size, file_type: meta.file_type.clone() });
    if inc.finished.len() == inc.files.len() {
        let inc = incoming.remove(session).unwrap();
        local.emit("local://received", serde_json::json!({ "session": session, "fingerprint": inc.fingerprint, "alias": alias, "files": inc.saved }));
    } else {
        local.emit("local://progress", serde_json::json!({ "session": session, "fingerprint": fingerprint, "done": received.load(Ordering::Relaxed), "total": total, "file": meta.file_name }));
    }
    status(StatusCode::OK)
}

