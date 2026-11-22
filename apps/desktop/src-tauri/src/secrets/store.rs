//! The secret store trait, the OS keychain implementation (`keyring`: Secret Service on Linux, Keychain on macOS,
//! Credential Manager on Windows) and, for tests only, an in-memory one. Secrets never reach a plaintext file.
//!
//! **Windows keeps a long value in parts.** Credential Manager holds at most 2560 bytes in one credential, and the keychain library
//! writes a password there as UTF-16, so one entry holds 1280 characters. A ChatGPT sign-in's ID token and access token are longer
//! (about 2000 characters each), so on Windows a longer value is kept in parts: the entry itself says how many, and
//! `<account>.part-<n>` hold them in order. Reading puts them back together; deleting removes them all. Elsewhere one entry holds any
//! value. A failure is told in plain words for the platform; what the keychain said is kept for Diagnostics.

use crate::error::{Error, Result};

/// Every service name must start with this, so the plugin channel can only ever reach what boopis stored.
pub const SERVICE_PREFIX: &str = "boopis.";
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

/// Check a service or account name: a short, plain token. Services must be in the boopis namespace.
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

/// The most UTF-16 units one keychain entry holds: Windows' 2560 bytes, written as UTF-16. No limit elsewhere.
#[cfg(windows)]
const ENTRY_UNITS: usize = 1280;
#[cfg(not(windows))]
const ENTRY_UNITS: usize = usize::MAX;

/// How an entry that holds a value in parts starts; the number of parts follows.
const PARTS_MARK: &str = "\u{1f}boopis-parts:";
/// The most parts a value is kept in ([`MAX_VALUE`] over one entry, with room).
const MAX_PARTS: usize = 64;

fn part_account(account: &str, n: usize) -> String {
    format!("{account}.part-{n}")
}

/// How many parts the entry `value` says it holds, when it is the mark of a value kept in parts.
fn parts_in(value: &str) -> Option<usize> {
    value
        .strip_prefix(PARTS_MARK)?
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=MAX_PARTS).contains(n))
}

/// `value` in pieces of at most `units` UTF-16 units each, cut between characters.
fn pieces(value: &str, units: usize) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut start, mut used) = (0, 0);
    for (i, c) in value.char_indices() {
        if used + c.len_utf16() > units {
            out.push(&value[start..i]);
            (start, used) = (i, 0);
        }
        used += c.len_utf16();
    }
    out.push(&value[start..]);
    out
}

/// Keep `value` under `service`/`account` in `entries`, in parts when it is longer than `units` UTF-16 units: the parts first,
/// then the entry that names them, then the parts an earlier, longer value left.
fn set_in_parts(
    entries: &dyn SecretStore,
    units: usize,
    service: &str,
    account: &str,
    value: &str,
) -> Result<()> {
    let before = entries
        .get(service, account)?
        .as_deref()
        .and_then(parts_in)
        .unwrap_or(0);
    let used = if value.encode_utf16().count() <= units {
        entries.set(service, account, value)?;
        0
    } else {
        let parts = pieces(value, units);
        for (i, part) in parts.iter().enumerate() {
            entries.set(service, &part_account(account, i + 1), part)?;
        }
        entries.set(service, account, &format!("{PARTS_MARK}{}", parts.len()))?;
        parts.len()
    };
    for n in (used + 1)..=before {
        let _ = entries.delete(service, &part_account(account, n));
    }
    Ok(())
}

fn get_in_parts(entries: &dyn SecretStore, service: &str, account: &str) -> Result<Option<String>> {
    let Some(value) = entries.get(service, account)? else {
        return Ok(None);
    };
    let Some(n) = parts_in(&value) else {
        return Ok(Some(value));
    };
    let mut whole = String::new();
    for i in 1..=n {
        let Some(part) = entries.get(service, &part_account(account, i))? else {
            crate::error::keep(
                "hx.secrets.failed",
                &format!("{service} {account}: part {i} of {n} is missing"),
            );
            return Err(Error::Secrets(
                "Part of a saved key is missing from the keychain. Sign in or add the key again."
                    .into(),
            ));
        };
        whole.push_str(&part);
    }
    Ok(Some(whole))
}

