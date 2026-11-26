//! B47, H4 (`docs/specs/host-protections.md` section 6, ADR-0062): a request that answers for the owner or speaks in the
//! owner's voice is refused when any process holding the client's end of the connection is a bot's.
//!
//! The token proves only that a client read a file, and a bot runs as the owner's user. So before an owner-voice route
//! acts on its body, after the token and `Host` checks, the host asks `boopis-peer` who holds the connection: a
//! descendant of a gateway the host identified, a process started with the engine's launch marker
//! (`BOOPIS_ENGINE_LAUNCH`, which the host puts in the gateway's launch environment), or one in the gateway's own cgroup
//! is a bot's; a connection that cannot be shown to be the owner's is refused the same way (fail closed). Stops and reads
//! stay open: they only reduce activity or say what is there (ADR-0045).
//!
//! The lookup runs on a blocking thread with a deadline (`OWNER_LOOKUP_DEADLINE`); a lookup that does not finish in time
//! refuses. Only Linux can say today: macOS and Windows refuse every owner-voice route, and the owner answers there in the
//! app (the spec's Windows rule, extended to macOS until its socket lookup exists).

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use boopis_peer::{Unproven, Verdict};

use super::wire::Method;
use crate::secrets::PeerPolicy;

/// How long the lookup may take before the request is refused (the spec's 500 ms).
pub const OWNER_LOOKUP_DEADLINE: Duration = Duration::from_millis(500);

/// The refusal's code, the only thing a refused client learns.
pub const REFUSAL_CODE: &str = "owner_surface_unproven";
/// The refusal's words: no detail of the check.
pub const REFUSAL_MESSAGE: &str = "Answer this in boopis.";

/// Who is on the other end of a connection. A trait so the endpoint's tests decide it, and the app asks the system.
pub trait OwnerCheck: Send + Sync {
    /// The verdict for the connection from `client` to `server` (the endpoint's own address). Blocking.
    fn judge(&self, client: SocketAddr, server: SocketAddr) -> Verdict;
}

/// The system's answer, over the gateways the host identified at the engine's control socket.
pub struct SystemCheck {
    peers: Arc<PeerPolicy>,
}

impl SystemCheck {
    /// A check over the gateways `peers` has seen.
    #[must_use]
    pub fn new(peers: Arc<PeerPolicy>) -> Self {
        Self { peers }
    }
}

impl OwnerCheck for SystemCheck {
    fn judge(&self, client: SocketAddr, server: SocketAddr) -> Verdict {
        boopis_peer::judge(
            &boopis_peer::Os,
            &self.peers.engines(),
            std::process::id(),
            client,
            server,
        )
    }
}

/// A fixed answer (the endpoint's tests).
#[cfg(test)]
pub struct Fixed(pub Verdict);

#[cfg(test)]
impl OwnerCheck for Fixed {
    fn judge(&self, _client: SocketAddr, _server: SocketAddr) -> Verdict {
        self.0
    }
}

/// Whether this route answers for the owner or speaks as the owner: an approval's answer, a message to a bot or a room,
/// a retry. Stops and every `GET` are not.
#[must_use]
pub fn owner_voice(method: Method, path: &str) -> bool {
    if method != Method::Post {
        return false;
    }
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    matches!(
        parts.as_slice(),
        ["v1", "approvals", _] | ["v1", "bots", _, "say" | "retry"] | ["v1", "rooms", _, "say"]
    )
}

/// Ask `check` with the deadline: a lookup that does not finish in time, or whose thread fails, is a refusal.
pub async fn judge_within(
    check: Arc<dyn OwnerCheck>,
    client: SocketAddr,
    server: SocketAddr,
    deadline: Duration,
) -> Verdict {
    let work = tokio::task::spawn_blocking(move || check.judge(client, server));
    match tokio::time::timeout(deadline, work).await {
        Ok(Ok(verdict)) => verdict,
        Ok(Err(_)) => Verdict::Unproven(Unproven::Unreadable),
        Err(_) => Verdict::Unproven(Unproven::Timeout),
    }
}

/// The audit's outcome for a refused request: `refused:bot_process:<rule>` or `refused:owner_surface_unproven:<why>`.
#[must_use]
pub fn refusal_outcome(verdict: Verdict) -> String {
    match verdict {
        Verdict::Owner => "allowed".to_owned(),
        Verdict::Bot(rule) => format!("refused:bot_process:{}", rule.word()),
        Verdict::Unproven(why) => format!("refused:{REFUSAL_CODE}:{}", why.word()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_answers_and_the_owner_s_voice_are_owner_voice() {
        for path in [
            "/v1/approvals/a1",
            "/v1/bots/kai/say",
            "/v1/bots/kai/retry",
            "/v1/rooms/g-1/say",
        ] {
            assert!(owner_voice(Method::Post, path), "{path}");
            assert!(!owner_voice(Method::Get, path), "{path}");
        }
        for path in [
            "/v1/bots/kai/stop",
            "/v1/rooms/g-1/stop",
            "/v1/approvals",
            "/v1/bots",
            "/v1/events",
        ] {
            assert!(!owner_voice(Method::Post, path), "{path}");
        }
    }

    #[test]
    fn the_audit_says_which_rule_and_never_a_pid() {
        assert_eq!(
            refusal_outcome(Verdict::Bot(boopis_peer::Rule::Ancestry)),
            "refused:bot_process:ancestry"
        );
        assert_eq!(
            refusal_outcome(Verdict::Unproven(Unproven::Timeout)),
            "refused:owner_surface_unproven:lookup_timeout"
        );
    }

    struct Slow;
    impl OwnerCheck for Slow {
        fn judge(&self, _c: SocketAddr, _s: SocketAddr) -> Verdict {
            std::thread::sleep(Duration::from_millis(300));
            Verdict::Owner
        }
    }

    #[tokio::test]
    async fn a_lookup_past_its_deadline_refuses() {
        let a = SocketAddr::from(([127, 0, 0, 1], 1));
        let got = judge_within(Arc::new(Slow), a, a, Duration::from_millis(20)).await;
        assert_eq!(got, Verdict::Unproven(Unproven::Timeout));
        let got = judge_within(Arc::new(Slow), a, a, Duration::from_secs(5)).await;
        assert_eq!(got, Verdict::Owner);
    }
}
