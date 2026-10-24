//! App to browser (A2B): while switched on, the app serves a small page on
//! the local network (plain HTTP, port 53318 or any free one). A phone or
//! computer with no app opens it from a QR code, sends files to the app
//! (the app's owner accepts them), and downloads the files the app offers.
//! Every request carries the session's random key (`k`), so only someone
//! who saw the code gets in; switching off or on again makes a new key.

use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use bytes::Bytes;
use http_body_util::{BodyExt, StreamBody};
use hyper::{body::{Frame, Incoming as HyperBody}, service::service_fn, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

use super::{
    client::{self, Body},
    discovery::local_ipv4s,
    files::guess_type,
    rand_id,
    server::{clean_name, json, query, read_json, status, unique_path},
    types::HUGE_BYTES,
    Local,
};

pub const WEB_PORT: u16 = 53318;

/// A file the app offers to browsers.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Offered {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub file_type: String,
    #[serde(skip)]
    pub path: PathBuf,
    /// Still being copied in from the page.
    #[serde(skip)]
    pub ready: bool,
}

/// A batch a browser was allowed to send: file index → (name, size).
struct Batch {
    ip: String,
    files: HashMap<usize, (String, u64)>,
}

pub struct Session {
    pub key: String,
    pub port: u16,
    pub offered: Vec<Offered>,
    batches: HashMap<String, Batch>,
    /// Browsers (by address) whose first batch was accepted: later ones under 1 GB go straight in.
    trusted: HashSet<String>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(Default)]
pub struct WebState(pub Mutex<Option<Session>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub key: String,
    pub port: u16,
    /// `http://<address>:<port>/?k=<key>` for each local network address.
    pub urls: Vec<String>,
}

fn offered_dir(local: &Local) -> PathBuf {
    local.dir.join("offered")
}

fn urls(key: &str, port: u16) -> Vec<String> {
    local_ipv4s().into_iter().map(|ip| format!("http://{ip}:{port}/?k={key}")).collect()
}

/// Switch the page on (or return the running one).
pub async fn start(local: Arc<Local>) -> Result<Started, String> {
    if let Some(s) = local.web.0.lock().unwrap().as_ref() {
        return Ok(Started { key: s.key.clone(), port: s.port, urls: urls(&s.key, s.port) });
    }
    let listener = match TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], WEB_PORT))).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], 0))).await.map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let key = rand_id();
    let (stop, mut stopped) = tokio::sync::oneshot::channel();
    let _ = std::fs::remove_dir_all(offered_dir(&local));
    *local.web.0.lock().unwrap() = Some(Session { key: key.clone(), port, offered: vec![], batches: HashMap::new(), trusted: HashSet::new(), stop: Some(stop) });
    let server = local.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = &mut stopped => break,
                a = listener.accept() => a,
            };
            let Ok((tcp, addr)) = accepted else { continue };
            let local = server.clone();
            let ip = match addr.ip() {
                std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped().map(|v4| v4.to_string()).unwrap_or(v6.to_string()),
                ip => ip.to_string(),
            };
            tauri::async_runtime::spawn(async move {
                let service = service_fn(move |req| {
                    let local = local.clone();
                    let ip = ip.clone();
                    async move { Ok::<_, std::convert::Infallible>(route(local, ip, req).await) }
                });
                let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(tcp), service).await;
            });
        }
    });
    Ok(Started { urls: urls(&key, port), key, port })
}

pub fn stop(local: &Local) {
    if let Some(mut s) = local.web.0.lock().unwrap().take() {
        if let Some(stop) = s.stop.take() {
            let _ = stop.send(());
        }
    }
    let _ = std::fs::remove_dir_all(offered_dir(local));
}

/// Start offering a file from the page; its bytes follow with `offer_chunk`.
pub fn offer(local: &Local, name: &str, size: u64) -> Result<String, String> {
    let dir = offered_dir(local);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = rand_id();
    let path = dir.join(&id);
    std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut web = local.web.0.lock().unwrap();
    let s = web.as_mut().ok_or("not sharing")?;
    let name = clean_name(name);
    s.offered.push(Offered { id: id.clone(), file_type: guess_type(&name).into(), name, size, path, ready: size == 0 });
    Ok(id)
}

