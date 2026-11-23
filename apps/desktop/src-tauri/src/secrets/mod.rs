//! Secrets: the OS keychain behind a trait, and the channel through which the Hermes plugin reads them.
//! There is no command that returns a secret to the UI (`docs/PROTOCOL.md` section 1).

pub mod channel;
#[cfg(target_os = "macos")]
mod macos;
pub mod peer;
pub mod refs;
pub mod store;

pub use channel::{Auth, SecretChannel};
pub use peer::PeerPolicy;
pub use store::{Keychain, SecretStore, validate_name};
