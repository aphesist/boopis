//! The host to plugin secret channel (ADR-0020: secrets go UI to host to keychain; this is the last hop to the
//! plugin's `register_secret_source`). The plugin cannot call Tauri, so the host listens on a local socket.
//!
//! * **Transport:** a Unix domain socket in a `0700` directory (`$XDG_RUNTIME_DIR/boopis/`, else the per-user data
//!   directory), mode `0600`. Windows will use a named pipe with a user-only ACL (not implemented: `start` reports it).
//! * **Who may connect:** the gateway the host started, and only it ([`super::peer`]). The kernel's `SO_PEERCRED` names the
//!   connecting process; the host admits that process only if it is the recorded gateway (or the daemon a launch is
//!   starting), never a child of it, which is what a tool the agent runs is. Anything else gets the same answer as a wrong
//!   token and the store is never asked.
//! * **The token and where it goes:** a per-launch 256-bit token the host hands to the gateway *only*, in the environment of
//!   the `hermes gateway ensure|attach` call that starts it (`BOOPIS_HOST_SECRETS_TOKEN`, with the socket's path in
//!   `BOOPIS_HOST_SECRETS_SOCKET`). It is written to no file. The plugin reads it once, at load, and removes it from
//!   the process environment so no child of the gateway inherits it; Hermes's own secret-source rules strip it from the
//!   children it builds, too (`plugins/boopis/hostsecrets`). A process that holds the token (it can be read from
//!   `/proc/<gateway>/environ` by the same user) is still refused by the peer check: the token is the second factor.
//! * **Protocol** (`hx-host-secrets-v1`): one JSON line in, one out, then close. Requests carry `v`, `token`, `op`
//!   (`get` or `has`), `service`, `account`. Only the `boopis.` service namespace is reachable, and there is no
//!   write op: secrets arrive from the UI only.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use subtle::ConstantTimeEq;

use super::peer::PeerPolicy;
use super::store::{SecretStore, validate_name};
use crate::error::{Error, Result};

/// The protocol's name, in every reply.
pub const PROTOCOL: &str = "hx-host-secrets-v1";

/// The environment variable that carries the token to the gateway (and only there).
pub const TOKEN_ENV: &str = "BOOPIS_HOST_SECRETS_TOKEN";
/// The environment variable that names the socket for the plugin.
pub const SOCKET_ENV: &str = "BOOPIS_HOST_SECRETS_SOCKET";

/// The channel's credentials: its socket and the token. `Debug` never shows the token.
#[derive(Clone)]
pub struct Auth {
    socket: PathBuf,
    token: String,
}

impl std::fmt::Debug for Auth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Auth")
            .field("socket", &self.socket)
            .finish_non_exhaustive()
    }
}

impl Auth {
    /// A fresh token and the default socket path.
    ///
    /// # Errors
    /// `Io` when there is no directory for the socket or no random bytes.
    pub fn mint() -> Result<Self> {
        let dir = default_socket_dir()
            .ok_or_else(|| Error::Io("no directory for the plugin secret channel".into()))?;
        Self::mint_in(&dir)
    }

    /// A fresh token and a socket in `socket_dir` (the tests' own directory).
    ///
    /// # Errors
    /// `Io` when no random bytes are available.
    pub fn mint_in(socket_dir: &Path) -> Result<Self> {
        Ok(Self {
            socket: socket_dir.join("host.sock"),
            token: token()?,
        })
    }

    /// The socket's path.
    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }

    /// The token as an environment entry (`NAME=value`): what a process started with it holds in its environment, and what
    /// the peer policy checks for ([`super::PeerPolicy::holding`]).
    #[must_use]
    pub fn token_entry(&self) -> String {
        format!("{TOKEN_ENV}={}", self.token)
    }

    /// What the gateway gets in its environment, and no other process: the socket and the token.
    #[must_use]
    pub fn launch_env(&self) -> Vec<(String, String)> {
        vec![
            (SOCKET_ENV.to_owned(), self.socket.display().to_string()),
            (TOKEN_ENV.to_owned(), self.token.clone()),
        ]
    }
}

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

