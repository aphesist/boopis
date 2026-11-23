//! The gateway's control socket (`$HERMES_HOME/gateway.sock`): one JSON line in, one out. It answers `identify` and
//! `session-ticket` in about 2 ms, where `hermes gateway attach --json` costs a Python start (about 500 ms), so it is
//! how the host meets its 300 ms attach budget. POSIX only; Windows (a named pipe) uses the CLI.

use std::path::Path;

use super::attach::EndpointInfo;
use crate::error::{Error, Result};

/// What `identify` says.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Identify {
    /// The gateway's description (the same fields as a verdict's endpoint).
    #[serde(flatten)]
    pub endpoint: EndpointInfo,
    /// `ready`, `draining`, ...
    #[serde(default)]
    pub state: String,
    /// The profiles the gateway serves.
    #[serde(default)]
    pub served_profiles: Vec<ServedProfile>,
    /// The pid of the process listening on the control socket, as the kernel reports it for the connection (`SO_PEERCRED`):
    /// the gateway itself. The host records it as the one process the secret channel serves (`secrets::peer`). Never read
    /// from what the gateway says.
    #[serde(skip)]
    pub pid: Option<u32>,
}

/// One served profile.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ServedProfile {
    /// The profile id the ticket is bound to.
    pub profile_id: String,
    /// Its home directory.
    pub home: Option<String>,
}

impl Identify {
    /// The profile id that serves `home`: the entry with that home, or the only entry.
    /// The only entry stands in for `home` when none names it (a symlinked or differently spelled home), unless that entry's
    /// home is gone from the disk ([`Identify::stale_home`]).
    #[must_use]
    pub fn profile_id_for(&self, home: &Path) -> Option<&str> {
        let same = |p: &ServedProfile| {
            p.home.as_deref().is_some_and(|h| Path::new(h) == home)
                || Path::new(&p.profile_id) == home
        };
        self.served_profiles
            .iter()
            .find(|p| same(p))
            .or_else(|| {
                (self.served_profiles.len() == 1 && self.stale_home(home).is_none())
                    .then(|| self.served_profiles.first())
                    .flatten()
            })
            .map(|p| p.profile_id.as_str())
    }

    /// The profile id of the entry that names `home` itself, never a stand-in: how a profile home with no control socket of its
    /// own is found among the profiles the root's gateway serves (the engine's multiplexer, `docs/LOCAL-API.md`). Paths are
    /// compared as written and as resolved, since the engine names homes resolved.
    #[must_use]
    pub fn served_id(&self, home: &Path) -> Option<&str> {
        let resolved = std::fs::canonicalize(home).ok();
        let same = |p: &str| {
            let p = Path::new(p);
            p == home || resolved.as_deref().is_some_and(|r| p == r)
        };
        self.served_profiles
            .iter()
            .find(|p| p.home.as_deref().is_some_and(same) || same(&p.profile_id))
            .map(|p| p.profile_id.as_str())
    }

    /// The home this gateway serves when it is not `home`, is `home`'s sibling and no longer exists: a gateway whose folder was
    /// renamed under it (ADR-0031's `hermes-home` to `engine`) still answers on the moved control socket, but its
    /// database was moved while open, so its writes are refused (`storage_unavailable`). Such a gateway is stopped and
    /// started again, never used.
    #[must_use]
    pub fn stale_home(&self, home: &Path) -> Option<String> {
        let named = |p: &ServedProfile| {
            p.home.as_deref().is_some_and(|h| Path::new(h) == home)
                || Path::new(&p.profile_id) == home
        };
        if self.served_profiles.iter().any(named) {
            return None;
        }
        let [only] = self.served_profiles.as_slice() else {
            return None;
        };
        let theirs = only.home.as_deref().unwrap_or(&only.profile_id);
        let path = Path::new(theirs);
        // A folder renamed under it: a sibling of `home` (same parent) that is gone while `home` is there.
        (path.is_absolute() && !path.exists() && home.exists() && path.parent() == home.parent())
            .then(|| theirs.to_owned())
    }
}

/// Ask the control socket of `home` for its identity.
///
/// # Errors
/// `Unavailable` when no gateway answers, or on a platform with no socket support.
pub async fn identify(home: &Path) -> Result<Identify> {
    let (result, pid) = query(
        home,
        &serde_json::json!({"protocol": 1, "id": 1, "verb": "identify"}),
    )
    .await?;
    let mut identity: Identify = serde_json::from_value(result)
        .map_err(|e| Error::Unavailable(format!("bad identify answer: {e}")))?;
    identity.pid = pid;
    Ok(identity)
}

/// Mint a single-use ticket for `profile_id` on the gateway `identity`.
///
/// # Errors
/// `Unavailable` when the gateway refuses or the socket does not answer.
pub async fn session_ticket(home: &Path, identity: &Identify, profile_id: &str) -> Result<String> {
    let instance = identity
        .endpoint
        .instance_id
        .as_deref()
        .ok_or_else(|| Error::Unavailable("identify named no instance".into()))?;
    let req = serde_json::json!({"protocol": 1, "id": 1, "verb": "session-ticket",
        "params": {"profile_id": profile_id, "instance_id": instance, "purpose": "interactive"}});
    let (result, _) = query(home, &req).await?;
    result
        .get("ticket")
        .and_then(|t| t.as_str())
        .map(str::to_owned)
        .ok_or_else(|| Error::Unavailable("the gateway minted no ticket".into()))
}

