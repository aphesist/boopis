//! What setup and Settings > Models show of each way: [`ProviderState`], one per way (`provider_list`,
//! `provider_probe_local`, and the answer of every command that changes a way).
//!
//! The UI draws a word from `status` (Connected, No key, Not signed in, Not installed, Running on this computer, Not found,
//! Problem) and a button from `status` and `kind`; `detail` is one plain line (a plan, a count, the reason). Nothing here is a
//! secret: a key is never echoed, not even its tail.

use serde::{Deserialize, Serialize};
use specta::Type;

/// How a way connects, as in the catalogue's `kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum WayKind {
    /// A subscription sign-in.
    Signin,
    /// An API key.
    Key,
    /// A runtime on this computer.
    Local,
    /// An endpoint of the person's own.
    Custom,
}

/// Where a way stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    /// Ready to use: signed in, or a key is in place and was accepted (or not yet checked and nothing says otherwise).
    Connected,
    /// A key way with no key saved.
    NeedsKey,
    /// A sign-in way not signed in.
    SignedOut,
    /// A sign-in way whose program is not on this computer (Claude Code for the Claude subscription). Nothing failed: `install`
    /// says how to get it, and the person checks again after.
    NeedsInstall,
    /// A sign-in is waiting for the person (`signin` holds the page and the code).
    SigningIn,
    /// A runtime on this computer answered the last probe.
    FoundLocal,
    /// A runtime on this computer did not answer the last probe (or was never probed: `checked_at` is then `None`).
    NotFound,
    /// Something is wrong; `code` says what, in the catalogue of `crates/hx-proto/errors.json`.
    Error,
}

/// The page to open and the one-time code to type for a sign-in that waits (not a secret: it only works for the person who
/// types it on the lab's own page).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct SigninCode {
    /// The lab's own page.
    pub verification_url: String,
    /// The code to type there. Empty for a flow whose page does everything (ChatGPT's: the person signs in and allows boopis in
    /// the browser, which comes back to the host by itself), and the card then shows no code.
    pub user_code: String,
    /// When the code lapses, in milliseconds since the Unix epoch.
    #[specta(type = f64)]
    pub expires_at: u64,
}

/// Whether a program is to be installed or brought up to date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InstallKind {
    /// It is not on this computer, or it is there and does not start: the installer puts it (back) in place.
    Install,
    /// It is there and too old: the command updates it.
    Update,
}

/// How to get the program a way runs on, from the program's maker: the one command for this computer's system, where to paste
/// it, and the maker's page about it. The person runs it themselves; boopis never runs an installer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct InstallHint {
    /// Install or update.
    pub kind: InstallKind,
    /// The command, exactly as the maker publishes it (`irm https://claude.ai/install.ps1 | iex`).
    pub command: String,
    /// Where to paste it, as a person names it: `PowerShell`, `Terminal`, `a terminal`.
    pub shell: String,
    /// The maker's own page about installing or updating it.
    pub page: String,
}

/// How a sign-in ended, pushed to every window (`ProviderSigninEvent`), mirroring `ChatgptSigninEvent`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type, tauri_specta::Event)]
pub struct ProviderSigninEvent {
    /// The way that signed in.
    pub way: String,
    /// `signed_in`, `failed`, `cancelled` or `timed_out`.
    pub outcome: String,
    /// What to tell the person, in plain words; empty when signed in.
    pub message: String,
}

/// One way's state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct ProviderState {
    /// The catalogue entry's id (`anthropic`), or `custom` for an endpoint the person added.
    pub provider: String,
    /// The way's id (`anthropic.key`), or `custom.<slug>` for an endpoint the person added.
    pub way: String,
    /// How it connects.
    pub kind: WayKind,
    /// Where it stands.
    pub status: ProviderStatus,
    /// A stable code, present exactly when `status` is `error` (`hx.provider.*`, or `hx.setup.*`, `hx.secrets.*`).
    pub code: Option<String>,
    /// One plain line to show beside the word: the reason for an error, a count, a note. Never a secret.
    pub detail: Option<String>,
    /// The plan a sign-in reports (`Claude Max`, `ChatGPT Plus`), when it does.
    pub plan: Option<String>,
    /// How many models the last check found; `None` when not checked or not known.
    pub models_count: Option<u32>,
    /// The address that answered, for a runtime on this computer or an endpoint.
    pub base_url: Option<String>,
    /// While `status` is `signing_in`: the page to open and the code to type.
    pub signin: Option<SigninCode>,
    /// When it was last checked, in milliseconds since the Unix epoch; `None` when never.
    #[specta(type = f64)]
    pub checked_at: Option<u64>,
    /// How to install or update the program the way runs on, when that is what stands in the way (`needs_install`, or an
    /// error that installing or updating fixes).
    pub install: Option<InstallHint>,
}

