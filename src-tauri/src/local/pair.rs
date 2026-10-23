//! Pairing two copies of this app with a 6-digit PIN.
//!
//! Device A (the one that tapped "Pair") calls device B over TLS, both sides
//! presenting their certificates:
//! 1. `pair/start`: B makes a PIN and shows it on screen.
//! 2. The person types it on A. A and B run SPAKE2 with the PIN as the
//!    password and both certificate fingerprints as identities (`pair/finish`),
//!    so each ends up with the same key only if the PIN matched *and* nobody
//!    swapped certificates in between. A wrong guess teaches an eavesdropper
//!    nothing, and B allows three tries per PIN.
//! 3. Both prove they hold the key (B in `finish`'s answer, A in
//!    `pair/confirm`) and remember each other's fingerprint.

use std::{sync::Arc, time::Duration};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use hmac::{Hmac, KeyInit, Mac};
use hyper::{body::Incoming as HyperBody, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use spake2::{Ed25519Group, Identity, Password, Spake2};

use super::{
    client::{self, Body},
    server::{json, read_json, status, Caller},
    store::Paired,
    types::*,
    Local,
};

const PIN_FOR_MS: u64 = 3 * 60_000;
const TRIES: u32 = 3;

/// A PIN on this device's screen, for the device that asked.
pub struct Pending {
    pin: String,
    alias: String,
    device_model: Option<String>,
    device_type: Option<String>,
    until: u64,
    tries: u32,
    /// Set once SPAKE2 matched, waiting for the other side's confirmation.
    key: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Start {
    alias: String,
    device_model: Option<String>,
    device_type: Option<String>,
    port: u16,
}

#[derive(Serialize, Deserialize)]
struct Message {
    msg: String,
}

#[derive(Serialize, Deserialize)]
struct Answer {
    msg: String,
    confirm: String,
}

#[derive(Serialize, Deserialize)]
struct Confirm {
    confirm: String,
}

fn proof(key: &[u8], side: &str) -> String {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).unwrap();
    mac.update(b"tools-pair-confirm:");
    mac.update(side.as_bytes());
    B64.encode(mac.finalize().into_bytes())
}

fn proof_ok(key: &[u8], side: &str, given: &str) -> bool {
    let Ok(given) = B64.decode(given) else { return false };
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).unwrap();
    mac.update(b"tools-pair-confirm:");
    mac.update(side.as_bytes());
    mac.verify_slice(&given).is_ok()
}

fn new_pin() -> String {
    format!("{:06}", rand::random::<u32>() % 1_000_000)
}

/// Device B's side of the three steps.
pub async fn handle(local: Arc<Local>, caller: Caller, req: Request<HyperBody>) -> Response<Body> {
    let Some(theirs) = caller.fingerprint.clone() else { return status(StatusCode::UNAUTHORIZED) };
    let step = req.uri().path().rsplit('/').next().unwrap_or("").to_string();
    match step.as_str() {
        "start" => {
            let Some(start) = read_json::<Start>(req).await else { return status(StatusCode::BAD_REQUEST) };
            let pin = new_pin();
            local.saw(
                Info {
                    alias: start.alias.clone(),
                    version: PROTOCOL_VERSION.into(),
                    device_model: start.device_model.clone(),
                    device_type: start.device_type.clone(),
                    fingerprint: theirs.clone(),
                    port: Some(start.port),
                    protocol: Some("https".into()),
                    download: false,
                    announce: None,
                    tools: Some(1),
                },
                caller.ip.clone(),
                start.port,
                true,
            );
            local.pairing.lock().unwrap().insert(
                theirs.clone(),
                Pending { pin: pin.clone(), alias: start.alias.clone(), device_model: start.device_model, device_type: start.device_type, until: now_ms() + PIN_FOR_MS, tries: 0, key: None },
            );
            local.emit("local://pair-pin", serde_json::json!({ "fingerprint": theirs, "alias": start.alias, "pin": pin, "until": now_ms() + PIN_FOR_MS }));
            status(StatusCode::OK)
        }
        "finish" => {
            let Some(body) = read_json::<Message>(req).await else { return status(StatusCode::BAD_REQUEST) };
            let Ok(inbound) = B64.decode(body.msg) else { return status(StatusCode::BAD_REQUEST) };
            let mut pairing = local.pairing.lock().unwrap();
            let Some(p) = pairing.get_mut(&theirs) else { return status(StatusCode::GONE) };
            if now_ms() > p.until || p.tries >= TRIES {
                pairing.remove(&theirs);
                drop(pairing);
                local.emit("local://pair-done", serde_json::json!({ "fingerprint": theirs, "ok": false }));
                return status(StatusCode::GONE);
            }
            p.tries += 1;
            let (state, outbound) = Spake2::<Ed25519Group>::start_b(
                &Password::new(p.pin.as_bytes()),
                &Identity::new(theirs.as_bytes()),
                &Identity::new(local.id.fingerprint.as_bytes()),
            );
            let Ok(key) = state.finish(&inbound) else { return status(StatusCode::BAD_REQUEST) };
            let confirm = proof(&key, "b");
            p.key = Some(key);
            json(&Answer { msg: B64.encode(outbound), confirm })
        }
        "confirm" => {
            let Some(body) = read_json::<Confirm>(req).await else { return status(StatusCode::BAD_REQUEST) };
            let done = {
                let mut pairing = local.pairing.lock().unwrap();
                let Some(p) = pairing.get(&theirs) else { return status(StatusCode::GONE) };
                let matched = p.key.as_deref().map(|k| proof_ok(k, "a", &body.confirm)).unwrap_or(false);
                if !matched {
                    // Wrong PIN: B's key differs, so A's proof doesn't check out. Tries are counted in `finish`.
                    return status(StatusCode::FORBIDDEN);
                }
                pairing.remove(&theirs)
            };
            if let Some(p) = done {
                let port = local.address(&theirs).map(|a| a.1).unwrap_or(DEFAULT_PORT);
                local.store.lock().unwrap().upsert(Paired {
                    fingerprint: theirs.clone(),
                    alias: p.alias,
                    device_model: p.device_model,
                    device_type: p.device_type,
                    ip: caller.ip.clone(),
                    port,
                    paired_at: now_ms(),
                });
                local.emit("local://pair-done", serde_json::json!({ "fingerprint": theirs, "ok": true }));
                local.emit_devices();
            }
            status(StatusCode::OK)
        }
        "cancel" => {
            if local.pairing.lock().unwrap().remove(&theirs).is_some() {
                local.emit("local://pair-done", serde_json::json!({ "fingerprint": theirs, "ok": false }));
            }
            status(StatusCode::OK)
        }
        _ => status(StatusCode::NOT_FOUND),
    }
}

