//! The host to plugin secret channel (ADR-0020: secrets go UI to host to keychain; this is the last hop to the
//! plugin's `register_secret_source`). The plugin cannot call Tauri, so the host listens on a local socket.
//!
//! * **Transport:** a Unix domain socket in a `0700` directory (`$XDG_RUNTIME_DIR/hypotaxis/`, else the per-user data
//!   directory), mode `0600`. Windows will use a named pipe with a user-only ACL (not implemented: `start` reports it).
//! * **Rendezvous:** `<hermes home>/hypotaxis/host-channel.json`, mode `0600`, rewritten atomically on every host
//!   launch: `{schema_version, protocol, socket, token, pid}`. The plugin reads it for each request, so it always
//!   finds the live host without a restart, and a stale file (dead pid, refused connection) means "no host".
//! * **Authentication:** a per-launch 256-bit token compared in constant time, and the peer's uid must equal the
//!   uid that owns the socket directory. Nobody else can read the file or open the socket.
//! * **Protocol** (`hx-host-secrets-v1`): one JSON line in, one out, then close. Requests carry `v`, `token`, `op`
//!   (`get` or `has`), `service`, `account`. Only the `hypotaxis.` service namespace is reachable, and there is no
//!   write op: secrets arrive from the UI only.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;

use super::store::{SecretStore, validate_name};
use crate::error::{Error, Result};

/// The protocol's name, in the rendezvous file and every reply.
pub const PROTOCOL: &str = "hx-host-secrets-v1";

/// A request line. `Debug` never shows the token.
#[derive(Deserialize)]
struct Request {
    v: u32,
    token: String,
    op: String,
    service: String,
    account: String,
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("op", &self.op)
            .field("service", &self.service)
            .field("account", &self.account)
            .finish_non_exhaustive()
    }
}

fn reply(ok: bool, code: &str, extra: &serde_json::Value) -> String {
    let mut v = json!({"v": 1, "protocol": PROTOCOL, "ok": ok});
    if !ok {
        v["code"] = code.into();
    }
    if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
        o.extend(e.clone());
    }
    format!("{v}\n")
}

/// Answer one request line. Pure over the store, so it is tested without a socket.
pub fn handle_line(store: &dyn SecretStore, token: &str, line: &str) -> String {
    let Ok(req) = serde_json::from_str::<Request>(line) else {
        return reply(false, "hx.invalid_request", &json!({}));
    };
    if req.v != 1 {
        return reply(false, "hx.invalid_request", &json!({}));
    }
    if !bool::from(req.token.as_bytes().ct_eq(token.as_bytes())) {
        tracing::warn!("the secret channel refused a request with a wrong token");
        return reply(false, "hx.host.unauthorized", &json!({}));
    }
    if validate_name(&req.service, &req.account).is_err() {
        return reply(false, "hx.invalid_params", &json!({}));
    }
    tracing::debug!(?req, "secret channel request");
    match (req.op.as_str(), store.get(&req.service, &req.account)) {
        ("get", Ok(Some(value))) => reply(true, "", &json!({"value": value})),
        ("has", Ok(found)) => reply(true, "", &json!({"found": found.is_some()})),
        ("get", Ok(None)) => reply(false, "hx.secrets.not_found", &json!({})),
        (_, Err(e)) => reply(false, e.code(), &json!({})),
        _ => reply(false, "hx.method_not_found", &json!({})),
    }
}

/// A running channel. Dropping it removes the socket and the rendezvous file.
#[derive(Debug)]
pub struct SecretChannel {
    socket: PathBuf,
    rendezvous: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl SecretChannel {
    /// The socket's path.
    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }
}

impl Drop for SecretChannel {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.socket);
        let _ = std::fs::remove_file(&self.rendezvous);
    }
}

fn token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| Error::Io(format!("no random bytes: {e}")))?;
    Ok(hex::encode(bytes))
}

/// The directory for the socket: `$XDG_RUNTIME_DIR/hypotaxis`, else the per-user data directory.
#[must_use]
pub fn default_socket_dir() -> Option<PathBuf> {
    dirs::runtime_dir()
        .map(|d| d.join("hypotaxis"))
        .or_else(|| dirs::data_local_dir().map(|d| d.join("hypotaxis").join("run")))
}