/// A running channel. Dropping it removes the socket.
#[derive(Debug)]
pub struct SecretChannel {
    socket: PathBuf,
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
    }
}

fn token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| Error::Io(format!("no random bytes: {e}")))?;
    Ok(hex::encode(bytes))
}

/// The directory for the socket: `$XDG_RUNTIME_DIR/boopis`, else the per-user data directory.
#[must_use]
pub fn default_socket_dir() -> Option<PathBuf> {
    dirs::runtime_dir()
        .map(|d| d.join("boopis"))
        .or_else(|| dirs::data_local_dir().map(|d| d.join("boopis").join("run")))
}

/// Start the channel on `auth`'s socket. `peers` decides which process may use it (see [`super::peer`]).
///
/// # Errors
/// `Io` when the directory or socket cannot be created; `Unavailable` on a platform without a Unix socket.
#[cfg(unix)]
pub async fn start(
    store: Arc<dyn SecretStore>,
    auth: &Auth,
    peers: Arc<PeerPolicy>,
) -> Result<SecretChannel> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let socket = auth.socket.clone();
    let socket_dir = socket
        .parent()
        .ok_or_else(|| Error::Io("the secret socket has no directory".into()))?;
    let mut dir = std::fs::DirBuilder::new();
    dir.recursive(true).mode(0o700);
    dir.create(socket_dir)?;
    std::fs::set_permissions(socket_dir, std::fs::Permissions::from_mode(0o700))?;
    let owner = std::fs::metadata(socket_dir)?.uid();
    // A leftover socket from a crashed run is removed; one a live host still answers is not ours to take.
    if socket.exists() {
        if tokio::net::UnixStream::connect(&socket).await.is_ok() {
            return Err(Error::Io("another boopis host already runs".into()));
        }
        std::fs::remove_file(&socket)?;
    }
    let listener = tokio::net::UnixListener::bind(&socket)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
    let gate = Arc::new(tokio::sync::Semaphore::new(8));
    let token = auth.token.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let Ok(permit) = gate.clone().acquire_owned().await else {
                return;
            };
            let (store, token, peers) = (store.clone(), token.clone(), peers.clone());
            tokio::spawn(async move {
                let _permit = permit;
                let work = async {
                    let cred = stream.peer_cred()?;
                    if cred.uid() != owner {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "wrong peer",
                        ));
                    }
                    // Decided now, from the kernel's answer, and acted on after the request is read: a refused process
                    // gets the same reply as a wrong token, so neither factor can be probed apart from the other.
                    let verdict = peers.admit(cred.pid().and_then(|p| u32::try_from(p).ok()));
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
                    let answer = if let Err(why) = verdict {
                        tracing::warn!(pid = ?cred.pid(), ?why, "the secret channel refused a process that is not the gateway");
                        reply(false, "hx.host.unauthorized", &json!({}))
                    } else {
                        // The keychain is a D-Bus round trip: never on an async worker.
                        tokio::task::spawn_blocking(move || {
                            handle_line(store.as_ref(), &token, &line)
                        })
                        .await
                        .map_err(std::io::Error::other)?
                    };
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
    Ok(SecretChannel { socket, task })
}

