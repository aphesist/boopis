//! The endpoint abstraction (ADR-0018): how the host reaches *a* gateway. The proxy and the UI never know which kind
//! they talk to. `Local` is implemented; `Remote` and `Cloud` are typed variants that answer
//! `hx.hermes.unavailable` ("not yet supported") until phase 2.

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
        assert_eq!(err.code(), "hx.hermes.unavailable");
        assert!(err.to_string().contains("not yet supported"));
        let cloud = EndpointConfig::Cloud {
            control_plane: "https://cp.example".into(),
            session: "s1".into(),
        }
        .build(&sup, &Limits::default())
        .unwrap();
        assert_eq!(cloud.kind(), EndpointKind::Cloud);
        let err = cloud.connect().await.err().unwrap();
        assert_eq!(err.code(), "hx.hermes.unavailable");
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
    async fn local_without_hermes_is_unavailable() {
        let sup = supervisor();
        let local = EndpointConfig::Local { profile: None }
            .build(&sup, &Limits::default())
            .unwrap();
        let err = local.connect().await.err().unwrap();
        assert_eq!(err.code(), "hx.hermes.unavailable");
    }
}
