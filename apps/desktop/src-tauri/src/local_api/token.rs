//! The endpoint's token and the files that carry it to a local client (`ADR-0045`).
//!
//! - **Token**: 256 bits from the system's random source, as 64 hex characters. A new one at every start and whenever the
//!   owner rotates it. It exists in this process and in `<app data>/client-token`, and nowhere else: not in a log, not in
//!   an error, not in a setting, not in any response.
//! - **File**: created by writing a temporary file in the same folder with mode `0600` and renaming it into place, so no
//!   other user can read it, not even for an instant. Re-checked at every start: a file that is group- or world-readable is
//!   replaced, never used. On Windows the file relies on the user profile folder's access list (not tightened further yet).
//! - **Comparison**: both sides hashed, then compared in constant time.
//! - **Ownership**: the files belong to the run that wrote them. A run that ends removes a file only while it still holds
//!   exactly what this process last wrote there ([`Files::remove_if_ours`]): a second launch writes its own files before
//!   the first one exits, and the first one's shutdown used to delete them, leaving the running app with an endpoint no
//!   client could find or use (B28).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;

/// What this process last wrote at each file path, as a digest of the bytes (never the text: a token is kept nowhere else).
/// Another process's write is not here, so a file it replaced is not this process's to remove.
static WRITTEN: Mutex<BTreeMap<PathBuf, [u8; 32]>> = Mutex::new(BTreeMap::new());

fn written() -> std::sync::MutexGuard<'static, BTreeMap<PathBuf, [u8; 32]>> {
    WRITTEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn digest_of(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// The token's file name.
pub const TOKEN_FILE: &str = "client-token";
/// The file that says where the endpoint is (no secret).
pub const ENDPOINT_FILE: &str = "client-endpoint";

/// A token. `Debug` and `Display` never print it.
#[derive(Clone)]
pub struct Token {
    value: String,
    digest: [u8; 32],
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

impl Token {
    /// A fresh random token.
    ///
    /// # Errors
    /// The system's random source failed.
    pub fn mint() -> std::io::Result<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
        Ok(Self::from_text(hex::encode(bytes)))
    }

    /// A token of known text (for tests and for reading the file back).
    #[must_use]
    pub fn from_text(value: String) -> Self {
        let digest = Sha256::digest(value.as_bytes()).into();
        Self { value, digest }
    }

    /// Whether `presented` is this token, in constant time.
    #[must_use]
    pub fn matches(&self, presented: &str) -> bool {
        let theirs: [u8; 32] = Sha256::digest(presented.as_bytes()).into();
        self.digest.ct_eq(&theirs).into()
    }

    /// The token's text, for the file and for the scrubber's list of values never to let out.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.value
    }
}

/// The folder's two files.
#[derive(Debug, Clone)]
pub struct Files {
    dir: PathBuf,
}

