//! Two devices in one process, talking over 127.0.0.1: discovery by
//! `/register`, PIN pairing, the chat link, and sending files.

use std::{sync::Arc, time::Duration};

use tokio::sync::mpsc;

use super::{discovery, link, pair, send, types::FileMeta, Local};

struct Device {
    local: Arc<Local>,
    events: mpsc::UnboundedReceiver<(String, serde_json::Value)>,
    port: u16,
    _dir: TempDir,
}

struct TempDir(std::path::PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn device(name: &str) -> Device {
    let dir = std::env::temp_dir().join(format!("tools-local-test-{name}-{}", super::rand_id()));
    let (tx, events) = mpsc::unbounded_channel();
    let local = Local::new(dir.join("data"), Some(dir.join("downloads")), Box::new(move |e, v| {
        let _ = tx.send((e.to_string(), v));
    }))
    .unwrap();
    local.me.write().unwrap().alias = name.into();
    let port = local.clone().serve().await.unwrap();
    Device { local, events, port, _dir: TempDir(dir) }
}

impl Device {
    /// The next event with this name (skipping others), within a few seconds.
    async fn next(&mut self, name: &str) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let (event, value) = self.events.recv().await.unwrap();
                if event == name {
                    return value;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no {name} event"))
    }
}

async fn meet(a: &Device, b: &Device) {
    assert!(discovery::register(&a.local, "127.0.0.1".into(), b.port).await, "register failed");
    // Each now knows the other: A from B's answer, B from A's request.
    assert!(a.local.peers.read().unwrap().contains_key(&b.local.id.fingerprint));
    assert!(b.local.peers.read().unwrap().contains_key(&a.local.id.fingerprint));
}

async fn pair(a: &mut Device, b: &mut Device) {
    let fb = b.local.id.fingerprint.clone();
    pair::request_pin(a.local.clone(), fb.clone()).await.unwrap();
    let shown = b.next("local://pair-pin").await;
    let pin = shown["pin"].as_str().unwrap().to_string();
    pair::enter_pin(a.local.clone(), fb, pin).await.unwrap();
    let done = b.next("local://pair-done").await;
    assert_eq!(done["ok"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn pairs_links_and_sends() {
    let mut a = device("Alpha").await;
    let mut b = device("Beta").await;
    meet(&a, &b).await;

    // A wrong PIN fails and pairs nothing.
    let fb = b.local.id.fingerprint.clone();
    let fa = a.local.id.fingerprint.clone();
    pair::request_pin(a.local.clone(), fb.clone()).await.unwrap();
    let pin = b.next("local://pair-pin").await["pin"].as_str().unwrap().to_string();
    let wrong = if pin == "000000" { "111111" } else { "000000" };
    let err = pair::enter_pin(a.local.clone(), fb.clone(), wrong.into()).await.unwrap_err();
    assert!(err.contains("Wrong PIN"), "{err}");
    assert!(!a.local.store.lock().unwrap().is_paired(&fb));
    assert!(!b.local.store.lock().unwrap().is_paired(&fa));

    pair(&mut a, &mut b).await;
    assert!(a.local.store.lock().unwrap().is_paired(&fb));
    assert!(b.local.store.lock().unwrap().is_paired(&fa));

    // The link opens (from whichever side dials) and carries messages both ways.
    link::dial_soon(a.local.clone(), fb.clone());
    link::dial_soon(b.local.clone(), fa.clone());
    a.next("local://link-state").await;
    b.next("local://link-state").await;
    assert!(link::send(&a.local, &fb, &serde_json::json!({ "t": "text", "text": "hi" })));
    let got = b.next("local://link").await;
    assert_eq!(got["fingerprint"], fa.as_str());
    assert_eq!(got["data"]["text"], "hi");
    assert!(link::send(&b.local, &fa, &serde_json::json!({ "t": "text", "text": "hello" })));
    assert_eq!(a.next("local://link").await["data"]["text"], "hello");

    // Files from a paired device arrive without asking, in pieces.
    let body = b"0123456789".repeat(100_000);
    let files = vec![
        FileMeta { id: "f1".into(), file_name: "notes.txt".into(), size: body.len() as u64, file_type: "text/plain".into(), sha256: None, preview: None },
        FileMeta { id: "f2".into(), file_name: "../empty".into(), size: 0, file_type: "".into(), sha256: None, preview: None },
    ];
    let started = send::start(a.local.clone(), fb.clone(), files, None).await.unwrap();
    assert_eq!(started.accepted.len(), 2);
    for (i, part) in body.chunks(300_000).enumerate() {
        let last = (i + 1) * 300_000 >= body.len();
        send::chunk(a.local.clone(), &started.transfer, "f1", part.to_vec(), last).await.unwrap();
    }
    send::chunk(a.local.clone(), &started.transfer, "f2", vec![], true).await.unwrap();
    send::finish(a.local.clone(), &started.transfer, false).await;
    let received = b.next("local://received").await;
    let saved = received["files"].as_array().unwrap();
    assert_eq!(saved.len(), 2);
    let notes = saved.iter().find(|f| f["name"] == "notes.txt").unwrap();
    assert_eq!(std::fs::read(notes["path"].as_str().unwrap()).unwrap(), body);
    let empty = saved.iter().find(|f| f["size"] == 0).unwrap();
    // A name can't climb out of the downloads folder.
    assert!(std::path::Path::new(empty["path"].as_str().unwrap()).starts_with(b.local.download_dir()));

    // Over 1 GB asks first, even from a paired device; declining refuses it.
    let huge = vec![FileMeta { id: "h".into(), file_name: "big.iso".into(), size: 2 << 30, file_type: "".into(), sha256: None, preview: None }];
    let sender = a.local.clone();
    let fb2 = fb.clone();
    let attempt = tokio::spawn(async move { send::start(sender, fb2, huge, None).await });
    let question = b.next("local://ask").await;
    assert_eq!(question["huge"], true);
    let request = question["request"].as_str().unwrap().to_string();
    b.local.asks.lock().unwrap().remove(&request).unwrap().send(false).unwrap();
    assert_eq!(attempt.await.unwrap().err().as_deref(), Some("rejected"));

    // Forgetting closes the link.
    b.local.store.lock().unwrap().remove(&fa);
    link::close(&b.local, &fa);
    a.next("local://link-state").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn strangers_are_asked() {
    let a = device("Gamma").await;
    let mut b = device("Delta").await;
    meet(&a, &b).await;
    let fb = b.local.id.fingerprint.clone();
    let files = vec![FileMeta { id: "x".into(), file_name: "photo.jpg".into(), size: 3, file_type: "image/jpeg".into(), sha256: None, preview: None }];
    let sender = a.local.clone();
    let attempt = tokio::spawn(async move { send::start(sender, fb, files, None).await });
    let question = b.next("local://ask").await;
    assert_eq!(question["paired"], false);
    assert_eq!(question["alias"], "Gamma");
    let request = question["request"].as_str().unwrap().to_string();
    b.local.asks.lock().unwrap().remove(&request).unwrap().send(true).unwrap();
    let started = attempt.await.unwrap().unwrap();
    send::chunk(a.local.clone(), &started.transfer, "x", b"abc".to_vec(), true).await.unwrap();
    let received = b.next("local://received").await;
    assert_eq!(received["alias"], "Gamma");
}
