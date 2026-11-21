//! Connectors: MCP servers installed from the curated collection (`docs/CONNECTORS.md`), by URL or by command, through forms
//! (`docs/FORMS.md` kinds `connector` and `signin`). Hermes owns MCP configuration and tokens; the host drives Hermes's own
//! mechanisms (the gateway's `mcp.servers.*` methods and its CLI), validates every input first, keeps keys in the OS keychain
//! and gives them to Hermes by reference (the secret source of `docs/FORMS.md` section 3), and never writes a file of
//! Hermes's.
//!
//! - [`validate`]: names, URLs, commands, arguments, environment, headers, and the sign-in address (all untrusted).
//! - [`catalog`]: the collection as data.
//! - [`plan`]: a request to exactly what will be added (config, keys, diff, rows, hash) and the forms that ask for it.
//! - [`ops`]: Hermes behind a trait.
//! - [`engine`]: install, test, enable, remove, sign in (Hermes's OAuth), and a provider's own `login` command.

pub mod catalog;
pub mod engine;
pub mod logins;
pub mod ops;
pub mod plan;
pub mod validate;

#[cfg(test)]
mod tests;

pub use engine::{
    Engine, GOVERNED_ALLOWLIST, InstallReport, LoginReport, Opener, Planner, RemoveReport,
    RestartDone, RestartWhen, SignInReport,
};
pub use ops::{GatewayMcp, Installed, McpOps, TestReport, ToolInfo};
pub use plan::{Request, Review, SourceKind};
