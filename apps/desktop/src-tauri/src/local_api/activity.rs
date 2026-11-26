//! What a bot is doing, pushed by the plugin from the engine's own tool hooks (B45, `plugins/boopis/activity.py`).
//!
//! The engine runs turns the host's links never see: a room member's turn, a scheduled run, a kanban worker. Its live
//! session list says only "working" for those, every two seconds, so a short tool never showed. The plugin is loaded in
//! every agent the engine runs and its `pre_tool_call`, `post_tool_call` and `on_session_end` hooks fire for every call, so
//! it sends one datagram per event to a Unix socket the host binds while the app runs:
//! - **where:** `activity.sock` in the host's private socket folder (mode 0700, the secret channel's), mode 0600; the
//!   plugin learns the path from `<root home>/boopis/activity.json` (`{"v": 1, "socket": <path>}`, mode 0600), which the
//!   host writes here. No environment variable, no file the plugin writes;
//! - **bounded:** a datagram is at most 4 KiB, the kernel's queue holds what the host has not read yet, and a full queue
//!   drops the event on the plugin's side without waiting; the host keeps nothing it is handed unless someone listens;
//! - **what:** the profile, the session, the event (`tool.start`, `tool.end`, `turn.end`), the tool's name and call id,
//!   whether it failed, the cron job of a scheduled run, and of the call's arguments only those the safe words are made
//!   from (`apps/shared/data/tool-args.json`). The host makes the words with [`super::toolwords`] and scrubs them like any
//!   engine text: one implementation of both;
//! - **trust:** only this user's processes can reach the folder. An event can only move a bot's presence; it can answer
//!   nothing and send nothing.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::feed::Feed;

/// The event's shape; another is refused.
pub const VERSION: u64 = 1;
/// The socket's name in the host's private socket folder.
pub const SOCKET: &str = "activity.sock";
/// Where, under the root home, the plugin reads which socket to send to.
pub const POINTER: [&str; 2] = ["boopis", "activity.json"];
/// The largest datagram read; a longer one is not an event.
pub const MAX_DATAGRAM: usize = 4096;

/// What the plugin saw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A tool call starts (the policy let it through).
    ToolStart,
    /// A tool call ended.
    ToolEnd,
    /// A turn ended.
    TurnEnd,
    /// A scheduled run's step was refused by a rule and parked for the owner (`rules-engine.md` 8.3); `tool` holds the
    /// card's first words, `parked` the parked step's id.
    RuleRefused,
}

/// One event, read and checked.
#[derive(Debug, Clone, PartialEq)]
pub struct Pushed {
    /// What happened.
    pub kind: Kind,
    /// The bot.
    pub profile: String,
    /// The engine's id of the session.
    pub session_id: String,
    /// The tool's name (empty for a turn's end).
    pub tool: String,
    /// The tool call's id, when the engine gave one.
    pub call: String,
    /// The call's arguments that say what it touches (a `tool.start` only).
    pub args: Option<Value>,
    /// A call or turn that failed.
    pub failed: bool,
    /// The scheduled job the session runs for, when it is a scheduled run.
    pub cron: Option<String>,
    /// The parked step's id (a `rule.refused` only).
    pub parked: Option<String>,
}

fn id_ok(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

/// Read one datagram; `None` for anything that is not an event of this version.
#[must_use]
pub fn parse(bytes: &[u8]) -> Option<Pushed> {
    if bytes.len() > MAX_DATAGRAM {
        return None;
    }
    let v: Value = serde_json::from_slice(bytes).ok()?;
    if v.get("v")?.as_u64()? != VERSION {
        return None;
    }
    let kind = match v.get("kind")?.as_str()? {
        "tool.start" => Kind::ToolStart,
        "tool.end" => Kind::ToolEnd,
        "turn.end" => Kind::TurnEnd,
        "rule.refused" => Kind::RuleRefused,
        _ => return None,
    };
    let s = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };
    let (profile, session_id, tool, call) = (s("profile"), s("session_id"), s("tool"), s("call"));
    let named = kind == Kind::TurnEnd || !tool.trim().is_empty();
    if !id_ok(&profile, 64)
        || !id_ok(&session_id, 128)
        || tool.chars().count() > 128
        || call.chars().count() > 128
        || !named
    {
        return None;
    }
    Some(Pushed {
        kind,
        profile,
        session_id,
        tool,
        call,
        args: (kind == Kind::ToolStart)
            .then(|| v.get("args").filter(|a| a.is_object()).cloned())
            .flatten(),
        failed: v.get("failed").and_then(Value::as_bool).unwrap_or(false),
        cron: Some(s("cron")).filter(|c| id_ok(c, 128)),
        parked: (kind == Kind::RuleRefused)
            .then(|| Some(s("parked")).filter(|c| id_ok(c, 64)))
            .flatten(),
    })
}