impl Files {
    /// The files under `dir` (the app's data folder).
    #[must_use]
    pub fn under(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
        }
    }

    /// The token file's path.
    #[must_use]
    pub fn token_path(&self) -> PathBuf {
        self.dir.join(TOKEN_FILE)
    }

    /// The endpoint file's path.
    #[must_use]
    pub fn endpoint_path(&self) -> PathBuf {
        self.dir.join(ENDPOINT_FILE)
    }

    /// Write the token file, atomically and private to its owner.
    ///
    /// # Errors
    /// The I/O error.
    pub fn write_token(&self, token: &Token) -> std::io::Result<()> {
        self.write_private(&self.token_path(), token.expose())
    }

    /// Write the endpoint file: the address and the contract's version, no secret.
    ///
    /// # Errors
    /// The I/O error.
    pub fn write_endpoint(&self, address: &str, version: u32) -> std::io::Result<()> {
        let text = format!("{{\"url\":\"http://{address}\",\"version\":{version}}}");
        self.write_private(&self.endpoint_path(), &text)
    }

    fn write_private(&self, target: &Path, text: &str) -> std::io::Result<()> {
        use std::io::Write as _;
        std::fs::create_dir_all(&self.dir)?;
        let mut nonce = [0u8; 8];
        getrandom::fill(&mut nonce).map_err(|e| std::io::Error::other(e.to_string()))?;
        let tmp = self.dir.join(format!(".client-{}.tmp", hex::encode(nonce)));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let bytes = format!("{text}\n");
        let result = (|| {
            let mut file = options.open(&tmp)?;
            file.write_all(bytes.as_bytes())?;
            file.sync_all()?;
            std::fs::rename(&tmp, target)
        })();
        match &result {
            Ok(()) => {
                written().insert(target.to_path_buf(), digest_of(bytes.as_bytes()));
            }
            Err(_) => {
                let _ = std::fs::remove_file(&tmp);
            }
        }
        result
    }

    /// Whether the token file is private to its owner (mode `0600` or tighter). Always true off Unix.
    #[must_use]
    pub fn token_is_private(&self) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            #[allow(clippy::verbose_bit_mask)] // "no bit of group or other" is what the mask means
            std::fs::metadata(self.token_path()).is_ok_and(|m| m.permissions().mode() & 0o077 == 0)
        }
        #[cfg(not(unix))]
        {
            self.token_path().exists()
        }
    }

    /// Remove both files (the endpoint is off).
    pub fn remove(&self) {
        for path in [self.token_path(), self.endpoint_path()] {
            let _ = std::fs::remove_file(&path);
            written().remove(&path);
        }
    }

    /// Remove each file only while it holds exactly what this process last wrote there (the run is ending): a file another
    /// run wrote since, a second launch's own token and endpoint, is left where it is.
    pub fn remove_if_ours(&self) {
        for path in [self.token_path(), self.endpoint_path()] {
            let Some(mine) = written().remove(&path) else {
                continue;
            };
            self.remove_if_still(&path, mine);
        }
    }

    /// Remove `path` if its bytes digest to `mine`. A plain check-then-delete could delete a file another run renamed into
    /// place between the two, so the file is first moved aside (one rename) and what was moved is checked: a write that
    /// landed in between is linked back (never over a newer one) and only this run's own bytes are removed.
    fn remove_if_still(&self, path: &Path, mine: [u8; 32]) {
        if !holds(path, mine) {
            return;
        }
        let mut nonce = [0u8; 8];
        if getrandom::fill(&mut nonce).is_err() {
            return; // with no name to move it to, leaving it is the safe answer
        }
        let aside = self
            .dir
            .join(format!(".client-{}.gone", hex::encode(nonce)));
        if std::fs::rename(path, &aside).is_ok() {
            settle(&aside, path, mine);
        }
    }
}

/// Whether the file at `path` holds the bytes whose digest is `mine`.
fn holds(path: &Path, mine: [u8; 32]) -> bool {
    std::fs::read(path).is_ok_and(|b| digest_of(&b) == mine)
}