/// Start the channel. `rendezvous` is `<hermes home>/hypotaxis/host-channel.json`.
///
/// # Errors
/// `Io` when the directory, socket or file cannot be created; `Unavailable` on a platform without a Unix socket.
#[cfg(unix)]
pub async fn start(
    store: Arc<dyn SecretStore>,
    socket_dir: &Path,
    rendezvous: &Path,
) -> Result<SecretChannel> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut dir = std::fs::DirBuilder::new();
    dir.recursive(true).mode(0o700);
    dir.create(socket_dir)?;
    std::fs::set_permissions(socket_dir, std::fs::Permissions::from_mode(0o700))?;
    let owner = std::fs::metadata(socket_dir)?.uid();
    let socket = socket_dir.join("host.sock");
    // A leftover socket from a crashed run is removed; one a live host still answers is not ours to take.
    if socket.exists() {
        if tokio::net::UnixStream::connect(&socket).await.is_ok() {
            return Err(Error::Io("another hypotaxis host already runs".into()));
        }
        std::fs::remove_file(&socket)?;
    }
    let listener = tokio::net::UnixListener::bind(&socket)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
    let token = token()?;
    write_rendezvous(rendezvous, &socket, &token)?;
    let gate = Arc::new(tokio::sync::Semaphore::new(8));
    let task_token = token;
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let Ok(permit) = gate.clone().acquire_owned().await else {
                return;
            };
            let (store, token) = (store.clone(), task_token.clone());
            tokio::spawn(async move {
                let _permit = permit;
                let work = async {
                    if stream.peer_cred().map(|c| c.uid())? != owner {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "wrong peer",
                        ));
                    }
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 1024];
                    while !buf.contains(&b'\n') && buf.len() < 8 * 1024 {
                        let n = stream.read(&mut chunk).await?;
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let line = String::from_utf8_lossy(
                        buf.split(|b| *b == b'\n').next().unwrap_or_default(),
                    )
                    .into_owned();
                    // The keychain is a D-Bus round trip: never on an async worker.
                    let answer = tokio::task::spawn_blocking(move || {
                        handle_line(store.as_ref(), &token, &line)
                    })
                    .await
                    .map_err(std::io::Error::other)?;
                    stream.write_all(answer.as_bytes()).await?;
                    stream.shutdown().await
                };
                if let Ok(Err(e)) =
                    tokio::time::timeout(std::time::Duration::from_secs(2), work).await
                {
                    tracing::debug!(error = %e, "secret channel connection ended");
                }
            });
        }
    });
    Ok(SecretChannel {
        socket,
        rendezvous: rendezvous.to_path_buf(),
        task,
    })
}

/// Windows needs a named pipe with a user-only ACL; until it exists the host reports it and the plugin gets no secrets.
///
/// # Errors
/// Always `Unavailable`.
#[cfg(not(unix))]
pub async fn start(
    _store: Arc<dyn SecretStore>,
    _socket_dir: &Path,
    _rendezvous: &Path,
) -> Result<SecretChannel> {
    Err(Error::Unavailable(
        "the plugin secret channel needs a named pipe on this OS, which is not implemented yet"
            .into(),
    ))
}

