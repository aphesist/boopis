//! The sign-in ways the host owns, behind the contract's four commands (`provider_signin_start`, `provider_signin_cancel`,
//! `provider_sign_out`, `provider_signin_status`): ChatGPT through OpenAI's program (`crate::chatgpt`, ADR-0030) and GitHub
//! Copilot (`crate::copilot`, ADR-0039). A way somebody else owns (Claude's is Claude Code's own) answers
//! `hx.provider.unsupported`; an id the catalogue does not hold answers `hx.provider.unknown`. Another sign-in the host
//! comes to own is one more arm in each function here.
//!
//! The states drawn here are the ones [`states`] returns for `provider_list` to include.

use std::sync::Arc;

use super::{ProviderState, SigninCode, WayKind, catalogue};
use crate::chatgpt::{self, ChatGpt};
use crate::copilot::{self, Copilot};
use crate::error::{Error, Result};

/// The ChatGPT way's id in the catalogue.
pub const CHATGPT: &str = "openai.signin";
/// The Copilot way's id in the catalogue.
pub const COPILOT: &str = copilot::WAY;

/// The services behind the ways.
pub struct Signins {
    /// ChatGPT's sign-in.
    pub chatgpt: Arc<ChatGpt>,
    /// Copilot's sign-in.
    pub copilot: Arc<Copilot>,
}

enum Owned {
    ChatGpt,
    Copilot,
}

fn owned(way: &str) -> Result<Owned> {
    match way {
        CHATGPT => Ok(Owned::ChatGpt),
        COPILOT => Ok(Owned::Copilot),
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
        })
    }

    /// The states of every way the host owns, for `provider_list`.
    ///
    /// # Errors
    /// `hx.secrets.*`.
    pub async fn states(&self) -> Result<Vec<ProviderState>> {
        Ok(vec![
            chatgpt_state(&self.chatgpt.status().await?),
            copilot_state(&self.copilot.status().await?),
        ])
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
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::chatgpt::oauth::Https;
    use crate::providers::ProviderStatus;
    use crate::secrets::SecretStore;
    use crate::secrets::store::MemoryStore;

    fn signins(store: &Arc<MemoryStore>) -> Signins {
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
                http,
                copilot::Timing {
                    signin: Duration::from_mins(15),
                },
            )),
        }
    }

    #[test]
    fn the_owned_ways_are_in_the_catalogue_and_the_rest_are_answered_plainly() {
        for way in [CHATGPT, COPILOT] {
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
            s.cancel(CHATGPT).is_ok() && s.cancel(COPILOT).is_ok(),
            "cancelling nothing is fine"
        );
    }

    #[tokio::test]
    async fn a_state_is_drawn_from_the_keychain_for_each_way() {
        let store = Arc::new(MemoryStore::default());
        let s = signins(&store);
        let all = s.states().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(
            all.iter()
                .all(|a| a.status == ProviderStatus::SignedOut && a.is_consistent())
        );

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

        // a sign-in from before the program says so, in the detail, beside the plan
        store.set("boopis.chatgpt", "access_token", "a").unwrap();
        store.set("boopis.chatgpt", "refresh_token", "r").unwrap();
        let st = s.status(CHATGPT).await.unwrap();
        assert_eq!(st.status, ProviderStatus::Connected);
        assert!(st.detail.unwrap().contains("Sign in again"));
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
    }
}
