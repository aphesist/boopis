//! The secret store trait, the OS keychain implementation (`keyring`: Secret Service on Linux, Keychain on macOS,
//! Credential Manager on Windows) and, for tests only, an in-memory one. Secrets never reach a plaintext file.

use crate::error::{Error, Result};

/// Every service name must start with this, so the plugin channel can only ever reach what hypotaxis stored.
pub const SERVICE_PREFIX: &str = "hypotaxis.";
/// The longest secret value accepted.
pub const MAX_VALUE: usize = 16 * 1024;

/// A keychain, synchronous (callers use `spawn_blocking`: the Secret Service is a D-Bus round trip).
pub trait SecretStore: Send + Sync + 'static {
    /// Store a secret, replacing any earlier one.
    ///
    /// # Errors
    /// `SecretsUnavailable` when no store runs; `Secrets` when it refuses.
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()>;

    /// Read a secret. `None` when it does not exist. Only the host's plugin channel calls this.
    ///
    /// # Errors
    /// `SecretsUnavailable` or `Secrets`.
    fn get(&self, service: &str, account: &str) -> Result<Option<String>>;

    /// Delete a secret. Deleting one that does not exist is not an error.
    ///
    /// # Errors
    /// `SecretsUnavailable` or `Secrets`.
    fn delete(&self, service: &str, account: &str) -> Result<()>;
}

/// Check a service or account name: a short, plain token. Services must be in the hypotaxis namespace.
///
/// # Errors
/// `InvalidInput` for anything else.
pub fn validate_name(service: &str, account: &str) -> Result<()> {
    let plain = |s: &str| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes().all(|b| {
                b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b':' | b'/' | b'@')
            })
    };
    if !plain(service) || !plain(account) {
        return Err(Error::InvalidInput(
            "a secret's service and account are 1 to 128 of [A-Za-z0-9._-:/@]".into(),
        ));
    }
    if !service.starts_with(SERVICE_PREFIX) {
        return Err(Error::InvalidInput(format!(
            "a secret's service must start with {SERVICE_PREFIX:?}"
        )));
    }
    Ok(())
}

/// Check a value's size.
///
/// # Errors
/// `InvalidInput` when it is empty or over [`MAX_VALUE`].
pub fn validate_value(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_VALUE {
        return Err(Error::InvalidInput(format!(
            "a secret is 1 to {MAX_VALUE} bytes"
        )));
    }
    Ok(())
}

/// The OS keychain.
#[derive(Debug, Default, Clone, Copy)]
pub struct Keychain;

fn map(e: &keyring::Error) -> Error {
    match e {
        keyring::Error::NoDefaultStore
        | keyring::Error::NoStorageAccess(_)
        | keyring::Error::PlatformFailure(_) => Error::SecretsUnavailable(unavailable_hint(e)),
        other => Error::Secrets(other.to_string()),
    }
}

fn unavailable_hint(e: &keyring::Error) -> String {
    if cfg!(target_os = "linux") {
        format!(
            "no Secret Service answered ({e}). Start and unlock GNOME Keyring, or enable the Secret Service in KWallet 6, then try again"
        )
    } else {
        format!("the OS keychain did not answer ({e})")
    }
}

impl SecretStore for Keychain {
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()> {
        keyring::Entry::new(service, account)
            .and_then(|e| e.set_password(value))
            .map_err(|e| map(&e))
    }

    fn get(&self, service: &str, account: &str) -> Result<Option<String>> {
        match keyring::Entry::new(service, account).and_then(|e| e.get_password()) {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(map(&e)),
        }
    }

    fn delete(&self, service: &str, account: &str) -> Result<()> {
        match keyring::Entry::new(service, account).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(map(&e)),
        }
    }
}

/// An in-memory store for tests and the `dev-fixtures` feature. Never a fallback for the keychain.
#[cfg(any(test, feature = "dev-fixtures"))]
#[derive(Debug, Default)]
pub struct MemoryStore {
    items: std::sync::Mutex<std::collections::HashMap<(String, String), String>>,
    /// When set, every call fails as if no Secret Service ran.
    pub unavailable: std::sync::atomic::AtomicBool,
}

#[cfg(any(test, feature = "dev-fixtures"))]
impl MemoryStore {
    fn check(&self) -> Result<()> {
        if self.unavailable.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(Error::SecretsUnavailable(
                "no Secret Service in this test".into(),
            ));
        }
        Ok(())
    }
    fn items(
        &self,
    ) -> std::sync::MutexGuard<'_, std::collections::HashMap<(String, String), String>> {
        self.items
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(any(test, feature = "dev-fixtures"))]
impl SecretStore for MemoryStore {
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()> {
        self.check()?;
        self.items()
            .insert((service.to_owned(), account.to_owned()), value.to_owned());
        Ok(())
    }
    fn get(&self, service: &str, account: &str) -> Result<Option<String>> {
        self.check()?;
        Ok(self
            .items()
            .get(&(service.to_owned(), account.to_owned()))
            .cloned())
    }
    fn delete(&self, service: &str, account: &str) -> Result<()> {
        self.check()?;
        self.items()
            .remove(&(service.to_owned(), account.to_owned()));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_and_namespaced() {
        assert!(validate_name("hypotaxis.provider.openai", "api_key").is_ok());
        for (s, a) in [
            ("openai", "k"),
            ("hypotaxis.x", ""),
            ("hypotaxis.x", "a b"),
            ("hypotaxis.x\n", "a"),
            ("", "a"),
            ("login", "x"),
        ] {
            assert!(validate_name(s, a).is_err(), "{s:?} {a:?}");
        }
        assert!(validate_name(&format!("hypotaxis.{}", "x".repeat(200)), "a").is_err());
    }

    #[test]
    fn values_have_a_size_cap() {
        assert!(validate_value("k").is_ok());
        assert!(validate_value("").is_err());
        assert!(validate_value(&"x".repeat(MAX_VALUE + 1)).is_err());
    }

    #[test]
    fn the_mock_backend_round_trips_and_deletes_idempotently() {
        let s = MemoryStore::default();
        assert_eq!(s.get("hypotaxis.a", "k").unwrap(), None);
        s.set("hypotaxis.a", "k", "v1").unwrap();
        s.set("hypotaxis.a", "k", "v2").unwrap();
        assert_eq!(s.get("hypotaxis.a", "k").unwrap().as_deref(), Some("v2"));
        s.delete("hypotaxis.a", "k").unwrap();
        s.delete("hypotaxis.a", "k").unwrap();
        assert_eq!(s.get("hypotaxis.a", "k").unwrap(), None);
    }

    #[test]
    fn an_unavailable_store_says_so_with_a_stable_code() {
        let s = MemoryStore::default();
        s.unavailable
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            s.set("hypotaxis.a", "k", "v").unwrap_err().code(),
            "hx.secrets.unavailable"
        );
    }

    #[test]
    fn a_missing_secret_service_gets_an_actionable_message() {
        let e = map(&keyring::Error::NoDefaultStore);
        assert_eq!(e.code(), "hx.secrets.unavailable");
        if cfg!(target_os = "linux") {
            assert!(
                e.to_string().contains("Secret Service") && e.to_string().contains("GNOME Keyring")
            );
        }
    }
}
