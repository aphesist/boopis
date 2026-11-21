//! The sign-in ways the host owns, behind the contract's four commands (`provider_signin_start`, `provider_signin_cancel`,
//! `provider_sign_out`, `provider_signin_status`): ChatGPT through OpenAI's program (`crate::chatgpt`, ADR-0030) and GitHub
//! Copilot (`crate::copilot`, ADR-0039) and SuperGrok (`crate::xai`, ADR-0039). A way somebody else owns (Claude's is Claude Code's own) answers
//! `hx.provider.unsupported`; an id the catalogue does not hold answers `hx.provider.unknown`. Another sign-in the host
//! comes to own is one more arm in each function here.
//!
//! The states drawn here are the ones [`states`] returns for `provider_list` to include.

use std::sync::Arc;

use super::{ProviderState, SigninCode, WayKind, catalogue};
use crate::chatgpt::{self, ChatGpt};
use crate::copilot::{self, Copilot};
use crate::error::{Error, Result};
use crate::xai::{self, Xai, cli::GrokCli};

/// The ChatGPT way's id in the catalogue.
pub const CHATGPT: &str = "openai.signin";
/// The Copilot way's id in the catalogue.
pub const COPILOT: &str = copilot::WAY;
/// The SuperGrok way's id in the catalogue.
pub const XAI: &str = xai::WAY_SIGNIN;

/// The services behind the ways.
pub struct Signins {
    /// ChatGPT's sign-in.
    pub chatgpt: Arc<ChatGpt>,
    /// Copilot's sign-in.
    pub copilot: Arc<Copilot>,
    /// SuperGrok's sign-in.
    pub xai: Arc<Xai>,
    /// The user's own `grok` program, which `xai.cli` reports on.
    pub grok: Arc<dyn GrokCli>,
}

enum Owned {
    ChatGpt,
    Copilot,
    Xai,
}

fn owned(way: &str) -> Result<Owned> {
    match way {
        CHATGPT => Ok(Owned::ChatGpt),
        COPILOT => Ok(Owned::Copilot),
        XAI => Ok(Owned::Xai),
        other if catalogue().way(other).is_some() => Err(Error::Provider(
            "hx.provider.unsupported",
            format!("{other} is not a sign-in boopis runs itself"),
        )),
        other => Err(Error::Provider(
            "hx.provider.unknown",
            format!("{other} is not a way boopis knows"),
        )),
    }
}

fn title(plan: &str) -> String {
    let mut c = plan.chars();
    c.next()
        .map_or_else(String::new, |f| f.to_uppercase().chain(c).collect())
}

fn chatgpt_state(s: &chatgpt::Status) -> ProviderState {
    let id = ("openai", CHATGPT);
    match (s.state, &s.code) {
        (chatgpt::State::SigningIn, Some(code)) => ProviderState::signing_in(
            id.0,
            id.1,
            SigninCode {
                verification_url: code.verification_url.clone(),
                user_code: code.user_code.clone(),
                expires_at: code.expires_at,
            },
        ),
        (chatgpt::State::SignedIn, _) => {
            let mut st = ProviderState::connected(id.0, id.1, WayKind::Signin);
            st.plan = s.plan.as_deref().map(|p| format!("ChatGPT {}", title(p)));
            st.detail = s.notice.clone().or_else(|| s.account.clone());
            st
        }
        _ => {
            let mut st = ProviderState::signed_out(id.0, id.1);
            st.detail.clone_from(&s.notice);
            st
        }
    }
}

fn copilot_state(s: &copilot::Status) -> ProviderState {
    let id = ("github-copilot", COPILOT);
    match (s.state, &s.code) {
        (copilot::State::SigningIn, Some(code)) => ProviderState::signing_in(
            id.0,
            id.1,
            SigninCode {
                verification_url: code.verification_url.clone(),
                user_code: code.user_code.clone(),
                expires_at: code.expires_at,
            },
        ),
        (copilot::State::SignedIn, _) => {
            let mut st = ProviderState::connected(id.0, id.1, WayKind::Signin);
            st.detail.clone_from(&s.account);
            st
        }
        _ => {
            let mut st = ProviderState::signed_out(id.0, id.1);
            st.detail.clone_from(&s.notice);
            st
        }
    }
}

impl Signins {
    /// Where a way stands, from the keychain and the flow in progress. Changes nothing.
    ///
    /// # Errors
    /// `hx.provider.unknown`, `hx.provider.unsupported`, `hx.secrets.*`.
    pub async fn status(&self, way: &str) -> Result<ProviderState> {
        Ok(match owned(way)? {
            Owned::ChatGpt => chatgpt_state(&self.chatgpt.status().await?),
            Owned::Copilot => copilot_state(&self.copilot.status().await?),
            Owned::Xai => self.xai.provider_state().await?,
        })
    }