/// Write the pointer the plugin reads: `<root>/boopis/activity.json`, mode 0600, by renaming a private temporary file into
/// place so a reader never sees half of it.
#[cfg(unix)]
fn write_pointer(root: &Path, socket: &Path) -> std::io::Result<PathBuf> {
    use std::io::Write as _;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let path = root.join(POINTER[0]).join(POINTER[1]);
    let dir = root.join(POINTER[0]);
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)?;
    let tmp = dir.join(format!(".activity.{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    let text = json!({"v": VERSION, "socket": socket}).to_string();
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

/// The socket the plugin sends to, while the app runs.
#[cfg(unix)]
pub struct Listener {
    socket: PathBuf,
    pointer: PathBuf,
    cancel: CancellationToken,
}

#[cfg(unix)]
impl Listener {
    /// Bind `activity.sock` in `dir` (made 0700; a link is refused), write the pointer under `root`, and hand each event to
    /// `feed` (which keeps it only while someone listens).
    ///
    /// # Errors
    /// The folder is not a private folder of this user's, another boopis host already listens there, or the socket or the
    /// pointer could not be made (a path too long for a socket among them).
    pub fn start(feed: Arc<Feed>, dir: &Path, root: &Path) -> std::io::Result<Self> {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        if !std::fs::symlink_metadata(dir)?.is_dir() {
            return Err(std::io::Error::other("the socket folder is not a folder"));
        }
        // only the owner may change a folder's mode, so this also proves it is ours
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        let socket = dir.join(SOCKET);
        if std::fs::symlink_metadata(&socket).is_ok() {
            let probe = std::os::unix::net::UnixDatagram::unbound()?;
            if probe.connect(&socket).is_ok() {
                return Err(std::io::Error::other("another boopis host already listens"));
            }
            std::fs::remove_file(&socket)?;
        }
        let sock = tokio::net::UnixDatagram::bind(&socket)?;
        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
        let pointer = match write_pointer(root, &socket) {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_file(&socket);
                return Err(e);
            }
        };
        let cancel = CancellationToken::new();
        tokio::spawn(read(sock, feed, cancel.clone()));
        Ok(Self {
            socket,
            pointer,
            cancel,
        })
    }

    /// The socket's path.
    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }
}