pub async fn offer_chunk(local: &Local, id: &str, bytes: &[u8], last: bool) -> Result<(), String> {
    let path = {
        let web = local.web.0.lock().unwrap();
        let s = web.as_ref().ok_or("not sharing")?;
        s.offered.iter().find(|o| o.id == id).ok_or("no such file")?.path.clone()
    };
    let mut file = tokio::fs::OpenOptions::new().append(true).open(&path).await.map_err(|e| e.to_string())?;
    file.write_all(bytes).await.map_err(|e| e.to_string())?;
    if last {
        if let Some(o) = local.web.0.lock().unwrap().as_mut().and_then(|s| s.offered.iter_mut().find(|o| o.id == id)) {
            o.ready = true;
        }
    }
    Ok(())
}

pub fn unoffer(local: &Local, id: &str) {
    if let Some(s) = local.web.0.lock().unwrap().as_mut() {
        if let Some(i) = s.offered.iter().position(|o| o.id == id) {
            let _ = std::fs::remove_file(&s.offered.remove(i).path);
        }
    }
}

pub fn offered(local: &Local) -> Vec<Offered> {
    local.web.0.lock().unwrap().as_ref().map(|s| s.offered.clone()).unwrap_or_default()
}

#[derive(Deserialize)]
struct PrepareFile {
    name: String,
    size: u64,
    #[serde(default, rename = "type")]
    file_type: String,
}

#[derive(Deserialize)]
struct Prepare {
    files: Vec<PrepareFile>,
}

fn key_ok(local: &Local, req: &Request<HyperBody>) -> bool {
    let q = query(req);
    let web = local.web.0.lock().unwrap();
    matches!((web.as_ref(), q.get("k")), (Some(s), Some(k)) if *k == s.key)
}

async fn route(local: Arc<Local>, ip: String, req: Request<HyperBody>) -> Response<Body> {
    if !key_ok(&local, &req) {
        let mut res = html(NO_KEY);
        *res.status_mut() = StatusCode::FORBIDDEN;
        return res;
    }
    let path = req.uri().path().to_string();
    match (req.method(), path.as_str()) {
        (&Method::GET, "/") => html(&PAGE.replace("{{ALIAS}}", &escape(&local.me.read().unwrap().alias))),
        (&Method::GET, "/api/files") => {
            let ready: Vec<Offered> = offered(&local).into_iter().filter(|o| o.ready).collect();
            json(&serde_json::json!({ "alias": local.me.read().unwrap().alias, "files": ready }))
        }
        (&Method::GET, p) if p.starts_with("/api/file/") => download(&local, &p["/api/file/".len()..]).await,
        (&Method::POST, "/api/prepare") => prepare(local, ip, req).await,
        (&Method::POST, "/api/upload") => upload(local, ip, req).await,
        _ => status(StatusCode::NOT_FOUND),
    }
}

fn html(body: &str) -> Response<Body> {
    let mut res = Response::new(client::full(body.to_string()));
    res.headers_mut().insert("content-type", "text/html; charset=utf-8".parse().unwrap());
    res.headers_mut().insert("cache-control", "no-store".parse().unwrap());
    res
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

async fn download(local: &Local, id: &str) -> Response<Body> {
    let Some(o) = offered(local).into_iter().find(|o| o.id == id && o.ready) else { return status(StatusCode::NOT_FOUND) };
    let Ok(file) = tokio::fs::File::open(&o.path).await else { return status(StatusCode::NOT_FOUND) };
    let stream = futures_util::stream::unfold(file, |mut file| async move {
        let mut buf = vec![0u8; 256 * 1024];
        match file.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Frame::data(Bytes::from(buf))), file))
            }
            Err(e) => Some((Err(e), file)),
        }
    });
    let mut res = Response::new(StreamBody::new(stream).boxed());
    let headers = res.headers_mut();
    headers.insert("content-type", o.file_type.parse().unwrap_or("application/octet-stream".parse().unwrap()));
    headers.insert("content-length", o.size.into());
    // RFC 5987 so any name survives.
    let encoded: String = o.name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    if let Ok(v) = format!("attachment; filename*=UTF-8''{encoded}").parse() {
        headers.insert("content-disposition", v);
    }
    res
}

