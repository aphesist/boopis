//! The host's real secret channel over an in-memory store, for the plugin's Python tests (`tests/test_hostsecrets.py`).
//!
//! ```text
//! secret_channel_server <hermes home> <socket dir> [<service>/<account>=<value> ...]
//! ```
//!
//! It starts `secrets::channel` exactly as the app does (the socket, the rendezvous file, the token), prints one JSON
//! line with the paths, and serves until its standard input closes. It is a test fixture: the store is a map in memory,
//! and nothing here is ever a fallback for the keychain.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::print_stdout)]

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use hypotaxis_host::error::Result;
use hypotaxis_host::secrets::{SecretStore, channel};

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
    let home = PathBuf::from(args.next().expect("a Hermes home"));
    let dir = PathBuf::from(args.next().expect("a socket directory"));
    let store = Arc::new(Map::default());
    for seed in args {
        let (key, value) = seed.split_once('=').expect("service/account=value");
        let (service, account) = key.split_once('/').expect("service/account=value");
        store.set(service, account, value).unwrap();
    }
    let rendezvous = home.join("hypotaxis").join("host-channel.json");
    let running = channel::start(store, &dir, &rendezvous)
        .await
        .expect("the channel starts");
    println!(
        "{}",
        serde_json::json!({"socket": running.socket(), "rendezvous": rendezvous})
    );
    let mut sink = Vec::new();
    let _ = tokio::task::spawn_blocking(move || std::io::stdin().read_to_end(&mut sink)).await;
    drop(running);
}
