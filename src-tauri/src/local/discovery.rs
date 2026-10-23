//! Finding devices: LocalSend's multicast announcements on 224.0.0.167:53317,
//! answered over HTTPS (`/register`) or, failing that, by multicast. This
//! device announces itself at start and every 30 seconds, which also prompts
//! everyone else to answer, so the list's online/offline state stays fresh.
//! `scan` is LocalSend's fallback for networks that drop multicast: ask every
//! address on the local /24 networks directly.

use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::Arc,
    time::Duration,
};

use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;

use super::{client, types::*, Local};

const ANNOUNCE_EVERY: Duration = Duration::from_secs(30);

fn group() -> Ipv4Addr {
    Ipv4Addr::from(MULTICAST_ADDR)
}

/// This device's IPv4 addresses on local networks.
pub fn local_ipv4s() -> Vec<Ipv4Addr> {
    local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => Some(v4),
            _ => None,
        })
        .collect()
}

fn socket() -> std::io::Result<UdpSocket> {
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    s.set_reuse_address(true)?;
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    s.set_reuse_port(true)?;
    s.set_nonblocking(true)?;
    s.bind(&SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DEFAULT_PORT)).into())?;
    s.set_multicast_loop_v4(true)?;
    for ip in local_ipv4s() {
        let _ = s.join_multicast_v4(&group(), &ip);
    }
    if local_ipv4s().is_empty() {
        let _ = s.join_multicast_v4(&group(), &Ipv4Addr::UNSPECIFIED);
    }
    UdpSocket::from_std(s.into())
}

/// Send an announcement (or an answer to one) out of every network interface.
async fn broadcast(local: &Local, announce: bool) {
    let body = serde_json::to_vec(&local.info(Some(announce))).unwrap();
    for ip in local_ipv4s() {
        let Ok(s) = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)) else { continue };
        let _ = s.set_multicast_if_v4(&ip);
        let _ = s.set_multicast_ttl_v4(1);
        let _ = s.bind(&SocketAddr::V4(SocketAddrV4::new(ip, 0)).into());
        let _ = s.set_nonblocking(true);
        if let Ok(udp) = UdpSocket::from_std(s.into()) {
            let _ = udp.send_to(&body, SocketAddrV4::new(group(), DEFAULT_PORT)).await;
        }
    }
}

/// Tell a device about this one over HTTPS; true if it answered (it then counts as seen).
pub async fn register(local: &Arc<Local>, ip: String, port: u16) -> bool {
    let info = local.info(None);
    match client::post_json(&local.client_tls, &ip, port, None, "/api/localsend/v2/register", &info, Duration::from_secs(3)).await {
        Ok((status, body)) if status.is_success() => {
            if let Ok(theirs) = serde_json::from_slice::<Info>(&body) {
                local.saw(theirs, ip, port, true);
            }
            true
        }
        _ => false,
    }
}

pub fn run(local: Arc<Local>) {
    #[cfg(target_os = "android")]
    crate::android::multicast_lock();

    let listener = local.clone();
    tauri::async_runtime::spawn(async move {
        let socket = match socket() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("local share: no multicast ({e}); use Refresh to scan instead");
                return;
            }
        };
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let Ok((n, from)) = socket.recv_from(&mut buf).await else { continue };
            let Ok(info) = serde_json::from_slice::<Info>(&buf[..n]) else { continue };
            if info.fingerprint.eq_ignore_ascii_case(&listener.id.fingerprint) {
                continue;
            }
            let ip = from.ip().to_string();
            let port = info.port.unwrap_or(DEFAULT_PORT);
            let https = info.protocol.as_deref() != Some("http");
            let wants_answer = info.announce.unwrap_or(false);
            listener.saw(info, ip.clone(), port, https);
            if wants_answer {
                let local = listener.clone();
                tauri::async_runtime::spawn(async move {
                    // HTTP-only LocalSend devices can't take our HTTPS call; answer them by multicast.
                    if !(https && register(&local, ip, port).await) {
                        broadcast(&local, false).await;
                    }
                });
            }
        }
    });

    tauri::async_runtime::spawn(async move {
        let mut tick = 0u32;
        loop {
            broadcast(&local, true).await;
            // A fresh list now and then, so devices that went quiet show as offline.
            local.emit_devices();
            tick += 1;
            tokio::time::sleep(if tick < 3 { Duration::from_secs(3) } else { ANNOUNCE_EVERY }).await;
        }
    });
}

/// Announce now and ask every address on the local networks (for when multicast is blocked).
pub async fn scan(local: Arc<Local>) {
    broadcast(&local, true).await;
    let mut tasks = Vec::new();
    for ip in local_ipv4s() {
        let [a, b, c, own] = ip.octets();
        for d in 1..=254u8 {
            if d == own {
                continue;
            }
            let local = local.clone();
            tasks.push(tauri::async_runtime::spawn(async move {
                register(&local, format!("{a}.{b}.{c}.{d}"), DEFAULT_PORT).await;
            }));
        }
    }
    for t in tasks {
        let _ = t.await;
    }
    local.emit_devices();
}
