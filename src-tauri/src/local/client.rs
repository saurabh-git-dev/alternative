//! HTTPS requests to other devices (LocalSend's API, pairing, the chat link).

use std::{net::SocketAddr, sync::Arc, time::Duration};

use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::{Request, StatusCode};
use hyper_util::rt::TokioIo;
use rustls::{pki_types::ServerName, ClientConfig};
use tokio::{net::TcpStream, time::timeout};
use tokio_rustls::{client::TlsStream, TlsConnector};

use super::identity::fingerprint;

pub type Body = BoxBody<Bytes, std::io::Error>;

pub fn full(bytes: impl Into<Bytes>) -> Body {
    Full::new(bytes.into()).map_err(|never| match never {}).boxed()
}

pub fn empty() -> Body {
    full(Bytes::new())
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

/// Open TLS to `ip:port`. With `expect`, the server's certificate must have that fingerprint.
pub async fn connect(config: &Arc<ClientConfig>, ip: &str, port: u16, expect: Option<&str>) -> Result<TlsStream<TcpStream>, String> {
    let addr: SocketAddr = format!("{ip}:{port}").parse().map_err(|_| format!("bad address {ip}:{port}"))?;
    let tcp = timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await.map_err(|_| "offline".to_string())?.map_err(|_| "offline".to_string())?;
    tcp.set_nodelay(true).ok();
    let name = ServerName::try_from("localsend").unwrap();
    let tls = timeout(CONNECT_TIMEOUT, TlsConnector::from(config.clone()).connect(name, tcp))
        .await
        .map_err(|_| "offline".to_string())?
        .map_err(|e| format!("secure connection failed: {e}"))?;
    if let Some(expect) = expect {
        let seen = tls.get_ref().1.peer_certificates().and_then(|c| c.first()).map(|c| fingerprint(c)).unwrap_or_default();
        if !seen.eq_ignore_ascii_case(expect) {
            return Err("this isn't the device you paired with".into());
        }
    }
    Ok(tls)
}

/// One HTTP/1.1 request on a new connection. Returns the status and the whole response body.
pub async fn request(
    config: &Arc<ClientConfig>,
    ip: &str,
    port: u16,
    expect: Option<&str>,
    path: &str,
    body: Body,
    wait: Duration,
) -> Result<(StatusCode, Bytes), String> {
    let tls = connect(config, ip, port, expect).await?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(tls)).await.map_err(|e| e.to_string())?;
    tokio::spawn(conn);
    let req = Request::post(path)
        .header("host", format!("{ip}:{port}"))
        .header("content-type", "application/json")
        .body(body)
        .map_err(|e| e.to_string())?;
    let res = timeout(wait, sender.send_request(req)).await.map_err(|_| "no answer".to_string())?.map_err(|e| e.to_string())?;
    let status = res.status();
    let bytes = res.into_body().collect().await.map_err(|e| e.to_string())?.to_bytes();
    Ok((status, bytes))
}

pub async fn post_json(
    config: &Arc<ClientConfig>,
    ip: &str,
    port: u16,
    expect: Option<&str>,
    path: &str,
    json: &impl serde::Serialize,
    wait: Duration,
) -> Result<(StatusCode, Bytes), String> {
    request(config, ip, port, expect, path, full(serde_json::to_vec(json).unwrap()), wait).await
}