impl ProviderState {
    fn base(provider: &str, way: &str, kind: WayKind, status: ProviderStatus) -> Self {
        Self {
            provider: provider.to_owned(),
            way: way.to_owned(),
            kind,
            status,
            code: None,
            detail: None,
            plan: None,
            models_count: None,
            base_url: None,
            signin: None,
            checked_at: None,
            install: None,
        }
    }

    /// Connected.
    #[must_use]
    pub fn connected(provider: &str, way: &str, kind: WayKind) -> Self {
        Self::base(provider, way, kind, ProviderStatus::Connected)
    }

    /// A key way with no key.
    #[must_use]
    pub fn needs_key(provider: &str, way: &str) -> Self {
        Self::base(provider, way, WayKind::Key, ProviderStatus::NeedsKey)
    }

    /// A sign-in way not signed in.
    #[must_use]
    pub fn signed_out(provider: &str, way: &str) -> Self {
        Self::base(provider, way, WayKind::Signin, ProviderStatus::SignedOut)
    }

    /// A sign-in way whose program is not installed, with how to install it.
    #[must_use]
    pub fn needs_install(provider: &str, way: &str, detail: &str, install: InstallHint) -> Self {
        let mut s = Self::base(provider, way, WayKind::Signin, ProviderStatus::NeedsInstall);
        s.detail = Some(detail.to_owned());
        s.install = Some(install);
        s
    }

    /// A sign-in that waits for the person.
    #[must_use]
    pub fn signing_in(provider: &str, way: &str, code: SigninCode) -> Self {
        let mut s = Self::base(provider, way, WayKind::Signin, ProviderStatus::SigningIn);
        s.signin = Some(code);
        s
    }

    /// A runtime on this computer that answered.
    #[must_use]
    pub fn found_local(provider: &str, way: &str, base_url: &str, models: u32) -> Self {
        let mut s = Self::base(provider, way, WayKind::Local, ProviderStatus::FoundLocal);
        s.base_url = Some(base_url.to_owned());
        s.models_count = Some(models);
        s
    }

    /// A runtime on this computer that did not answer.
    #[must_use]
    pub fn not_found(provider: &str, way: &str) -> Self {
        Self::base(provider, way, WayKind::Local, ProviderStatus::NotFound)
    }

    /// Something is wrong, with a stable code.
    #[must_use]
    pub fn error(provider: &str, way: &str, kind: WayKind, code: &str, detail: &str) -> Self {
        let mut s = Self::base(provider, way, kind, ProviderStatus::Error);
        s.code = Some(code.to_owned());
        s.detail = Some(detail.to_owned());
        s
    }

    /// Whether the state keeps its own rule: `code` is set exactly for an error, and starts with `hx.`.
    #[must_use]
    pub fn is_consistent(&self) -> bool {
        match (&self.status, &self.code) {
            (ProviderStatus::Error, Some(c)) => c.starts_with("hx."),
            (ProviderStatus::Error, None) => false,
            (_, code) => code.is_none(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_constructors_keep_the_code_rule() {
        let all = [
            ProviderState::connected("anthropic", "anthropic.signin", WayKind::Signin),
            ProviderState::needs_key("openai", "openai.key"),
            ProviderState::signed_out("openai", "openai.signin"),
            ProviderState::signing_in(
                "xai",
                "xai.signin",
                SigninCode {
                    verification_url: "https://example.com/device".into(),
                    user_code: "ABCD-1234".into(),
                    expires_at: 1,
                },
            ),
            ProviderState::found_local("ollama", "ollama.local", "http://127.0.0.1:11434/v1", 3),
            ProviderState::not_found("vllm", "vllm.local"),
            ProviderState::needs_install(
                "anthropic",
                "anthropic.signin",
                "Claude Code is not installed yet.",
                InstallHint {
                    kind: InstallKind::Install,
                    command: "curl -fsSL https://claude.ai/install.sh | bash".into(),
                    shell: "a terminal".into(),
                    page: "https://code.claude.com/docs/en/setup".into(),
                },
            ),
            ProviderState::error(
                "zai",
                "zai.key",
                WayKind::Key,
                "hx.provider.key_rejected",
                "The key was refused.",
            ),
        ];
        assert!(all.iter().all(ProviderState::is_consistent));
        let mut bad = all[7].clone();
        bad.code = None;
        assert!(!bad.is_consistent());
        let mut bad = all[0].clone();
        bad.code = Some("hx.provider.unreachable".into());
        assert!(!bad.is_consistent());
    }

    #[test]
    fn the_wire_spelling_is_snake_case() {
        let s = ProviderState::needs_key("openai", "openai.key");
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["status"], "needs_key");
        assert_eq!(v["kind"], "key");
        assert_eq!(v["code"], serde_json::Value::Null);
        assert_eq!(
            serde_json::to_value(ProviderStatus::FoundLocal).unwrap(),
            "found_local"
        );
        assert_eq!(
            serde_json::to_value(ProviderStatus::NeedsInstall).unwrap(),
            "needs_install"
        );
        assert_eq!(v["install"], serde_json::Value::Null);
    }
}