async fn prepare(local: Arc<Local>, ip: String, req: Request<HyperBody>) -> Response<Body> {
    let Some(body) = read_json::<Prepare>(req).await else { return status(StatusCode::BAD_REQUEST) };
    if body.files.is_empty() || body.files.len() > 1000 {
        return status(StatusCode::BAD_REQUEST);
    }
    let total: u64 = body.files.iter().map(|f| f.size).sum();
    let huge = total > HUGE_BYTES;
    let trusted = local.web.0.lock().unwrap().as_ref().is_some_and(|s| s.trusted.contains(&ip));
    if huge || !trusted {
        let files: Vec<_> = body
            .files
            .iter()
            .map(|f| serde_json::json!({ "name": f.name, "size": f.size, "type": if f.file_type.is_empty() { guess_type(&f.name) } else { f.file_type.as_str() } }))
            .collect();
        let payload = serde_json::json!({
            "fingerprint": format!("web:{ip}"),
            "alias": format!("A browser at {ip}"),
            "ours": false,
            "paired": false,
            "files": files,
            "total": total,
            "huge": huge,
        });
        if !local.ask("local://ask", payload, Duration::from_secs(120)).await {
            return status(StatusCode::FORBIDDEN);
        }
    }
    let id = rand_id();
    let mut web = local.web.0.lock().unwrap();
    let Some(s) = web.as_mut() else { return status(StatusCode::FORBIDDEN) };
    s.trusted.insert(ip.clone());
    s.batches.insert(id.clone(), Batch { ip, files: body.files.into_iter().enumerate().map(|(i, f)| (i, (f.name, f.size))).collect() });
    json(&serde_json::json!({ "batch": id }))
}

async fn upload(local: Arc<Local>, ip: String, req: Request<HyperBody>) -> Response<Body> {
    let q = query(&req);
    let (Some(batch), Some(index)) = (q.get("batch").cloned(), q.get("file").and_then(|f| f.parse::<usize>().ok())) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let (name, size) = {
        let mut web = local.web.0.lock().unwrap();
        let Some(b) = web.as_mut().and_then(|s| s.batches.get_mut(&batch)) else { return status(StatusCode::FORBIDDEN) };
        if b.ip != ip {
            return status(StatusCode::FORBIDDEN);
        }
        let Some(file) = b.files.remove(&index) else { return status(StatusCode::FORBIDDEN) };
        file
    };
    let dir = local.download_dir();
    let path = unique_path(&dir, &clean_name(&name));
    let part = PathBuf::from(format!("{}.part", path.to_string_lossy()));
    let Ok(mut file) = tokio::fs::File::create(&part).await else { return status(StatusCode::INTERNAL_SERVER_ERROR) };
    let mut body = req.into_body();
    let mut written = 0u64;
    let ok = loop {
        match body.frame().await {
            Some(Ok(frame)) => {
                if let Ok(data) = frame.into_data() {
                    written += data.len() as u64;
                    if written > size || file.write_all(&data).await.is_err() {
                        break false;
                    }
                }
            }
            Some(Err(_)) => break false,
            None => break written == size,
        }
    };
    let _ = file.flush().await;
    drop(file);
    if !ok {
        let _ = tokio::fs::remove_file(&part).await;
        return status(StatusCode::BAD_REQUEST);
    }
    let _ = tokio::fs::rename(&part, &path).await;
    local.emit(
        "local://web-received",
        serde_json::json!({ "ip": ip, "name": name, "path": path.to_string_lossy(), "size": size, "fileType": guess_type(&name) }),
    );
    status(StatusCode::OK)
}