/// The file moved aside from `path`: removed when it is this run's (`mine`), else linked back where it was (which fails,
/// rightly, when a newer file is already there) and the aside name removed.
fn settle(aside: &Path, path: &Path, mine: [u8; 32]) {
    if !holds(aside, mine) {
        let _ = std::fs::hard_link(aside, path);
    }
    let _ = std::fs::remove_file(aside);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_random_long_and_never_printed() {
        let (a, b) = (Token::mint().unwrap(), Token::mint().unwrap());
        assert_eq!(a.expose().len(), 64);
        assert_ne!(a.expose(), b.expose());
        assert!(a.expose().bytes().all(|c| c.is_ascii_hexdigit()));
        let shown = format!("{a:?}");
        assert!(!shown.contains(a.expose()), "{shown}");
    }

    #[test]
    fn only_the_exact_token_matches() {
        let t = Token::from_text("abc123".into());
        assert!(t.matches("abc123"));
        for wrong in ["", "abc12", "abc1234", "ABC123", " abc123", "abc123\n"] {
            assert!(!t.matches(wrong), "{wrong:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_token_file_is_private_and_replaced_atomically() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        let first = Token::mint().unwrap();
        files.write_token(&first).unwrap();
        let mode = std::fs::metadata(files.token_path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "mode {mode:o}");
        assert!(files.token_is_private());
        let second = Token::mint().unwrap();
        files.write_token(&second).unwrap();
        let text = std::fs::read_to_string(files.token_path()).unwrap();
        assert_eq!(text.trim(), second.expose());
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "no temporary file is left behind");
    }

    #[cfg(unix)]
    #[test]
    fn a_world_readable_file_is_not_private_and_a_rewrite_fixes_it() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        std::fs::write(files.token_path(), "old\n").unwrap();
        std::fs::set_permissions(files.token_path(), std::fs::Permissions::from_mode(0o644))
            .unwrap();
        assert!(!files.token_is_private());
        files.write_token(&Token::mint().unwrap()).unwrap();
        assert!(files.token_is_private());
    }

    /// Another run's write, as a second launch makes it: a different process, so nothing of this one's record.
    fn foreign_write(path: &Path, text: &str) {
        let tmp = path.with_extension("foreign");
        std::fs::write(&tmp, format!("{text}\n")).unwrap();
        std::fs::rename(&tmp, path).unwrap();
    }

    /// B28: the first run's shutdown deleted the second launch's endpoint and token.
    #[test]
    fn a_run_that_ends_leaves_the_files_a_later_run_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        files.write_token(&Token::mint().unwrap()).unwrap();
        files.write_endpoint("127.0.0.1:32915", 1).unwrap();
        let theirs = Token::mint().unwrap();
        foreign_write(&files.token_path(), theirs.expose());
        foreign_write(
            &files.endpoint_path(),
            r#"{"url":"http://127.0.0.1:47821","version":1}"#,
        );
        files.remove_if_ours();
        assert_eq!(
            std::fs::read_to_string(files.token_path()).unwrap().trim(),
            theirs.expose()
        );
        assert!(
            std::fs::read_to_string(files.endpoint_path())
                .unwrap()
                .contains("47821")
        );
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names.len(),
            2,
            "nothing moved aside is left behind: {names:?}"
        );
    }

    #[test]
    fn a_run_that_ends_removes_its_own_files_after_a_rotation_too() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        files.write_token(&Token::mint().unwrap()).unwrap();
        files.write_endpoint("127.0.0.1:47821", 1).unwrap();
        files.write_token(&Token::mint().unwrap()).unwrap(); // the owner rotated it
        files.remove_if_ours();
        assert!(!files.token_path().exists() && !files.endpoint_path().exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn only_the_file_another_run_replaced_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        files.write_token(&Token::mint().unwrap()).unwrap();
        files.write_endpoint("127.0.0.1:32915", 1).unwrap();
        // a second launch has written its token and not yet its endpoint
        let theirs = Token::mint().unwrap();
        foreign_write(&files.token_path(), theirs.expose());
        files.remove_if_ours();
        assert!(!files.endpoint_path().exists(), "this run's endpoint goes");
        assert_eq!(
            std::fs::read_to_string(files.token_path()).unwrap().trim(),
            theirs.expose(),
            "their token stays"
        );
    }

    #[test]
    fn a_file_this_run_never_wrote_is_never_removed() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        foreign_write(&files.token_path(), "someone else's");
        files.remove_if_ours();
        assert!(files.token_path().exists());
    }

    #[test]
    fn a_write_that_lands_while_the_file_is_checked_is_put_back_and_never_over_a_newer_one() {
        let dir = tempfile::tempdir().unwrap();
        let (path, aside) = (
            dir.path().join(TOKEN_FILE),
            dir.path().join(".client-x.gone"),
        );
        let mine = digest_of(b"mine\n");
        // another run renamed its file into place between the look and the move: what was moved aside is theirs
        std::fs::write(&aside, "theirs\n").unwrap();
        settle(&aside, &path, mine);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "theirs\n");
        assert!(!aside.exists());
        // and when a newer one is already back in place, the moved file does not replace it
        std::fs::write(&aside, "theirs\n").unwrap();
        std::fs::write(&path, "newest\n").unwrap();
        settle(&aside, &path, mine);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "newest\n");
        assert!(!aside.exists());
        // this run's own bytes go
        std::fs::write(&aside, "mine\n").unwrap();
        std::fs::remove_file(&path).unwrap();
        settle(&aside, &path, mine);
        assert!(!path.exists() && !aside.exists());
    }

    #[test]
    fn the_endpoint_file_holds_the_address_and_no_token() {
        let dir = tempfile::tempdir().unwrap();
        let files = Files::under(dir.path());
        let token = Token::mint().unwrap();
        files.write_token(&token).unwrap();
        files.write_endpoint("127.0.0.1:47831", 1).unwrap();
        let text = std::fs::read_to_string(files.endpoint_path()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["url"], "http://127.0.0.1:47831");
        assert!(!text.contains(token.expose()));
        files.remove();
        assert!(!files.token_path().exists() && !files.endpoint_path().exists());
    }
}