#[cfg(unix)]
async fn read(sock: tokio::net::UnixDatagram, feed: Arc<Feed>, cancel: CancellationToken) {
    let mut buf = vec![0u8; MAX_DATAGRAM + 1];
    loop {
        let got = tokio::select! {
            () = cancel.cancelled() => return,
            got = sock.recv(&mut buf) => got,
        };
        match got {
            Ok(n) => {
                if let Some(event) = parse(&buf[..n]) {
                    feed.on_push(&event);
                }
            }
            Err(e) => {
                tracing::debug!(error = %e, "the activity socket could not be read");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}

#[cfg(unix)]
impl Drop for Listener {
    fn drop(&mut self) {
        self.cancel.cancel();
        let _ = std::fs::remove_file(&self.socket);
        let _ = std::fs::remove_file(&self.pointer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The datagram the plugin's test pins too (`plugins/boopis/tests/test_activity.py`): one shape on both sides.
    const GOLDEN: &str = r#"{"v":1,"session_id":"20261123_090000_ab12cd","kind":"tool.start","tool":"read_file","call":"call-1","args":{"path":"/home/o/repo/shots/03.json"},"profile":"kai"}"#;

    #[test]
    fn the_plugins_event_is_read_field_by_field() {
        let p = parse(GOLDEN.as_bytes()).unwrap();
        assert_eq!(
            p,
            Pushed {
                kind: Kind::ToolStart,
                profile: "kai".into(),
                session_id: "20261123_090000_ab12cd".into(),
                tool: "read_file".into(),
                call: "call-1".into(),
                args: Some(json!({"path": "/home/o/repo/shots/03.json"})),
                failed: false,
                cron: None,
                parked: None,
            }
        );
        let refused = parse(r#"{"v":1,"kind":"rule.refused","profile":"kai","session_id":"s1","tool":"Run a command · git push","rules":["default.git_cloud"],"parked":"0193a4b2-0000-7000-8000-000000000001","cron":"a1b2c3"}"#.as_bytes()).unwrap();
        assert_eq!(
            (
                refused.kind,
                refused.parked.as_deref(),
                refused.tool.as_str()
            ),
            (
                Kind::RuleRefused,
                Some("0193a4b2-0000-7000-8000-000000000001"),
                "Run a command · git push"
            )
        );
        let end = parse(br#"{"v":1,"kind":"turn.end","profile":"moss","session_id":"local-9f","failed":true,"cron":"a1b2c3"}"#)
            .unwrap();
        assert_eq!(
            (end.kind, end.failed, end.cron.as_deref(), end.args),
            (Kind::TurnEnd, true, Some("a1b2c3"), None)
        );
    }

    #[test]
    fn anything_else_is_not_an_event() {
        let long = format!(
            r#"{{"v":1,"kind":"tool.start","profile":"kai","session_id":"s","tool":"t","args":{{"path":"{}"}}}}"#,
            "x".repeat(MAX_DATAGRAM)
        );
        for bad in [
            r#"{"v":2,"kind":"tool.start","profile":"kai","session_id":"s","tool":"t"}"#,
            r#"{"v":1,"kind":"approval.respond","profile":"kai","session_id":"s","tool":"t"}"#,
            r#"{"v":1,"kind":"tool.start","profile":"../x","session_id":"s","tool":"t"}"#,
            r#"{"v":1,"kind":"tool.start","profile":"kai","session_id":"a b","tool":"t"}"#,
            r#"{"v":1,"kind":"tool.start","profile":"kai","session_id":"s","tool":""}"#,
            r#"{"v":1,"kind":"tool.start","profile":"kai","tool":"t"}"#,
            "not json",
            long.as_str(),
        ] {
            assert_eq!(parse(bad.as_bytes()), None, "{bad:.80}");
        }
        let odd = parse(br#"{"v":1,"kind":"tool.start","profile":"kai","session_id":"s","tool":"t","args":"rm -rf /","cron":"a b"}"#)
            .unwrap();
        assert_eq!(
            (odd.args, odd.cron),
            (None, None),
            "only an object, only an id"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_socket_is_private_its_pointer_names_it_and_an_event_reaches_presence() {
        use std::collections::HashMap;
        use std::os::unix::fs::PermissionsExt;

        use crate::config::ApiLimits;
        use crate::local_api::audit::Audit;
        use crate::local_api::look::look_for;
        use crate::local_api::model::{Source, State};
        use crate::local_api::presence::{Live, Status};
        use crate::local_api::roster::Entry;

        let dir = tempfile::tempdir().unwrap();
        let (socks, root) = (dir.path().join("run"), dir.path().join("engine"));
        let feed = Feed::new(Audit::under(dir.path()), ApiLimits::default());
        feed.set_roster(vec![Entry {
            name: "kai".into(),
            display_name: "Kai".into(),
            role: String::new(),
            model: None,
            provider: None,
            look: look_for("Kai"),
            known_to_boopis: true,
            governed: false,
        }]);
        let _reader = feed.consumer();
        let member = Live {
            session_id: "20261123_090000_ab12cd".into(),
            status: Status::Working,
            source: Source::Room,
            summary: None,
        };
        feed.on_poll("kai", &[member], &HashMap::new());
        let l = Listener::start(feed.clone(), &socks, &root).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let pointer = root.join("boopis").join("activity.json");
        assert_eq!(
            (mode(&socks), mode(l.socket()), mode(&pointer)),
            (0o700, 0o600, 0o600)
        );
        let named: Value =
            serde_json::from_str(&std::fs::read_to_string(&pointer).unwrap()).unwrap();
        assert_eq!(named, json!({"v": 1, "socket": l.socket()}));
        let tx = std::os::unix::net::UnixDatagram::unbound().unwrap();
        tx.send_to(b"not an event", l.socket()).unwrap();
        tx.send_to(GOLDEN.as_bytes(), l.socket()).unwrap();
        let kai = || {
            feed.presence()
                .into_iter()
                .find(|p| p.profile == "kai")
                .unwrap()
        };
        for _ in 0..200 {
            if kai().activity == "read_file" {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let p = kai();
        assert_eq!(
            (p.state, p.detail.as_deref(), p.source),
            (
                State::Working,
                Some("Read a file · shots/03.json"),
                Some(Source::Room)
            )
        );
        assert!(
            Listener::start(feed.clone(), &socks, &root).is_err(),
            "a second host does not take the socket over"
        );
        let socket = l.socket().to_owned();
        drop(l);
        assert!(
            !socket.exists() && !pointer.exists(),
            "nothing is left behind"
        );
    }
}
