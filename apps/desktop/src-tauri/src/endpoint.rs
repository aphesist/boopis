//! The endpoint abstraction (ADR-0018): how the host reaches *a* gateway. The proxy and the UI never know which kind
//! they talk to. `Local` is implemented; `Remote` and `Cloud` are typed variants that answer
//! `hx.engine.unavailable` ("not yet supported") until phase 2.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use serde::Serialize;
use specta::Type;

use crate::config::Limits;
use crate::error::{Error, Result};
use crate::gateway::link::GatewayConn;
use crate::gateway::ws;
use crate::hermes::Supervisor;

/// Which kind of endpoint (for status displays; the proxy does not branch on it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EndpointKind {
    /// The Hermes on this machine: `ensure` and `attach`.
    Local,
    /// A home on another machine: a URL and a device token.
    Remote,
    /// A cloud session: a control plane and a session.
    Cloud,
}

/// A way to reach a gateway.
#[async_trait]
pub trait Endpoint: Send + Sync {
    /// Which kind this is.
    fn kind(&self) -> EndpointKind;

    /// Open a link to the gateway (a fresh ticket each call) and return it.
    async fn connect(&self) -> Result<GatewayConn>;
}

/// A token that never prints.
#[derive(Clone, PartialEq, Eq)]
pub struct Redacted(pub String);

impl fmt::Debug for Redacted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<redacted>")
    }
}

/// The endpoint a profile uses. A remote token lives in the keychain, never in settings; this value carries it only
/// while a connection is made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointConfig {
    /// This machine's Hermes, for a profile (`None` is the active, default one).
    Local {
        /// The Hermes profile.
        profile: Option<String>,
    },
    /// A gateway on another machine.
    Remote {
        /// Its URL.
        url: String,
        /// The device token.
        token: Redacted,
    },
    /// A cloud session (`docs/CLOUD.md`).
    Cloud {
        /// The control plane's URL.
        control_plane: String,
        /// The session id.
        session: String,
    },
}

impl EndpointConfig {
    /// Build the endpoint. `Local` needs the supervisor.
    ///
    /// # Errors
    /// `InvalidInput` for a bad profile name.
    pub fn build(self, supervisor: &Arc<Supervisor>, limits: &Limits) -> Result<Arc<dyn Endpoint>> {
        Ok(match self {
            Self::Local { profile } => {
                let home = supervisor.environment().profile_home(profile.as_deref())?;
                Arc::new(Local {
                    supervisor: supervisor.clone(),
                    home,
                    limits: limits.clone(),
                })
            }
            Self::Remote { url, token } => Arc::new(Remote { url, token }),
            Self::Cloud {
                control_plane,
                session,
            } => Arc::new(Cloud {
                control_plane,
                session,
            }),
        })
    }
}

/// The Hermes on this machine.
pub struct Local {
    supervisor: Arc<Supervisor>,
    home: PathBuf,
    limits: Limits,
}

impl Local {
    /// The Hermes of `home` on this machine.
    #[must_use]
    pub fn new(supervisor: Arc<Supervisor>, home: PathBuf, limits: Limits) -> Self {
        Self {
            supervisor,
            home,
            limits,
        }
    }
}

#[async_trait]
impl Endpoint for Local {
    fn kind(&self) -> EndpointKind {
        EndpointKind::Local
    }

    async fn connect(&self) -> Result<GatewayConn> {
        let started = Instant::now();
        self.supervisor.ensure_if_needed(&self.home).await?;
        let dial = self.supervisor.attach(&self.home).await?;
        let mut conn = ws::dial(
            &dial,
            self.limits.max_inbound_frame,
            self.limits.cli_timeout,
        )
        .await?;
        conn.attach = started.elapsed();
        Ok(conn)
    }
}

/// Where the app's own links wait before they dial. It is closed while the host puts this app's code in place for the
/// gateway (`setup::update`): a link that dialed in between would start a gateway on the code being replaced. Open
/// otherwise, and opened again however the update ends ([`Closed`] opens it when dropped).
#[derive(Clone, Debug)]
pub struct Gate(Arc<tokio::sync::watch::Sender<bool>>);

impl Default for Gate {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::watch::channel(true).0))
    }
}

impl Gate {
    /// Close the gate until the returned guard is dropped.
    #[must_use]
    pub fn close(&self) -> Closed {
        self.0.send_replace(false);
        Closed(self.clone())
    }

    /// Whether links may dial now.
    #[must_use]
    pub fn is_open(&self) -> bool {
        *self.0.borrow()
    }

    /// Wait until links may dial.
    pub async fn wait(&self) {
        let mut rx = self.0.subscribe();
        // The sender lives in `self`, so the channel cannot close while this waits.
        let _ = rx.wait_for(|open| *open).await;
    }
}

/// The gate held closed; dropping this opens it again.
#[derive(Debug)]
pub struct Closed(Gate);

impl Drop for Closed {
    fn drop(&mut self) {
        self.0.0.send_replace(true);
    }
}

/// An endpoint whose links wait at a [`Gate`] before they dial.
pub struct Gated {
    inner: Arc<dyn Endpoint>,
    gate: Gate,
}