    /// The states of every sign-in way the host reads, for `provider_list`: ChatGPT's, Copilot's, and xAI's ways from
    /// [`Xai::way_states`] (`xai.signin`, `xai.key` as `xai_key` says, and `xai.cli`, which is left out while the sign-in is
    /// in use). The caller picks the ones it lists by their way id.
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn states(&self, xai_key: ProviderState) -> Result<Vec<ProviderState>> {
        let mut out = vec![
            chatgpt_state(&self.chatgpt.status().await?),
            copilot_state(&self.copilot.status().await?),
        ];
        out.extend(self.xai.way_states(xai_key, self.grok.as_ref()).await?);
        Ok(out)
    }

    /// Start a sign-in: the page to open (and the code to type, for a flow that has one; empty for ChatGPT's, whose page does
    /// everything). The wait runs in the host and ends with a `ProviderSigninEvent`.
    ///
    /// # Errors
    /// `hx.provider.unknown`, `hx.provider.unsupported`, `hx.provider.unreachable`, `hx.secrets.*`, `hx.signin.*`.
    pub async fn start(&self, way: &str) -> Result<SigninCode> {
        Ok(match owned(way)? {
            Owned::ChatGpt => {
                let c = self.chatgpt.start().await?;
                SigninCode {
                    verification_url: c.verification_url,
                    user_code: c.user_code,
                    expires_at: c.expires_at,
                }
            }
            Owned::Copilot => {
                let c = self.copilot.start().await?;
                SigninCode {
                    verification_url: c.verification_url,
                    user_code: c.user_code,
                    expires_at: c.expires_at,
                }
            }
            Owned::Xai => self.xai.start().await?.into(),
        })
    }

    /// Cancel the sign-in that is waiting for `way`.
    ///
    /// # Errors
    /// `hx.provider.unknown`, `hx.provider.unsupported`.
    pub fn cancel(&self, way: &str) -> Result<()> {
        match owned(way)? {
            Owned::ChatGpt => self.chatgpt.cancel(),
            Owned::Copilot => self.copilot.cancel(),
            Owned::Xai => self.xai.cancel(),
        }
        Ok(())
    }

    /// Sign out of `way`: its tokens leave the keychain and the engine's copy is dropped. Returns the state afterwards; when
    /// OpenAI did not confirm ending a ChatGPT session, `detail` says so.
    ///
    /// # Errors
    /// `hx.provider.unknown`, `hx.provider.unsupported`, `hx.secrets.*`.
    pub async fn sign_out(&self, way: &str) -> Result<ProviderState> {
        match owned(way)? {
            Owned::ChatGpt => {
                let done = self.chatgpt.sign_out().await?;
                let mut st = chatgpt_state(&self.chatgpt.status().await?);
                if !done.revoked {
                    st.detail = Some(
                        "Signed out here. OpenAI did not confirm ending the session, so you can also disconnect boopis in ChatGPT's settings.".into(),
                    );
                }
                Ok(st)
            }
            Owned::Copilot => {
                self.copilot.sign_out().await?;
                let mut st = copilot_state(&self.copilot.status().await?);
                st.detail = Some(
                    "Signed out here. To remove boopis's access on GitHub too, remove it at github.com/settings/applications.".into(),
                );
                Ok(st)
            }
            Owned::Xai => {
                self.xai.sign_out().await?;
                self.xai.provider_state().await
            }
        }
    }
}

/// The doubles the tests of this module and of the provider list share: services over an in-memory keychain that never reach the
/// network and a `grok` program that is not installed.
#[cfg(test)]
pub(crate) mod fakes {
    use std::time::Duration;

    use super::*;
    use crate::chatgpt::oauth::Https;
    use crate::secrets::store::MemoryStore;

    /// A way out that never reaches the network: signing out tells xAI to forget the refresh token, and a test must not.
    pub(crate) struct Offline;

    impl crate::chatgpt::oauth::Transport for Offline {
        fn post(
            &self,
            _: &str,
            _: &str,
            _: &str,
        ) -> std::result::Result<crate::chatgpt::oauth::Reply, String> {
            Err("offline".to_owned())
        }
    }

    /// A `grok` program that is not installed, so `xai.cli` says so without looking at this computer.
    pub(crate) struct NoGrok;

    #[async_trait::async_trait]
    impl GrokCli for NoGrok {
        async fn probe(&self) -> xai::cli::Probe {
            xai::cli::assess(false, None, None)
        }
    }