/// How long `reload-plugins` may take: the engine's own caller waits 30 s (discovery, then the plugin's MCP servers).
const RELOAD_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

/// Ask the gateway serving `root` to discover the plugins of `home` again (`reload-plugins`, the verb the engine's own
/// `plugins enable` uses): a plugin linked into a bot's home, or a secret source configured there, takes effect without a
/// restart. `home` is the root itself or a profile the gateway serves. The answer names the plugins it now has loaded.
///
/// # Errors
/// `Unavailable` when no gateway answers, it refuses the home, or on a platform with no socket support (Windows: the caller
/// restarts the gateway instead).
pub async fn reload_plugins(root: &Path, home: &Path) -> Result<Vec<String>> {
    let req = serde_json::json!({"protocol": 1, "id": 1, "verb": "reload-plugins",
        "params": {"home": home.display().to_string()}});
    let (result, _) = query_within(root, &req, RELOAD_WAIT).await?;
    if result.get("reloaded").and_then(serde_json::Value::as_bool) != Some(true) {
        let why = result
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("refused");
        return Err(Error::Unavailable(format!(
            "the gateway did not reload the plugins: {why}"
        )));
    }
    Ok(result
        .get("plugins")
        .and_then(serde_json::Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default())
}

/// One round trip: the answer's `result`, and the pid the kernel reports for the process that answered.
async fn query(
    home: &Path,
    request: &serde_json::Value,
) -> Result<(serde_json::Value, Option<u32>)> {
    query_within(home, request, std::time::Duration::from_secs(2)).await
}

/// [`query`] with its own time limit.
#[cfg(unix)]
async fn query_within(
    home: &Path,
    request: &serde_json::Value,
    wait: std::time::Duration,
) -> Result<(serde_json::Value, Option<u32>)> {
    use std::os::unix::fs::MetadataExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const LIMIT: u64 = 512 * 1024;
    let path = socket_path(home).await;
    let work = async {
        let mut stream = tokio::net::UnixStream::connect(&path).await?;
        // The home must belong to whoever is on the other end, and nobody else may write to it: a socket another
        // user planted must never be asked for a ticket.
        let meta = tokio::fs::metadata(home).await?;
        let peer = stream.peer_cred()?;
        if peer.uid() != meta.uid() || meta.mode() & 0o022 != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "the gateway socket is not owned by the home's owner",
            ));
        }
        let mut line = serde_json::to_vec(request).map_err(std::io::Error::other)?;
        line.push(b'\n');
        stream.write_all(&line).await?;
        let mut buf = Vec::new();
        (&mut stream).take(LIMIT).read_to_end(&mut buf).await?;
        Ok((buf, peer.pid().and_then(|p| u32::try_from(p).ok())))
    };
    let (buf, pid) = tokio::time::timeout(wait, work)
        .await
        .map_err(|_| Error::Timeout("the gateway control socket"))?
        .map_err(|e| Error::Unavailable(format!("gateway control socket: {e}")))?;
    let answer: serde_json::Value = serde_json::from_slice(
        buf.split(|b| *b == b'\n').next().unwrap_or_default(),
    )
    .map_err(|e| Error::Unavailable(format!("gateway control socket answered badly: {e}")))?;
    if answer.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok((
            answer
                .get("result")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            pid,
        ))
    } else {
        let why = answer
            .get("error")
            .and_then(|e| e.as_str())
            .unwrap_or("refused");
        Err(Error::Unavailable(format!("gateway control socket: {why}")))
    }
}

#[cfg(unix)]
async fn socket_path(home: &Path) -> std::path::PathBuf {
    // A home path too long for `sun_path` makes Hermes bind elsewhere and leave a pointer file.
    if let Ok(p) = tokio::fs::read_to_string(home.join("gateway.sock.path")).await {
        let p = std::path::PathBuf::from(p.trim());
        if p.is_absolute() {
            return p;
        }
    }
    home.join("gateway.sock")
}