fn delete_in_parts(entries: &dyn SecretStore, service: &str, account: &str) -> Result<()> {
    if let Some(n) = entries.get(service, account)?.as_deref().and_then(parts_in) {
        for i in 1..=n {
            entries.delete(service, &part_account(account, i))?;
        }
    }
    entries.delete(service, account)
}

/// One keychain entry per call: what `keyring` does, with no parts.
struct Entries;

fn map(e: &keyring::Error) -> Error {
    match e {
        keyring::Error::NoDefaultStore
        | keyring::Error::NoStorageAccess(_)
        | keyring::Error::PlatformFailure(_) => {
            crate::error::keep("hx.secrets.unavailable", &e.to_string());
            Error::SecretsUnavailable(unavailable_words().into())
        }
        other => {
            crate::error::keep("hx.secrets.failed", &other.to_string());
            Error::Secrets("The keychain refused that. Unlock it and try again.".into())
        }
    }
}

/// What a person reads when the platform's keychain does not answer, and what to do about it.
const fn unavailable_words() -> &'static str {
    if cfg!(target_os = "linux") {
        "No keychain answered. Start and unlock GNOME Keyring, or turn on the Secret Service in KWallet 6, then try again."
    } else if cfg!(windows) {
        "Windows Credential Manager did not answer. Restart boopis and try again; if it happens again, restart Windows."
    } else {
        "The macOS keychain did not answer. Unlock the login keychain in Keychain Access, then try again."
    }
}

impl SecretStore for Entries {
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

impl SecretStore for Keychain {
    fn set(&self, service: &str, account: &str, value: &str) -> Result<()> {
        set_in_parts(&Entries, ENTRY_UNITS, service, account, value)
    }

    fn get(&self, service: &str, account: &str) -> Result<Option<String>> {
        get_in_parts(&Entries, service, account)
    }

    fn delete(&self, service: &str, account: &str) -> Result<()> {
        delete_in_parts(&Entries, service, account)
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
        assert!(validate_name("boopis.provider.openai", "api_key").is_ok());
        for (s, a) in [
            ("openai", "k"),
            ("boopis.x", ""),
            ("boopis.x", "a b"),
            ("boopis.x\n", "a"),
            ("", "a"),
            ("login", "x"),
        ] {
            assert!(validate_name(s, a).is_err(), "{s:?} {a:?}");
        }
        assert!(validate_name(&format!("boopis.{}", "x".repeat(200)), "a").is_err());
    }

    #[test]
    fn values_have_a_size_cap() {
        assert!(validate_value("k").is_ok());
        assert!(validate_value("").is_err());
        assert!(validate_value(&"x".repeat(MAX_VALUE + 1)).is_err());
    }

    /// A ChatGPT ID token is about 2000 characters, and Windows holds 1280 in one entry: the value goes in parts, comes back whole,
    /// and leaves nothing behind when it is replaced by a short one or deleted.
    #[test]
    fn a_value_longer_than_one_entry_is_kept_in_parts_and_comes_back_whole() {
        let m = MemoryStore::default();
        let token = format!("eyJ{}", "a1B2-_".repeat(400)); // 2403 characters
        set_in_parts(&m, 1280, "boopis.chatgpt", "id_token", &token).unwrap();
        let mark = m.get("boopis.chatgpt", "id_token").unwrap().unwrap();
        assert_eq!(parts_in(&mark), Some(2));
        for n in 1..=2 {
            let part = m
                .get("boopis.chatgpt", &part_account("id_token", n))
                .unwrap()
                .unwrap();
            assert!(part.encode_utf16().count() <= 1280);
        }
        assert_eq!(
            get_in_parts(&m, "boopis.chatgpt", "id_token")
                .unwrap()
                .as_deref(),
            Some(token.as_str())
        );
        // a shorter value replaces it in one entry, and the parts go
        set_in_parts(&m, 1280, "boopis.chatgpt", "id_token", "short").unwrap();
        assert_eq!(
            get_in_parts(&m, "boopis.chatgpt", "id_token")
                .unwrap()
                .as_deref(),
            Some("short")
        );
        assert_eq!(
            m.get("boopis.chatgpt", &part_account("id_token", 1))
                .unwrap(),
            None
        );
        assert_eq!(
            m.get("boopis.chatgpt", &part_account("id_token", 2))
                .unwrap(),
            None
        );
        // three parts, then two: the third goes
        let long = "x".repeat(3000);
        set_in_parts(&m, 1280, "boopis.chatgpt", "access_token", &long).unwrap();
        assert!(
            m.get("boopis.chatgpt", &part_account("access_token", 3))
                .unwrap()
                .is_some()
        );
        set_in_parts(
            &m,
            1280,
            "boopis.chatgpt",
            "access_token",
            &"y".repeat(2000),
        )
        .unwrap();
        assert_eq!(
            m.get("boopis.chatgpt", &part_account("access_token", 3))
                .unwrap(),
            None
        );
        assert_eq!(
            get_in_parts(&m, "boopis.chatgpt", "access_token").unwrap(),
            Some("y".repeat(2000))
        );
        // deleting removes the entry and its parts
        delete_in_parts(&m, "boopis.chatgpt", "access_token").unwrap();
        assert_eq!(
            get_in_parts(&m, "boopis.chatgpt", "access_token").unwrap(),
            None
        );
        assert_eq!(
            m.get("boopis.chatgpt", &part_account("access_token", 1))
                .unwrap(),
            None
        );
        // a value that fits is one entry, as before
        set_in_parts(&m, 1280, "boopis.provider.openai", "api_key", "sk-short").unwrap();
        assert_eq!(
            m.get("boopis.provider.openai", "api_key")
                .unwrap()
                .as_deref(),
            Some("sk-short")
        );
    }

