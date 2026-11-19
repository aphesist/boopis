//! The host's real secret channel over an in-memory store, for the plugin's Python tests (`tests/test_hostsecrets.py`).
//!
//! ```text
//! secret_channel_server <socket dir> <gateway pid> [<service>/<account>=<value> ...]
//! ```
//!
//! It starts `secrets::channel` exactly as the app does (the socket, the token, the peer check), with `<gateway pid>` as
//! the one process it serves (the test process plays the gateway), prints one JSON line with the socket and the token the
//! gateway would be handed, and serves until its standard input closes. It is a test fixture: the store is a map in
//! memory, and nothing here is ever a fallback for the keychain.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::print_stdout)]

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use hypotaxis_host::error::Result;
use hypotaxis_host::secrets::{Auth, PeerPolicy, SecretStore, channel};

#[derive(Default)]
struct Map(Mutex<HashMap<(String, String), String>>);

impl SecretStore for Map {
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert((service.into(), account.into()), value.into());
        Ok(())
    }
    fn get(&self, service: &str, account: &str) -> Result<Option<String>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&(service.to_owned(), account.to_owned()))
            .cloned())
    }
    fn delete(&self, service: &str, account: &str) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .remove(&(service.to_owned(), account.to_owned()));
        Ok(())
    }
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("a socket directory"));
    let gateway: u32 = args
        .next()
        .and_then(|p| p.parse().ok())
        .expect("the gateway's pid");
    let store = Arc::new(Map::default());
    for seed in args {
        let (key, value) = seed.split_once('=').expect("service/account=value");
        let (service, account) = key.split_once('/').expect("service/account=value");
        store.set(service, account, value).unwrap();
    }
    let auth = Auth::mint_in(&dir).expect("random bytes");
    let peers = Arc::new(PeerPolicy::new());
    assert!(
        peers.record_gateway(gateway),
        "the gateway's pid is a live process"
    );
    let running = channel::start(store, &auth, peers)
        .await
        .expect("the channel starts");
    let env: serde_json::Map<String, serde_json::Value> = auth
        .launch_env()
        .into_iter()
        .map(|(k, v)| (k, v.into()))
        .collect();
    println!(
        "{}",
        serde_json::json!({"socket": running.socket(), "env": env})
    );
    let mut sink = Vec::new();
    let _ = tokio::task::spawn_blocking(move || std::io::stdin().read_to_end(&mut sink)).await;
    drop(running);
}
