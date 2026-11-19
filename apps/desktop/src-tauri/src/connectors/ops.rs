//! What the connector flow asks of Hermes, behind a trait. Hermes owns MCP configuration and tokens, so the real
//! implementation uses Hermes's own mechanisms only: the gateway's `mcp.servers.*` methods (list, status, add, test, and the
//! OAuth flow with its own loopback listener and token store) and its CLI (`hermes config set|get|unset`, `hermes mcp remove`).
//! Nothing here opens `config.yaml` or the token folder. Tests use an in-memory double.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use specta::Type;

use crate::endpoint::Local;
use crate::error::{Error, Result};
use crate::gateway::oneshot::Link;
use crate::hermes::Supervisor;

/// One MCP server as Hermes reports it: its configuration without secret values, and its runtime state.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq, Default)]
#[serde(rename = "ConnectorInfo")]
pub struct Installed {
    /// The name in `mcp_servers`.
    pub name: String,
    /// `stdio`, `http` or `sse`, as Hermes says it.
    pub transport: String,
    /// The URL of a remote server.
    pub url: Option<String>,
    /// The program of a local one.
    pub command: Option<String>,
    /// Its arguments.
    pub args: Vec<String>,
    /// The names of its environment variables (Hermes never lists the values).
    pub env: Vec<String>,
    /// `oauth` when it signs in through Hermes.
    pub auth: Option<String>,
    /// Whether Hermes holds OAuth tokens for it; `None` when it does not use OAuth.
    pub oauth_tokens_present: Option<bool>,
    /// Whether it is switched on.
    pub enabled: bool,
    /// The plugin that provides it, when one does (then it cannot be changed here).
    pub plugin: Option<String>,
    /// `connected`, `disabled`, `connecting`, `failed`, `lazy`, `configured` or `unknown`.
    pub status: String,
    /// How many tools it has, when Hermes knows.
    pub tools: Option<u32>,
    /// Hermes parked it on a rejected sign-in.
    pub needs_auth: bool,
    /// The keychain references boopis holds for it (`secret://connector.<name>/...`), never values.
    pub secrets: Vec<String>,
}

/// One tool a server offers.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename = "ConnectorTool")]
pub struct ToolInfo {
    /// Its name.
    pub name: String,
    /// What it says it does.
    pub description: String,
}

/// What a connection test found. The error text is Hermes's, with credentials already masked by Hermes.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename = "ConnectorTest")]
pub struct TestReport {
    /// It connected and listed its tools.
    pub ok: bool,
    /// The tools.
    pub tools: Vec<ToolInfo>,
    /// Why not.
    pub error: Option<String>,
    /// Prompts, when counted.
    pub prompts: Option<u32>,
    /// Resources, when counted.
    pub resources: Option<u32>,
    /// The server uses OAuth.
    pub oauth_needed: bool,
    /// Hermes holds no token for it yet.
    pub signin_needed: bool,
}

/// A sign-in Hermes began.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthStart {
    /// Hermes's id for the flow.
    pub session_id: String,
    /// The page the user signs in on.
    pub auth_url: String,
}

/// Where a sign-in stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthPoll {
    /// Waiting for the browser.
    Pending,
    /// The tokens are saved in Hermes's store; the tools it found.
    Approved(Vec<String>),
    /// It failed or was cancelled; Hermes's reason.
    Failed(String),
}

/// Hermes, as the connector flow needs it.
#[async_trait]
pub trait McpOps: Send + Sync {
    /// Every server, configured and plugin-provided.
    async fn list(&self) -> Result<Vec<Installed>>;
    /// Add a server (`mcp.servers.add`); Hermes validates it again and refuses a duplicate or a plugin's name.
    async fn add(&self, name: &str, config: &Value) -> Result<()>;
    /// Connect, list the tools, disconnect (`mcp.servers.test`).
    async fn test(&self, name: &str) -> Result<TestReport>;
    /// Remove a server and, for an OAuth one, its tokens (`hermes mcp remove`).
    async fn remove(&self, name: &str) -> Result<()>;
    /// Switch a server on or off (`hermes config set mcp_servers.<name>.enabled`).
    async fn set_enabled(&self, name: &str, enabled: bool) -> Result<()>;
    /// A configuration value (`hermes config get`), `None` when unset.
    async fn config_get(&self, key: &str) -> Result<Option<Value>>;
    /// Set a configuration value.
    async fn config_set(&self, key: &str, value: &str) -> Result<()>;
    /// Remove a configuration value; one that is not set is not an error.
    async fn config_unset(&self, key: &str) -> Result<()>;
    /// Stop the gateway and start it again, so it reads its secret sources.
    async fn restart_gateway(&self) -> Result<()>;
    /// Begin Hermes's own OAuth flow (`mcp.servers.oauth.start`): Hermes listens on loopback itself.
    async fn oauth_start(&self, name: &str) -> Result<OAuthStart>;
    /// Ask how the flow stands.
    async fn oauth_poll(&self, name: &str, session_id: &str) -> Result<OAuthPoll>;
    /// Cancel it, which closes Hermes's listener.
    async fn oauth_cancel(&self, name: &str, session_id: &str) -> Result<()>;
}