#[cfg(unix)]
fn write_rendezvous(path: &Path, socket: &Path, token: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let parent = path
        .parent()
        .ok_or_else(|| Error::Io("the rendezvous file has no directory".into()))?;
    std::fs::create_dir_all(parent)?;
    let body = serde_json::to_vec_pretty(&json!({
        "schema_version": 1, "protocol": PROTOCOL, "socket": socket, "token": token, "pid": std::process::id(),
    }))
    .map_err(|e| Error::Io(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(&body)?;
    f.sync_all()?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::store::MemoryStore;
    use super::*;

    fn store() -> MemoryStore {
        let s = MemoryStore::default();
        s.set("hypotaxis.provider.openai", "api_key", "sk-test-123")
            .unwrap();
        s
    }
    fn ask(s: &MemoryStore, token: &str, body: &serde_json::Value) -> serde_json::Value {
        serde_json::from_str(handle_line(s, token, &body.to_string()).trim()).unwrap()
    }
    fn req(op: &str, token: &str, service: &str, account: &str) -> serde_json::Value {
        json!({"v":1,"token":token,"op":op,"service":service,"account":account})
    }

    #[test]
    fn the_plugin_can_get_and_check_a_secret_with_the_token() {
        let s = store();
        let r = ask(
            &s,
            "tok",
            &req("get", "tok", "hypotaxis.provider.openai", "api_key"),
        );
        assert_eq!(
            (r["ok"].clone(), r["value"].clone()),
            (json!(true), json!("sk-test-123"))
        );
        let r = ask(
            &s,
            "tok",
            &req("has", "tok", "hypotaxis.provider.openai", "api_key"),
        );
        assert_eq!(r["found"], true);
        assert!(r.get("value").is_none(), "`has` never returns the value");
        let r = ask(
            &s,
            "tok",
            &req("get", "tok", "hypotaxis.provider.openai", "missing"),
        );
        assert_eq!(
            (r["ok"].clone(), r["code"].clone()),
            (json!(false), json!("hx.secrets.not_found"))
        );
    }

    #[test]
    fn a_wrong_token_gets_nothing() {
        let s = store();
        let r = ask(
            &s,
            "tok",
            &req("get", "TOK", "hypotaxis.provider.openai", "api_key"),
        );
        assert_eq!(r["code"], "hx.host.unauthorized");
        assert!(r.get("value").is_none());
    }

    #[test]
    fn only_the_hypotaxis_namespace_is_reachable() {
        let s = store();
        s.set("login.github", "token", "ghp_x").unwrap();
        let r = ask(&s, "tok", &req("get", "tok", "login.github", "token"));
        assert_eq!(r["code"], "hx.invalid_params");
    }

    #[test]
    fn there_is_no_write_op_and_garbage_is_refused() {
        let s = store();
        for op in ["set", "delete", "list"] {
            let r = ask(
                &s,
                "tok",
                &req(op, "tok", "hypotaxis.provider.openai", "api_key"),
            );
            assert_eq!(r["ok"], false, "{op}");
        }
        assert_eq!(
            s.get("hypotaxis.provider.openai", "api_key")
                .unwrap()
                .as_deref(),
            Some("sk-test-123")
        );
        for bad in [
            "",
            "nope",
            "{}",
            r#"{"v":2,"token":"t","op":"get","service":"hypotaxis.a","account":"b"}"#,
        ] {
            let out = handle_line(&s, "tok", bad);
            assert!(out.contains("\"ok\":false"), "{bad}");
        }
    }

    #[test]
    fn a_dead_store_is_reported_with_its_code() {
        let s = store();
        s.unavailable
            .store(true, std::sync::atomic::Ordering::Relaxed);
        let r = ask(
            &s,
            "tok",
            &req("get", "tok", "hypotaxis.provider.openai", "api_key"),
        );
        assert_eq!(r["code"], "hx.secrets.unavailable");
    }

    #[test]
    fn the_request_never_prints_its_token() {
        let r: Request =
            serde_json::from_str(&req("get", "supersecrettoken", "hypotaxis.a", "b").to_string())
                .unwrap();
        assert!(!format!("{r:?}").contains("supersecrettoken"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_socket_serves_a_client_and_the_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let dir = tempfile::tempdir().unwrap();
        let rendezvous = dir
            .path()
            .join("hermes")
            .join("hypotaxis")
            .join("host-channel.json");
        let backend = Arc::new(store());
        let ch = start(backend, &dir.path().join("run"), &rendezvous)
            .await
            .unwrap();
        assert_eq!(
            std::fs::metadata(&rendezvous).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(ch.socket()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(ch.socket().parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let info: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&rendezvous).unwrap()).unwrap();
        assert_eq!(info["protocol"], PROTOCOL);
        let token = info["token"].as_str().unwrap().to_owned();
        assert_eq!(token.len(), 64);
        let mut s = tokio::net::UnixStream::connect(info["socket"].as_str().unwrap())
            .await
            .unwrap();
        s.write_all(
            format!(
                "{}\n",
                req("get", &token, "hypotaxis.provider.openai", "api_key")
            )
            .as_bytes(),
        )
        .await
        .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        assert!(out.contains("sk-test-123"), "{out}");
        let sock = ch.socket().to_path_buf();
        drop(ch);
        assert!(!sock.exists() && !rendezvous.exists(), "cleaned up on drop");
    }
}