    pub(crate) fn signins(store: &Arc<MemoryStore>) -> Signins {
        let http = Arc::new(Https::new(Duration::from_secs(1)));
        Signins {
            chatgpt: Arc::new(ChatGpt::new(
                store.clone(),
                http.clone(),
                chatgpt::Timing {
                    signin: Duration::from_mins(15),
                    refresh_ahead: Duration::from_mins(30),
                    refresh_every: Duration::from_mins(5),
                },
            )),
            copilot: Arc::new(Copilot::new(
                store.clone(),
                http.clone(),
                copilot::Timing {
                    signin: Duration::from_mins(15),
                },
            )),
            xai: Arc::new(Xai::new(
                store.clone(),
                Arc::new(Offline),
                xai::Timing::app(),
            )),
            grok: Arc::new(NoGrok),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fakes::signins;
    use super::*;
    use crate::providers::ProviderStatus;
    use crate::secrets::SecretStore;
    use crate::secrets::store::MemoryStore;

    #[test]
    fn the_owned_ways_are_in_the_catalogue_and_the_rest_are_answered_plainly() {
        for way in [CHATGPT, COPILOT, XAI] {
            let (_, w) = catalogue().way(way).expect(way);
            assert_eq!(w.kind, WayKind::Signin);
        }
        // the way's engine provider is what the plugins hand the tokens to
        assert_eq!(
            catalogue().way(CHATGPT).unwrap().1.engine.as_deref(),
            Some("openai-codex")
        );
        assert_eq!(
            catalogue().way(COPILOT).unwrap().1.engine.as_deref(),
            Some("copilot")
        );
        let store = Arc::new(MemoryStore::default());
        let s = signins(&store);
        assert_eq!(
            s.cancel("anthropic.signin").unwrap_err().code(),
            "hx.provider.unsupported"
        );
        assert_eq!(
            s.cancel("nope.way").unwrap_err().code(),
            "hx.provider.unknown"
        );
        assert!(
            s.cancel(CHATGPT).is_ok() && s.cancel(COPILOT).is_ok() && s.cancel(XAI).is_ok(),
            "cancelling nothing is fine"
        );
    }

    #[tokio::test]
    async fn a_state_is_drawn_from_the_keychain_for_each_way() {
        let store = Arc::new(MemoryStore::default());
        let s = signins(&store);
        let key = ProviderState::needs_key("xai", xai::WAY_KEY);
        let all = s.states(key.clone()).await.unwrap();
        let ways: Vec<&str> = all.iter().map(|a| a.way.as_str()).collect();
        assert_eq!(
            ways,
            [
                CHATGPT,
                COPILOT,
                xai::WAY_SIGNIN,
                xai::WAY_KEY,
                xai::WAY_CLI
            ],
            "every sign-in, xAI's three ways in the catalogue's order, the program included while the sign-in is unused"
        );
        assert!(all.iter().all(ProviderState::is_consistent));
        assert!(
            all.iter()
                .filter(|a| a.way != xai::WAY_KEY && a.way != xai::WAY_CLI)
                .all(|a| a.status == ProviderStatus::SignedOut)
        );

        // signed in to SuperGrok: its state is Connected and the program's way is not offered
        store.set("boopis.xai", xai::ACCESS, "xat_x").unwrap();
        store.set("boopis.xai", xai::REFRESH, "xrt_x").unwrap();
        let st = s.status(XAI).await.unwrap();
        assert_eq!(st.status, ProviderStatus::Connected);
        let all = s.states(key).await.unwrap();
        assert!(all.iter().all(|a| a.way != xai::WAY_CLI));
        store.delete("boopis.xai", xai::ACCESS).unwrap();
        store.delete("boopis.xai", xai::REFRESH).unwrap();

        store
            .set("boopis.copilot", "github_token", "ghu_x")
            .unwrap();
        store
            .set("boopis.copilot", "account", r#"{"login":"octocat"}"#)
            .unwrap();
        let st = s.status(COPILOT).await.unwrap();
        assert_eq!(
            (st.status, st.detail.as_deref()),
            (ProviderStatus::Connected, Some("octocat"))
        );

        // a sign-in from before the program is cut off: it is signed out, with the one notice and Sign in on offer
        store.set("boopis.chatgpt", "access_token", "a").unwrap();
        store.set("boopis.chatgpt", "refresh_token", "r").unwrap();
        let st = s.status(CHATGPT).await.unwrap();
        assert_eq!(st.status, ProviderStatus::SignedOut);
        assert!(st.detail.unwrap().contains("Sign in with ChatGPT"));
        assert!(
            store
                .get("boopis.chatgpt", "access_token")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            s.status("anthropic.signin").await.unwrap_err().code(),
            "hx.provider.unsupported"
        );
    }

    #[tokio::test]
    async fn signing_out_returns_the_state_afterwards_and_says_what_was_not_confirmed() {
        let store = Arc::new(MemoryStore::default());
        let s = signins(&store);
        store
            .set("boopis.copilot", "github_token", "ghu_x")
            .unwrap();
        let st = s.sign_out(COPILOT).await.unwrap();
        assert_eq!(st.status, ProviderStatus::SignedOut);
        assert!(
            st.detail
                .unwrap()
                .contains("github.com/settings/applications")
        );
        assert_eq!(store.get("boopis.copilot", "github_token").unwrap(), None);

        store.set("boopis.xai", xai::ACCESS, "xat_x").unwrap();
        store.set("boopis.xai", xai::REFRESH, "xrt_x").unwrap();
        let st = s.sign_out(XAI).await.unwrap();
        assert_eq!(st.status, ProviderStatus::SignedOut);
        assert_eq!(store.get("boopis.xai", xai::ACCESS).unwrap(), None);
    }
}
