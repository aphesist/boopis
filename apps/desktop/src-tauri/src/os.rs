//! OS integration that is pure enough to test: the external-URL allowlist, home-relative folder paths, and the
//! bounds on notifications. The Tauri calls themselves are in `commands.rs`.

use std::path::Path;

use serde::Serialize;
use specta::Type;
use url::Url;

use crate::error::{Error, Result};

/// Validate a URL before handing it to the OS opener: `http` or `https`, a host, no credentials, bounded.
///
/// # Errors
/// `InvalidInput` for anything else (`file:`, `javascript:`, custom schemes, `user:pass@`).
pub fn validate_external_url(raw: &str) -> Result<Url> {
    if raw.len() > 2048 || raw.chars().any(char::is_control) {
        return Err(Error::InvalidInput(
            "the URL is too long or has control characters".into(),
        ));
    }
    let url = Url::parse(raw).map_err(|e| Error::InvalidInput(format!("not a URL: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(Error::InvalidInput(format!(
            "only http and https links open, not {}",
            url.scheme()
        )));
    }
    if url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidInput(
            "the URL needs a host and no credentials".into(),
        ));
    }
    Ok(url)
}

/// A folder the user picked, in the form the local endpoint uses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct PickedFolder {
    /// `~/projects/x` for a folder under the user's home, the absolute path otherwise.
    pub path: String,
    /// Whether `path` is relative to the home (starts with `~/`).
    pub home_relative: bool,
}

/// Express `picked` relative to `home` (`~/...`, with `/` separators on every OS), or absolute when outside it.
#[must_use]
pub fn to_home_relative(picked: &Path, home: &Path) -> PickedFolder {
    match picked.strip_prefix(home) {
        Ok(rel) if rel.as_os_str().is_empty() => PickedFolder {
            path: "~".into(),
            home_relative: true,
        },
        Ok(rel) => {
            let parts: Vec<String> = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect();
            PickedFolder {
                path: format!("~/{}", parts.join("/")),
                home_relative: true,
            }
        }
        Err(_) => PickedFolder {
            path: picked.to_string_lossy().into_owned(),
            home_relative: false,
        },
    }
}

/// Bound a notification's text.
///
/// # Errors
/// `InvalidInput` when the title or body is empty or too long.
pub fn validate_notification(title: &str, body: &str) -> Result<()> {
    if title.is_empty() || title.chars().count() > 120 || body.chars().count() > 500 {
        return Err(Error::InvalidInput(
            "a notification has a title of 1 to 120 characters and a body of at most 500".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_web_links_open() {
        assert!(validate_external_url("https://example.com/a?b=c#d").is_ok());
        assert!(validate_external_url("http://localhost:3000").is_ok());
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,x",
            "ssh://host",
            "hermes://install?x=1",
            "https://user:pw@example.com",
            "https://",
            "not a url",
            "https://example.com/\u{0007}",
            &format!("https://example.com/{}", "a".repeat(2100)),
        ] {
            assert!(validate_external_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn folders_under_home_are_home_relative() {
        let home = Path::new("/home/u");
        assert_eq!(
            to_home_relative(Path::new("/home/u/projects/x"), home),
            PickedFolder {
                path: "~/projects/x".into(),
                home_relative: true
            }
        );
        assert_eq!(to_home_relative(Path::new("/home/u"), home).path, "~");
        let outside = to_home_relative(Path::new("/mnt/data/x"), home);
        assert_eq!(
            (outside.path.as_str(), outside.home_relative),
            ("/mnt/data/x", false)
        );
        assert!(
            !to_home_relative(Path::new("/home/user2/x"), home).home_relative,
            "a sibling prefix is not under home"
        );
    }

    #[test]
    fn notifications_are_bounded() {
        assert!(validate_notification("Done", "").is_ok());
        assert!(validate_notification("", "x").is_err());
        assert!(validate_notification(&"t".repeat(121), "").is_err());
        assert!(validate_notification("t", &"b".repeat(501)).is_err());
    }
}