const NO_KEY: &str = r#"<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tools</title>
<body style="font:16px system-ui;margin:40px auto;max-width:420px;padding:0 16px">
<h1>Link expired</h1><p>Scan the code in the Tools app again: it changes each time sharing is switched on.</p></body>"#;

const PAGE: &str = include_str!("web-page.html");

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn browser_sends_and_downloads() {
        let root = std::env::temp_dir().join(format!("tools-web-{}", rand_id()));
        let asked = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let seen = asked.clone();
        let local = Local::new(root.join("local"), Some(root.join("Downloads")), Box::new(move |event, payload| {
            if event == "local://ask" {
                seen.lock().unwrap().push(payload);
            }
        }))
        .unwrap();
        // Accept every question as it comes.
        let answerer = local.clone();
        tokio::spawn(async move {
            loop {
                let ids: Vec<String> = answerer.asks.lock().unwrap().keys().cloned().collect();
                for id in ids {
                    if let Some(tx) = answerer.asks.lock().unwrap().remove(&id) {
                        let _ = tx.send(true);
                    }
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        let started = start(local.clone()).await.unwrap();
        let base = format!("http://127.0.0.1:{}", started.port);
        let k = started.key.clone();

        let get = |url: String| async move {
            let stream = tokio::net::TcpStream::connect(url.trim_start_matches("http://").split('/').next().unwrap()).await.unwrap();
            let (mut send, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.unwrap();
            tokio::spawn(conn);
            (send.send_request(Request::get(&url).body(client::empty()).unwrap()).await.unwrap(), ())
        };
        let post = |url: String, body: Vec<u8>| async move {
            let stream = tokio::net::TcpStream::connect(url.trim_start_matches("http://").split('/').next().unwrap()).await.unwrap();
            let (mut send, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.unwrap();
            tokio::spawn(conn);
            send.send_request(Request::post(&url).body(client::full(body)).unwrap()).await.unwrap()
        };

        // Without the key: nothing.
        assert_eq!(get(format!("{base}/")).await.0.status(), StatusCode::FORBIDDEN);
        assert_eq!(get(format!("{base}/?k={k}")).await.0.status(), StatusCode::OK);

        // Browser → app: asked once, then saved.
        let res = post(format!("{base}/api/prepare?k={k}"), br#"{"files":[{"name":"hello.txt","size":5}]}"#.to_vec()).await;
        assert_eq!(res.status(), StatusCode::OK);
        let batch: serde_json::Value = serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let batch = batch["batch"].as_str().unwrap().to_string();
        assert_eq!(post(format!("{base}/api/upload?k={k}&batch={batch}&file=0"), b"hello".to_vec()).await.status(), StatusCode::OK);
        assert_eq!(std::fs::read(local.download_dir().join("hello.txt")).unwrap(), b"hello");
        assert_eq!(asked.lock().unwrap().len(), 1);
        // The same file id can't be uploaded twice.
        assert_eq!(post(format!("{base}/api/upload?k={k}&batch={batch}&file=0"), b"hello".to_vec()).await.status(), StatusCode::FORBIDDEN);
        // A second batch from the same browser goes straight in.
        let res = post(format!("{base}/api/prepare?k={k}"), br#"{"files":[{"name":"two.txt","size":3}]}"#.to_vec()).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(asked.lock().unwrap().len(), 1);

        // App → browser.
        let id = offer(&local, "report.pdf", 4).unwrap();
        offer_chunk(&local, &id, b"%PDF", true).await.unwrap();
        let (res, _) = get(format!("{base}/api/file/{id}?k={k}")).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert!(res.headers()["content-disposition"].to_str().unwrap().contains("report.pdf"));
        assert_eq!(&res.into_body().collect().await.unwrap().to_bytes()[..], b"%PDF");

        stop(&local);
        let _ = std::fs::remove_dir_all(root);
    }
}