/// The real thing: Hermes's gateway (a short link per question) and its CLI.
pub struct GatewayMcp {
    sup: Arc<Supervisor>,
    home: PathBuf,
}

impl GatewayMcp {
    /// Ops for the profile whose home is `home`.
    #[must_use]
    pub fn new(sup: Arc<Supervisor>, home: PathBuf) -> Self {
        Self { sup, home }
    }

    async fn link(&self) -> Result<Link> {
        let limits = self.sup.limits();
        let endpoint = Local::new(self.sup.clone(), self.home.clone(), limits.clone());
        // A cold `npx` start inside `mcp.servers.test` can take a while; Hermes bounds it with its own connect timeout.
        Link::open(
            &endpoint,
            false,
            limits.max_inbound_frame,
            limits.ensure_timeout + limits.cli_timeout,
        )
        .await
    }

    async fn run(&self, args: &[&str]) -> Result<crate::hermes::cli::Output> {
        let info = self.sup.info().await?;
        self.sup
            .cli()
            .run(
                &info.binary,
                &self.home,
                args,
                self.sup.limits().ensure_timeout,
            )
            .await
    }

    /// One call, a Hermes refusal turned into the host's own error.
    async fn ask(&self, method: &str, params: &Value) -> Result<Value> {
        let mut link = self.link().await?;
        match link.call_rpc(method, params).await? {
            Ok(v) => Ok(v),
            Err(f) => Err(refusal(method, f.code, &f.message)),
        }
    }
}

/// Hermes's refusal of a `mcp.servers.*` call, as the host's error (`tui_gateway/methods_tools.py`: 4090 conflict, 4064 not
/// found, 4063 and 4001 a configuration it will not take).
#[must_use]
pub fn refusal(method: &str, code: i64, message: &str) -> Error {
    let msg: String = message
        .chars()
        .filter(|c| !c.is_control())
        .take(400)
        .collect();
    match code {
        4090 if msg.contains("plugin") => Error::Connector("hx.connectors.plugin_owned", msg),
        4090 => Error::Connector("hx.connectors.exists", msg),
        4064 => Error::Connector("hx.connectors.not_found", msg),
        4063 | 4001 => Error::Connector("hx.connectors.rejected", msg),
        _ => Error::Connector("hx.connectors.failed", format!("{method}: {msg}")),
    }
}

fn s(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(s).collect())
        .unwrap_or_default()
}