/// Windows needs a named pipe with a user-only ACL; until it exists the host reports it and the plugin gets no secrets.
///
/// # Errors
/// Always `Unavailable`.
#[cfg(not(unix))]
#[allow(
    clippy::unused_async,
    reason = "keeps the signature the same as on Unix, where the socket is bound asynchronously"
)]
pub async fn start(
    _store: Arc<dyn SecretStore>,
    _auth: &Auth,
    _peers: Arc<PeerPolicy>,
) -> Result<SecretChannel> {
    Err(Error::Unavailable(
        "the plugin secret channel needs a named pipe on this OS, which is not implemented yet"
            .into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::super::store::MemoryStore;
    use super::*;

    fn store() -> MemoryStore {
        let s = MemoryStore::default();
        s.set("boopis.provider.openai", "api_key", "sk-test-123")
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
            &req("get", "tok", "boopis.provider.openai", "api_key"),
        );
        assert_eq!(
            (r["ok"].clone(), r["value"].clone()),
            (json!(true), json!("sk-test-123"))
        );
        let r = ask(
            &s,
            "tok",
            &req("has", "tok", "boopis.provider.openai", "api_key"),
        );
        assert_eq!(r["found"], true);
        assert!(r.get("value").is_none(), "`has` never returns the value");
        let r = ask(
            &s,
            "tok",
            &req("get", "tok", "boopis.provider.openai", "missing"),
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
            &req("get", "TOK", "boopis.provider.openai", "api_key"),
        );
        assert_eq!(r["code"], "hx.host.unauthorized");
        assert!(r.get("value").is_none());
    }

    #[test]
    fn only_the_boopis_namespace_is_reachable() {
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
                &req(op, "tok", "boopis.provider.openai", "api_key"),
            );
            assert_eq!(r["ok"], false, "{op}");
        }
        assert_eq!(
            s.get("boopis.provider.openai", "api_key")
                .unwrap()
                .as_deref(),
            Some("sk-test-123")
        );
        for bad in [
            "",
            "nope",
            "{}",
            r#"{"v":2,"token":"t","op":"get","service":"boopis.a","account":"b"}"#,
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
            &req("get", "tok", "boopis.provider.openai", "api_key"),
        );
        assert_eq!(r["code"], "hx.secrets.unavailable");
    }

    #[test]
    fn the_request_never_prints_its_token() {
        let r: Request =
            serde_json::from_str(&req("get", "supersecrettoken", "boopis.a", "b").to_string())
                .unwrap();
        assert!(!format!("{r:?}").contains("supersecrettoken"));
    }

    /// A policy over the real process table that has recorded this test process as the gateway.
    fn gateway_is_this_process() -> Arc<PeerPolicy> {
        let peers = Arc::new(PeerPolicy::new());
        assert!(peers.record_gateway(std::process::id()));
        peers
    }

    /// The token a started channel hands to its gateway.
    fn token_of(auth: &Auth) -> String {
        auth.launch_env()
            .into_iter()
            .find(|(k, _)| k == TOKEN_ENV)
            .map(|(_, v)| v)
            .unwrap()
    }

    /// One request over the socket from this process; the reply line.
    #[cfg(unix)]
    async fn ask_over_socket(socket: &Path, line: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut s = tokio::net::UnixStream::connect(socket).await.unwrap();
        s.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    /// Not a test: the client half of `a_process_that_is_not_the_gateway_is_refused_even_with_the_token`, run as a child
    /// of the test process (the way a tool is a child of the gateway). It does nothing unless asked.
    #[cfg(unix)]
    #[test]
    fn peer_client_helper() {
        use std::io::{Read, Write};
        let (Ok(socket), Ok(request)) = (
            std::env::var("HX_TEST_PEER_SOCKET"),
            std::env::var("HX_TEST_PEER_REQUEST"),
        ) else {
            return;
        };
        let mut s = std::os::unix::net::UnixStream::connect(socket).unwrap();
        s.write_all(format!("{request}\n").as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        println!("REPLY:{}", out.trim());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_gateway_gets_its_secret_and_no_file_holds_the_token() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::mint_in(&dir.path().join("run")).unwrap();
        // This process is "the gateway": the host recorded it, as it records the pid of the gateway's control socket.
        let peers = gateway_is_this_process();
        let ch = start(Arc::new(store()), &auth, peers).await.unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(ch.socket()), 0o600);
        assert_eq!(mode(ch.socket().parent().unwrap()), 0o700);

        let out = ask_over_socket(
            ch.socket(),
            &req("get", &token_of(&auth), "boopis.provider.openai", "api_key").to_string(),
        )
        .await;
        assert!(out.contains("sk-test-123"), "{out}");

        // The token is in the gateway's environment and nowhere on disk: the socket is the only entry its directory has.
        let entries: Vec<_> = std::fs::read_dir(ch.socket().parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, ["host.sock"]);
        let token = token_of(&auth);
        let mut stack = vec![dir.path().to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if let Ok(bytes) = std::fs::read(&p) {
                    assert!(
                        !String::from_utf8_lossy(&bytes).contains(&token),
                        "{}",
                        p.display()
                    );
                }
            }
        }
        let sock = ch.socket().to_path_buf();
        drop(ch);
        assert!(!sock.exists(), "cleaned up on drop");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_process_that_is_not_the_gateway_is_refused_even_with_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::mint_in(&dir.path().join("run")).unwrap();
        let peers = gateway_is_this_process();
        let ch = start(Arc::new(store()), &auth, peers).await.unwrap();
        let good = req("get", &token_of(&auth), "boopis.provider.openai", "api_key").to_string();

        // A child of the gateway holding the very token (what a tool that read /proc/<gateway>/environ has).
        let socket = ch.socket().to_path_buf();
        let request = good.clone();
        let out = tokio::task::spawn_blocking(move || {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "secrets::channel::tests::peer_client_helper",
                    "--nocapture",
                ])
                .env("HX_TEST_PEER_SOCKET", socket)
                .env("HX_TEST_PEER_REQUEST", request)
                .output()
                .unwrap()
        })
        .await
        .unwrap();
        let stdout = String::from_utf8_lossy(&out.stdout);
        let refused = stdout
            .lines()
            .find_map(|l| l.strip_prefix("REPLY:"))
            .unwrap_or_else(|| panic!("the child printed no reply: {stdout}"));
        let refused: serde_json::Value = serde_json::from_str(refused).unwrap();
        assert_eq!(
            (refused["ok"].clone(), refused["code"].clone()),
            (json!(false), json!("hx.host.unauthorized"))
        );
        assert!(!stdout.contains("sk-test-123"));

        // It is the same answer a wrong token gets from the gateway itself: the peer check cannot be told apart.
        let wrong = req("get", "0", "boopis.provider.openai", "api_key").to_string();
        let from_gateway = ask_over_socket(ch.socket(), &wrong).await;
        assert_eq!(from_gateway.trim(), refused.to_string());
        // And the gateway itself, with the right token, still gets the secret.
        assert!(
            ask_over_socket(ch.socket(), &good)
                .await
                .contains("sk-test-123")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_channel_that_has_recorded_no_gateway_serves_nobody() {
        let dir = tempfile::tempdir().unwrap();
        let auth = Auth::mint_in(&dir.path().join("run")).unwrap();
        let ch = start(Arc::new(store()), &auth, Arc::new(PeerPolicy::new()))
            .await
            .unwrap();
        let out = ask_over_socket(
            ch.socket(),
            &req("get", &token_of(&auth), "boopis.provider.openai", "api_key").to_string(),
        )
        .await;
        assert!(
            out.contains("hx.host.unauthorized") && !out.contains("sk-test-123"),
            "{out}"
        );
    }

    #[test]
    fn the_credentials_never_print_their_token() {
        let auth = Auth::mint_in(Path::new("/run/x")).unwrap();
        assert!(!format!("{auth:?}").contains(&token_of(&auth)));
        let env = auth.launch_env();
        assert_eq!(env.len(), 2);
        assert_eq!(
            auth.token_entry(),
            format!("{TOKEN_ENV}={}", token_of(&auth))
        );
        assert!(
            env.iter()
                .any(|(k, v)| k == SOCKET_ENV && v == "/run/x/host.sock")
        );
        assert_eq!(token_of(&auth).len(), 64);
    }
}