#[cfg(not(unix))]
#[allow(
    clippy::unused_async,
    reason = "keeps the signature the same as on Unix, where the socket is read asynchronously"
)]
async fn query_within(
    _home: &Path,
    _request: &serde_json::Value,
    _wait: std::time::Duration,
) -> Result<(serde_json::Value, Option<u32>)> {
    Err(Error::Unavailable(
        "the gateway control socket is a named pipe here; the host uses the CLI".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_served_profile_is_matched_by_home_or_is_the_only_one() {
        let id: Identify = serde_json::from_str(
            r#"{"state":"ready","instance_id":"i","api_origin":"http://127.0.0.1:1","served_profiles":[{"profile_id":"/h","home":"/h"}],"x":1}"#,
        )
        .unwrap();
        assert_eq!(id.profile_id_for(Path::new("/h")), Some("/h"));
        assert_eq!(
            id.profile_id_for(Path::new("/other")),
            Some("/h"),
            "the only served profile"
        );
        let two: Identify = serde_json::from_str(
            r#"{"served_profiles":[{"profile_id":"/a","home":"/a"},{"profile_id":"/b","home":"/b"}]}"#,
        )
        .unwrap();
        assert_eq!(two.profile_id_for(Path::new("/b")), Some("/b"));
        assert_eq!(two.profile_id_for(Path::new("/c")), None);
    }

    #[test]
    fn a_gateway_whose_home_is_gone_from_the_disk_is_stale_and_never_stands_in() {
        let dir = tempfile::tempdir().unwrap();
        let (old, new) = (dir.path().join("hermes-home"), dir.path().join("engine"));
        std::fs::create_dir(&new).unwrap();
        let json = format!(
            r#"{{"state":"ready","served_profiles":[{{"profile_id":"{0}","home":"{0}"}}]}}"#,
            old.display()
        );
        let moved: Identify = serde_json::from_str(&json).unwrap();
        assert_eq!(moved.stale_home(&new), Some(old.display().to_string()));
        assert_eq!(
            moved.profile_id_for(&new),
            None,
            "never the stand-in for the new home"
        );
        std::fs::create_dir(&old).unwrap();
        assert_eq!(
            moved.stale_home(&new),
            None,
            "a home that exists is a symlink or a spelling, not a stale gateway"
        );
        assert!(moved.profile_id_for(&new).is_some());
        assert_eq!(moved.stale_home(&old), None, "it serves exactly this home");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn identify_and_ticket_round_trip_over_a_unix_socket() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let dir = tempfile::tempdir().unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let listener = tokio::net::UnixListener::bind(dir.path().join("gateway.sock")).unwrap();
        tokio::spawn(async move {
            for _ in 0..2 {
                let Ok((s, _)) = listener.accept().await else {
                    return;
                };
                let (r, mut w) = s.into_split();
                let mut line = String::new();
                BufReader::new(r).read_line(&mut line).await.unwrap();
                let req: serde_json::Value = serde_json::from_str(&line).unwrap();
                let result = if req["verb"] == "identify" {
                    serde_json::json!({"state":"ready","instance_id":"inst","api_origin":"http://127.0.0.1:7",
                        "served_profiles":[{"profile_id":"/p","home":"/p"}]})
                } else {
                    assert_eq!(req["params"]["instance_id"], "inst");
                    assert_eq!(req["params"]["purpose"], "interactive");
                    serde_json::json!({"ticket":"abc_DEF-123"})
                };
                w.write_all(
                    format!(
                        "{}\n",
                        serde_json::json!({"ok":true,"protocol":1,"result":result,"id":1})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            }
        });
        let id = identify(dir.path()).await.unwrap();
        assert_eq!(id.state, "ready");
        // The listener here is this very process: the pid is the kernel's, not the gateway's own claim.
        assert_eq!(id.pid, Some(std::process::id()));
        let t = session_ticket(dir.path(), &id, id.profile_id_for(dir.path()).unwrap())
            .await
            .unwrap();
        assert_eq!(t, "abc_DEF-123");
        let d = super::super::attach::Dial::from_control(id.endpoint, &t).unwrap();
        assert_eq!(d.url.as_str(), "ws://127.0.0.1:7/api/ws");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reload_plugins_names_the_home_and_reads_what_loaded() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let dir = tempfile::tempdir().unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let listener = tokio::net::UnixListener::bind(dir.path().join("gateway.sock")).unwrap();
        let bot = dir.path().join("profiles").join("kai");
        let want = bot.display().to_string();
        tokio::spawn(async move {
            for answer in [
                serde_json::json!({"reloaded": true, "home": want, "plugins": ["boopis", "claude-subscription-directsdk-experimental"]}),
                serde_json::json!({"reloaded": false, "error": "home is not served by this gateway"}),
            ] {
                let Ok((s, _)) = listener.accept().await else {
                    return;
                };
                let (r, mut w) = s.into_split();
                let mut line = String::new();
                BufReader::new(r).read_line(&mut line).await.unwrap();
                let req: serde_json::Value = serde_json::from_str(&line).unwrap();
                assert_eq!(req["verb"], "reload-plugins");
                assert_eq!(req["params"]["home"], want);
                w.write_all(
                    format!(
                        "{}\n",
                        serde_json::json!({"ok":true,"protocol":1,"result":answer,"id":1})
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            }
        });
        let loaded = reload_plugins(dir.path(), &bot).await.unwrap();
        assert!(loaded.iter().any(|p| p == "boopis"));
        let refused = reload_plugins(dir.path(), &bot).await.unwrap_err();
        assert!(refused.to_string().contains("not served"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_missing_socket_is_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let e = identify(dir.path()).await.unwrap_err();
        assert_eq!(e.code(), "hx.engine.unavailable");
    }
}