fn tools_of(v: &Value) -> Vec<ToolInfo> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| {
                    Some(ToolInfo {
                        name: s(&t["name"])?,
                        description: s(&t["description"]).unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Merge `mcp.servers.list` and `mcp.servers.status` rows into [`Installed`].
#[must_use]
pub fn merge_servers(list: &Value, status: &Value) -> Vec<Installed> {
    let rows = list["servers"].as_array().cloned().unwrap_or_default();
    let state = status["servers"].as_array().cloned().unwrap_or_default();
    rows.iter()
        .filter_map(|r| {
            let name = s(&r["name"])?;
            let st = state.iter().find(|x| x["name"] == r["name"]);
            let enabled = r["enabled"].as_bool().unwrap_or(true);
            Some(Installed {
                transport: s(&r["transport"]).unwrap_or_else(|| "stdio".into()),
                url: s(&r["url"]),
                command: s(&r["command"]),
                args: strings(&r["args"]),
                env: strings(&r["env"]),
                auth: s(&r["auth"]),
                oauth_tokens_present: r["oauth_tokens_present"].as_bool(),
                enabled,
                plugin: s(&r["plugin"]),
                status: st
                    .and_then(|x| s(&x["status"]))
                    .unwrap_or_else(|| if enabled { "unknown" } else { "disabled" }.into()),
                tools: st
                    .and_then(|x| x["tools"].as_u64())
                    .and_then(|n| u32::try_from(n).ok()),
                needs_auth: st.is_some_and(|x| x["needs_auth"] == true),
                secrets: Vec::new(),
                name,
            })
        })
        .collect()
}

/// A `mcp.servers.test` answer as a report.
#[must_use]
pub fn test_report(a: &Value) -> TestReport {
    let tokens_missing = a["oauth_needed"] == true && a["oauth_tokens_present"] != true;
    TestReport {
        ok: a["ok"] == true,
        tools: tools_of(&a["tools"]),
        error: s(&a["error"]).map(|e| {
            e.chars()
                .filter(|c| !c.is_control() || *c == '\n')
                .take(600)
                .collect()
        }),
        prompts: a["prompts"].as_u64().and_then(|n| u32::try_from(n).ok()),
        resources: a["resources"].as_u64().and_then(|n| u32::try_from(n).ok()),
        oauth_needed: a["oauth_needed"] == true,
        signin_needed: tokens_missing,
    }
}

#[async_trait]
impl McpOps for GatewayMcp {
    async fn list(&self) -> Result<Vec<Installed>> {
        let mut link = self.link().await?;
        let list = match link.call_rpc("mcp.servers.list", &json!({})).await? {
            Ok(v) => v,
            Err(f) => return Err(refusal("mcp.servers.list", f.code, &f.message)),
        };
        // The runtime view never connects or starts a sign-in; a Hermes without it still lists its configuration.
        let status = match link.call_rpc("mcp.servers.status", &json!({})).await? {
            Ok(v) => v,
            Err(_) => Value::Null,
        };
        Ok(merge_servers(&list, &status))
    }

    async fn add(&self, name: &str, config: &Value) -> Result<()> {
        self.ask("mcp.servers.add", &json!({"name": name, "config": config}))
            .await
            .map(|_| ())
    }

    async fn test(&self, name: &str) -> Result<TestReport> {
        let a = self.ask("mcp.servers.test", &json!({"name": name})).await?;
        Ok(test_report(&a))
    }

    async fn remove(&self, name: &str) -> Result<()> {
        // The CLI is the path that also drops an OAuth server's tokens (the gateway method only edits the configuration). It
        // asks "Remove server?" and its default, on a closed stdin, is yes; the host then checks the answer from Hermes.
        let out = self.run(&["mcp", "remove", name]).await?;
        let still = self.list().await?.iter().any(|i| i.name == name);
        if still {
            // Fall back to the gateway's own removal (a plugin's server is refused there, in words).
            self.ask("mcp.servers.remove", &json!({"name": name}))
                .await?;
        } else if out.code != 0 {
            tracing::debug!(
                code = out.code,
                "hermes mcp remove exited non-zero, and the server is gone"
            );
        }
        Ok(())
    }

    async fn set_enabled(&self, name: &str, enabled: bool) -> Result<()> {
        let key = format!("mcp_servers.{name}.enabled");
        self.config_set(&key, if enabled { "true" } else { "false" })
            .await
    }

    async fn config_get(&self, key: &str) -> Result<Option<Value>> {
        let out = self.run(&["config", "get", "--json", key]).await?;
        if out.code != 0 {
            return Ok(None);
        }
        serde_json::from_str(out.stdout.trim())
            .map(Some)
            .map_err(|e| Error::Config(format!("hermes config get {key} printed no JSON: {e}")))
    }

    async fn config_set(&self, key: &str, value: &str) -> Result<()> {
        let out = self.run(&["config", "set", key, value]).await?;
        if out.code != 0 {
            let why: String = out
                .stderr
                .lines()
                .chain(out.stdout.lines())
                .last()
                .unwrap_or("")
                .chars()
                .take(200)
                .collect();
            return Err(Error::Connector(
                "hx.connectors.failed",
                format!("hermes refused {key}: {why}"),
            ));
        }
        Ok(())
    }

    async fn config_unset(&self, key: &str) -> Result<()> {
        // `config unset` exits non-zero for "Config key not set", which is what the caller wanted.
        let _ = self.run(&["config", "unset", key]).await?;
        Ok(())
    }

    async fn restart_gateway(&self) -> Result<()> {
        self.sup.restart(&self.home).await.map(|_| ())
    }

    async fn oauth_start(&self, name: &str) -> Result<OAuthStart> {
        let a = self
            .ask("mcp.servers.oauth.start", &json!({"name": name}))
            .await?;
        match (s(&a["session_id"]), s(&a["auth_url"])) {
            (Some(session_id), Some(auth_url)) => Ok(OAuthStart {
                session_id,
                auth_url,
            }),
            _ => Err(Error::Connector(
                "hx.connectors.failed",
                "Hermes began a sign-in and gave no address to open".into(),
            )),
        }
    }

    async fn oauth_poll(&self, name: &str, session_id: &str) -> Result<OAuthPoll> {
        let a = self
            .ask(
                "mcp.servers.oauth.poll",
                &json!({"name": name, "session_id": session_id}),
            )
            .await?;
        Ok(match a["status"].as_str() {
            Some("approved") => OAuthPoll::Approved(
                a["tools"]
                    .as_array()
                    .map(|t| {
                        t.iter()
                            .filter_map(|x| s(&x["name"]).or_else(|| s(x)))
                            .collect()
                    })
                    .unwrap_or_default(),
            ),
            Some("error") => OAuthPoll::Failed(
                s(&a["error_message"]).unwrap_or_else(|| "the sign-in failed".into()),
            ),
            _ => OAuthPoll::Pending,
        })
    }

    async fn oauth_cancel(&self, name: &str, session_id: &str) -> Result<()> {
        let _ = self
            .ask(
                "mcp.servers.oauth.cancel",
                &json!({"name": name, "session_id": session_id}),
            )
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_and_status_rows_merge_by_name() {
        let list = json!({"servers": [
            {"name": "a", "transport": "http", "url": "https://x.example/mcp", "args": [], "env": [], "auth": "oauth",
             "oauth_tokens_present": false, "enabled": true, "source": "config", "plugin": null},
            {"name": "b", "transport": "stdio", "command": "npx", "args": ["-y", "p"], "env": ["K"], "enabled": false, "source": "config"}
        ]});
        let status =
            json!({"servers": [{"name": "a", "tools": 3, "status": "failed", "needs_auth": true}]});
        let m = merge_servers(&list, &status);
        assert_eq!(m.len(), 2);
        assert_eq!(
            (m[0].status.as_str(), m[0].tools, m[0].needs_auth),
            ("failed", Some(3), true)
        );
        assert_eq!(m[0].oauth_tokens_present, Some(false));
        assert_eq!(
            (m[1].status.as_str(), m[1].tools, m[1].enabled),
            ("disabled", None, false)
        );
        assert_eq!(m[1].env, vec!["K"]);
    }

    #[test]
    fn a_test_answer_says_whether_a_sign_in_is_missing() {
        let r = test_report(
            &json!({"ok": false, "error": "OAuth authentication required", "tools": [], "oauth_needed": true, "oauth_tokens_present": false}),
        );
        assert!(!r.ok && r.oauth_needed && r.signin_needed);
        let r = test_report(
            &json!({"ok": true, "tools": [{"name": "t", "description": "d"}], "prompts": 1, "resources": 0, "oauth_needed": false}),
        );
        assert!(r.ok && !r.signin_needed);
        assert_eq!(r.tools[0].name, "t");
    }

    #[test]
    fn hermes_refusals_map_to_stable_codes() {
        assert_eq!(
            refusal("m", 4090, "server 'a' already exists").code(),
            "hx.connectors.exists"
        );
        assert_eq!(
            refusal(
                "m",
                4090,
                "server 'a' is provided by plugin 'p' and cannot be modified"
            )
            .code(),
            "hx.connectors.plugin_owned"
        );
        assert_eq!(
            refusal("m", 4064, "not found").code(),
            "hx.connectors.not_found"
        );
        assert_eq!(
            refusal("m", 4001, "rejected: suspicious").code(),
            "hx.connectors.rejected"
        );
        assert_eq!(refusal("m", 5024, "boom").code(), "hx.connectors.failed");
    }
}
