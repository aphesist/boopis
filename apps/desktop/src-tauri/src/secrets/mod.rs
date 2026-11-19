//! Secrets: the OS keychain behind a trait, and the channel through which the Hermes plugin reads them.
//! There is no command that returns a secret to the UI (`docs/PROTOCOL.md` section 1).

pub mod channel;
pub mod refs;
pub mod store;

pub use channel::SecretChannel;
pub use store::{Keychain, SecretStore, validate_name};