fn target(local: &Local, fingerprint: &str) -> Result<(String, u16), String> {
    local.address(fingerprint).map(|(ip, port, _)| (ip, port)).ok_or_else(|| "That device isn't on the network right now.".to_string())
}

/// Device A, step 1: ask the other device to show a PIN.
pub async fn request_pin(local: Arc<Local>, fingerprint: String) -> Result<(), String> {
    let (ip, port) = target(&local, &fingerprint)?;
    let me = local.me.read().unwrap().clone();
    let start = Start { alias: me.alias, device_model: me.device_model, device_type: Some(me.device_type), port: *local.port.read().unwrap() };
    let (code, _) = client::post_json(&local.client_tls, &ip, port, Some(&fingerprint), "/api/tools/v1/pair/start", &start, Duration::from_secs(8)).await?;
    if code.is_success() { Ok(()) } else { Err("The other device didn't respond to pairing.".into()) }
}

/// Device A, steps 2–3: check the PIN typed here, and remember the device if it matches.
pub async fn enter_pin(local: Arc<Local>, fingerprint: String, pin: String) -> Result<(), String> {
    let (ip, port) = target(&local, &fingerprint)?;
    let pin: String = pin.chars().filter(|c| c.is_ascii_digit()).collect();
    let (state, outbound) = Spake2::<Ed25519Group>::start_a(
        &Password::new(pin.as_bytes()),
        &Identity::new(local.id.fingerprint.as_bytes()),
        &Identity::new(fingerprint.as_bytes()),
    );
    let tls = &local.client_tls;
    let (code, body) = client::post_json(tls, &ip, port, Some(&fingerprint), "/api/tools/v1/pair/finish", &Message { msg: B64.encode(outbound) }, Duration::from_secs(8)).await?;
    if code == StatusCode::GONE {
        return Err("That PIN expired or had too many wrong tries. Start pairing again.".into());
    }
    let answer: Answer = serde_json::from_slice(&body).map_err(|_| "The other device sent something unexpected.".to_string())?;
    let inbound = B64.decode(answer.msg).map_err(|_| "The other device sent something unexpected.".to_string())?;
    let key = state.finish(&inbound).map_err(|_| "Pairing failed.".to_string())?;
    if !proof_ok(&key, "b", &answer.confirm) {
        return Err("Wrong PIN. Check the number on the other device and try again.".into());
    }
    let (code, _) = client::post_json(tls, &ip, port, Some(&fingerprint), "/api/tools/v1/pair/confirm", &Confirm { confirm: proof(&key, "a") }, Duration::from_secs(8)).await?;
    if !code.is_success() {
        return Err("The other device didn't accept the pairing.".into());
    }
    let peer = local.peers.read().unwrap().get(&fingerprint).cloned();
    local.store.lock().unwrap().upsert(Paired {
        fingerprint: fingerprint.clone(),
        alias: peer.as_ref().map(|p| p.info.alias.clone()).unwrap_or_default(),
        device_model: peer.as_ref().and_then(|p| p.info.device_model.clone()),
        device_type: peer.as_ref().and_then(|p| p.info.device_type.clone()),
        ip,
        port,
        paired_at: now_ms(),
    });
    local.emit_devices();
    super::link::dial_soon(local, fingerprint);
    Ok(())
}

/// Device A gave up: let the other device hide its PIN.
pub async fn cancel(local: Arc<Local>, fingerprint: String) {
    if let Ok((ip, port)) = target(&local, &fingerprint) {
        let _ = client::post_json(&local.client_tls, &ip, port, Some(&fingerprint), "/api/tools/v1/pair/cancel", &serde_json::json!({}), Duration::from_secs(4)).await;
    }
}