impl Gated {
    /// `inner`, waiting at `gate`.
    #[must_use]
    pub fn new(inner: Arc<dyn Endpoint>, gate: Gate) -> Self {
        Self { inner, gate }
    }
}

#[async_trait]
impl Endpoint for Gated {
    fn kind(&self) -> EndpointKind {
        self.inner.kind()
    }

    async fn connect(&self) -> Result<GatewayConn> {
        self.gate.wait().await;
        self.inner.connect().await
    }
}

/// A gateway on another machine. Not yet supported.
#[derive(Debug)]
pub struct Remote {
    url: String,
    token: Redacted,
}

#[async_trait]
impl Endpoint for Remote {
    fn kind(&self) -> EndpointKind {
        EndpointKind::Remote
    }

    async fn connect(&self) -> Result<GatewayConn> {
        let _ = (&self.url, &self.token);
        Err(Error::Unavailable(
            "remote endpoints are not yet supported".into(),
        ))
    }
}

/// A cloud session. Not yet supported.
#[derive(Debug)]
pub struct Cloud {
    control_plane: String,
    session: String,
}

#[async_trait]
impl Endpoint for Cloud {
    fn kind(&self) -> EndpointKind {
        EndpointKind::Cloud
    }

    async fn connect(&self) -> Result<GatewayConn> {
        let _ = (&self.control_plane, &self.session);
        Err(Error::Unavailable(
            "cloud sessions are not yet supported".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hermes::Environment;

    fn supervisor() -> Arc<Supervisor> {
        let env = Environment {
            hermes_home: Some("/nonexistent-hermes".into()),
            ..Environment::default()
        };
        Arc::new(Supervisor::new(env, Limits::default()))
    }

    #[tokio::test]
    async fn remote_and_cloud_are_typed_but_unavailable() {
        let sup = supervisor();
        let remote = EndpointConfig::Remote {
            url: "https://home.example".into(),
            token: Redacted("tok".into()),
        }
        .build(&sup, &Limits::default())
        .unwrap();
        assert_eq!(remote.kind(), EndpointKind::Remote);
        let err = remote.connect().await.err().unwrap();
        assert_eq!(err.code(), "hx.engine.unavailable");
        assert!(err.to_string().contains("not yet supported"));
        let cloud = EndpointConfig::Cloud {
            control_plane: "https://cp.example".into(),
            session: "s1".into(),
        }
        .build(&sup, &Limits::default())
        .unwrap();
        assert_eq!(cloud.kind(), EndpointKind::Cloud);
        let err = cloud.connect().await.err().unwrap();
        assert_eq!(err.code(), "hx.engine.unavailable");
    }

    #[test]
    fn local_builds_for_a_valid_profile_only() {
        let sup = supervisor();
        let ok = EndpointConfig::Local {
            profile: Some("nina".into()),
        }
        .build(&sup, &Limits::default())
        .unwrap();
        assert_eq!(ok.kind(), EndpointKind::Local);
        assert!(
            EndpointConfig::Local {
                profile: Some("../x".into())
            }
            .build(&sup, &Limits::default())
            .is_err()
        );
    }

    #[test]
    fn a_remote_token_never_prints() {
        let c = EndpointConfig::Remote {
            url: "https://h".into(),
            token: Redacted("s3cret-token".into()),
        };
        assert!(!format!("{c:?}").contains("s3cret"));
    }

    #[tokio::test]
    async fn a_link_waits_at_a_closed_gate_and_dials_once_it_opens() {
        struct Counting(std::sync::atomic::AtomicU32);
        #[async_trait]
        impl Endpoint for Counting {
            fn kind(&self) -> EndpointKind {
                EndpointKind::Local
            }
            async fn connect(&self) -> Result<GatewayConn> {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Err(Error::Unavailable("counted".into()))
            }
        }
        let inner = Arc::new(Counting(std::sync::atomic::AtomicU32::new(0)));
        let gate = Gate::default();
        let gated = Arc::new(Gated::new(inner.clone(), gate.clone()));
        let closed = gate.close();
        assert!(!gate.is_open());
        let dial = tokio::spawn({
            let gated = gated.clone();
            async move { gated.connect().await.err().map(|e| e.to_string()) }
        });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert_eq!(
            inner.0.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "nothing dials while it is closed"
        );
        drop(closed);
        assert!(dial.await.unwrap().unwrap().contains("counted"));
        assert_eq!(inner.0.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(gate.is_open());
        // a guard dropped on any path (an update that fails or panics) opens it too
        let again = gate.close();
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _held = again;
            panic!("an update that panics");
        }))
        .unwrap_err();
        assert!(gate.is_open());
    }

    #[tokio::test]
    async fn local_without_hermes_is_unavailable() {
        let sup = supervisor();
        let local = EndpointConfig::Local { profile: None }
            .build(&sup, &Limits::default())
            .unwrap();
        let err = local.connect().await.err().unwrap();
        assert_eq!(err.code(), "hx.engine.unavailable");
    }
}