    #[test]
    fn parts_are_cut_between_characters_and_a_missing_part_is_said_plainly() {
        // a character outside the basic plane is two UTF-16 units and is never split
        let v = format!("{}\u{1F600}{}", "a".repeat(9), "b".repeat(5));
        let p = pieces(&v, 10);
        assert_eq!(p.concat(), v);
        assert!(p.iter().all(|s| s.encode_utf16().count() <= 10));
        assert_eq!(p[0], "a".repeat(9));
        // the mark of parts is never a value a person typed, and a damaged one is read as the value it is
        assert_eq!(parts_in("\u{1f}boopis-parts:0"), None);
        assert_eq!(parts_in("\u{1f}boopis-parts:999"), None);
        assert_eq!(parts_in("boopis-parts:2"), None);
        let m = MemoryStore::default();
        set_in_parts(&m, 4, "boopis.x", "k", "abcdefghij").unwrap();
        m.delete("boopis.x", &part_account("k", 2)).unwrap();
        let e = get_in_parts(&m, "boopis.x", "k").unwrap_err();
        assert_eq!(e.code(), "hx.secrets.failed");
        assert!(
            e.to_string().starts_with("Part of a saved key is missing"),
            "{e}"
        );
    }

    #[test]
    fn a_keychain_failure_is_told_in_plain_words() {
        let unavailable = map(&keyring::Error::NoDefaultStore);
        assert_eq!(unavailable.code(), "hx.secrets.unavailable");
        let refused = map(&keyring::Error::TooLong(
            "password encoded as UTF-16".into(),
            2560,
        ));
        assert_eq!(refused.code(), "hx.secrets.failed");
        for e in [unavailable, refused] {
            let shown = crate::error::shown(e);
            assert!(shown.ends_with('.'), "{shown}");
            for raw in [
                "UTF-16",
                "2560",
                "secret store:",
                "no secret store is available",
                "(",
            ] {
                assert!(!shown.contains(raw), "{shown}");
            }
        }
    }

    #[test]
    fn the_mock_backend_round_trips_and_deletes_idempotently() {
        let s = MemoryStore::default();
        assert_eq!(s.get("boopis.a", "k").unwrap(), None);
        s.set("boopis.a", "k", "v1").unwrap();
        s.set("boopis.a", "k", "v2").unwrap();
        assert_eq!(s.get("boopis.a", "k").unwrap().as_deref(), Some("v2"));
        s.delete("boopis.a", "k").unwrap();
        s.delete("boopis.a", "k").unwrap();
        assert_eq!(s.get("boopis.a", "k").unwrap(), None);
    }

    #[test]
    fn an_unavailable_store_says_so_with_a_stable_code() {
        let s = MemoryStore::default();
        s.unavailable
            .store(true, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            s.set("boopis.a", "k", "v").unwrap_err().code(),
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
