//! GitHub without its API (`docs/STORE.md` 5.2): the API's unauthenticated limit is 60 requests an hour per address, so the
//! store does not use it. A commit is read from the repository's smart-HTTP advertisement (`info/refs`, which `git ls-remote`
//! reads, and which is not API rate-limited), and the tree comes from `codeload.github.com` at that commit. Live search, which
//! would need the API and a sign-in, is not built (a later step; the source's note says so).

use std::collections::BTreeMap;

use super::net::{Ask, Fetcher, Hosts};
use crate::config::StoreLimits;
use crate::error::{Error, Result};

/// A GitHub repository, and what the user pointed at inside it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    /// The owner.
    pub owner: String,
    /// The repository.
    pub name: String,
    /// A branch, tag or commit named in the address.
    pub reference: Option<String>,
    /// A folder inside it.
    pub path: Option<String>,
}

impl Repo {
    /// `https://github.com/owner/name`.
    #[must_use]
    pub fn url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

fn invalid(why: &str) -> Error {
    Error::Store("hx.store.invalid_source", why.to_owned())
}

fn part_ok(p: &str) -> bool {
    (1..=100).contains(&p.len()) && p != "." && p != ".." && p.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// Read `github.com/owner/repo`, `https://github.com/owner/repo`, `.../tree/<ref>/<path>` or `owner/repo[/path]`.
///
/// # Errors
/// `hx.store.invalid_source` for anything else (another host, a credential in the address, a path that climbs).
pub fn parse(input: &str) -> Result<Repo> {
    let t = input.trim().trim_end_matches('/');
    let rest = if let Some(r) = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://")) {
        let r = r.strip_prefix("www.").unwrap_or(r);
        r.strip_prefix("github.com/").ok_or_else(|| invalid("that is not a GitHub address"))?
    } else if let Some(r) = t.strip_prefix("github.com/") {
        r
    } else if t.contains("://") || t.contains('@') || t.contains(':') {
        return Err(invalid("that is not a GitHub address"));
    } else {
        t
    };
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let mut it = rest.split('/');
    let owner = it.next().unwrap_or("");
    let name = it.next().unwrap_or("").trim_end_matches(".git");
    if !part_ok(owner) || !part_ok(name) {
        return Err(invalid("a GitHub address is github.com/owner/repository"));
    }
    let tail: Vec<&str> = it.collect();
    let (reference, path) = match tail.as_slice() {
        [] => (None, None),
        ["tree" | "blob", r, p @ ..] => ((!r.is_empty()).then(|| (*r).to_owned()), (!p.is_empty()).then(|| p.join("/"))),
        p => (None, Some(p.join("/"))),
    };
    if let Some(p) = &path
        && (p.split('/').any(|s| s.is_empty() || s == "." || s == "..") || p.contains(['\\', '\0']))
    {
        return Err(invalid("that path leaves the repository"));
    }
    if reference.as_deref().is_some_and(|r| r.contains("..") || r.contains(['\\', '\0', ' '])) {
        return Err(invalid("that reference is not one"));
    }
    Ok(Repo { owner: owner.to_owned(), name: name.to_owned(), reference, path })
}

/// The refs a repository advertises.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Refs {
    /// What `HEAD` points at.
    pub head: Option<String>,
    /// The branch `HEAD` points at (`main`).
    pub head_branch: Option<String>,
    /// `refs/heads/*`, `refs/tags/*` (and peeled `^{}`), by full name.
    pub by_name: BTreeMap<String, String>,
}

fn is_sha(v: &str) -> bool {
    v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Parse a smart-HTTP `info/refs?service=git-upload-pack` answer (pkt-lines).
///
/// # Errors
/// `hx.store.source_unreachable` when it is not one.
pub fn parse_refs(bytes: &[u8]) -> Result<Refs> {
    let bad = || Error::Store("hx.store.source_unreachable", "GitHub's answer was not a list of refs".into());
    let mut at = 0;
    let mut refs = Refs::default();
    let mut first = true;
    while at + 4 <= bytes.len() {
        let len = usize::from_str_radix(std::str::from_utf8(&bytes[at..at + 4]).map_err(|_| bad())?, 16).map_err(|_| bad())?;
        if len == 0 {
            at += 4;
            continue;
        }
        if len < 4 || at + len > bytes.len() {
            return Err(bad());
        }
        let line = String::from_utf8_lossy(&bytes[at + 4..at + len]).into_owned();
        at += len;
        if line.starts_with('#') {
            continue;
        }
        let (body, caps) = line.split_once('\0').unwrap_or((&line, ""));
        let body = body.trim_end();
        let Some((sha, name)) = body.split_once(' ') else { continue };
        if !is_sha(sha) {
            continue;
        }
        if first {
            first = false;
            for c in caps.split(' ') {
                if let Some(t) = c.strip_prefix("symref=HEAD:refs/heads/") {
                    refs.head_branch = Some(t.to_owned());
                }
            }
        }
        if name == "HEAD" {
            refs.head = Some(sha.to_ascii_lowercase());
        } else {
            refs.by_name.insert(name.to_owned(), sha.to_ascii_lowercase());
        }
    }
    if refs.head.is_none() && refs.by_name.is_empty() {
        return Err(bad());
    }
    Ok(refs)
}

impl Refs {
    /// The commit `reference` names: none means `HEAD`; a 40-hex commit is itself; else a branch, then a tag (a peeled tag
    /// first, since an annotated tag's own object is not a commit).
    ///
    /// # Errors
    /// `hx.store.invalid_source` when nothing by that name is advertised.
    pub fn resolve(&self, reference: Option<&str>) -> Result<String> {
        let Some(r) = reference else {
            return self.head.clone().ok_or_else(|| invalid("that repository has no default branch"));
        };
        if is_sha(r) {
            return Ok(r.to_ascii_lowercase());
        }
        [format!("refs/tags/{r}^{{}}"), format!("refs/heads/{r}"), format!("refs/tags/{r}")]
            .iter()
            .find_map(|k| self.by_name.get(k).cloned())
            .ok_or_else(|| invalid("that repository has no branch or tag of that name"))
    }
}

/// The commit `repo`'s reference points at now.
///
/// # Errors
/// `hx.store.source_unreachable`, `hx.store.too_large`, `hx.store.invalid_source`.
pub fn resolve_commit(fetcher: &dyn Fetcher, hosts: &Hosts, limits: &StoreLimits, repo: &Repo) -> Result<String> {
    let url = format!("https://github.com/{}/{}.git/info/refs?service=git-upload-pack", repo.owner, repo.name);
    let reply = fetcher.get(&url, hosts, &Ask { max_bytes: limits.max_catalogue_bytes, etag: None, accept: None })?;
    parse_refs(&reply.body)?.resolve(repo.reference.as_deref())
}

/// The address of the tarball of `sha`.
#[must_use]
pub fn archive_url(owner: &str, name: &str, sha: &str) -> String {
    format!("https://codeload.github.com/{owner}/{name}/tar.gz/{sha}")
}

/// A file of a repository at a commit, by address (`raw.githubusercontent.com`).
#[must_use]
pub fn raw_url(owner: &str, name: &str, sha: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{owner}/{name}/{sha}/{path}")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// The head of `https://github.com/anthropics/skills.git/info/refs?service=git-upload-pack`, saved 2026-11-21, with its
    /// advertised refs cut to a few and the commit ids kept as GitHub sent them.
    const REFS: &[u8] = include_bytes!("fixtures/git-info-refs.bin");

    #[test]
    fn addresses_are_read_in_every_spelling() {
        let p = |s: &str| parse(s).unwrap();
        assert_eq!(p("https://github.com/anthropics/skills"), Repo { owner: "anthropics".into(), name: "skills".into(), reference: None, path: None });
        assert_eq!(p("github.com/a/b.git").name, "b");
        let t = p("https://github.com/anthropics/skills/tree/main/skills/pdf");
        assert_eq!((t.reference.as_deref(), t.path.as_deref()), (Some("main"), Some("skills/pdf")));
        let short = p("anthropics/skills/skills/pdf");
        assert_eq!((short.reference, short.path.as_deref()), (None, Some("skills/pdf")));
        assert_eq!(p("https://www.github.com/a/b/").url(), "https://github.com/a/b");
        assert_eq!(p("https://github.com/a/b?tab=readme#x").name, "b");
    }

    #[test]
    fn what_is_not_a_github_repository_is_refused() {
        for bad in [
            "https://gitlab.com/a/b",
            "git@github.com:a/b.git",
            "https://user:pw@github.com/a/b",
            "https://github.com/a",
            "https://github.com/../b",
            "a/b/../c",
            "ssh://github.com/a/b",
            "",
            "https://github.com/a/b/tree/main/x/../y",
            "https://github.com/a/b c",
        ] {
            assert_eq!(parse(bad).unwrap_err().code(), "hx.store.invalid_source", "{bad}");
        }
    }

    #[test]
    fn a_real_advertisement_gives_the_head_commit_and_branch() {
        let r = parse_refs(REFS).unwrap();
        assert_eq!(r.head_branch.as_deref(), Some("main"));
        let head = r.head.clone().unwrap();
        assert_eq!(head.len(), 40);
        assert_eq!(r.resolve(None).unwrap(), head);
        assert_eq!(r.resolve(Some("main")).unwrap(), head, "the default branch is the commit HEAD names");
        assert_eq!(r.resolve(Some(&head)).unwrap(), head);
        assert_eq!(r.resolve(Some("no-such-branch")).unwrap_err().code(), "hx.store.invalid_source");
    }

    #[test]
    fn a_peeled_tag_wins_over_the_tag_object() {
        let line = |sha: &str, name: &str| format!("{:04x}{sha} {name}\n", 4 + 41 + name.len() + 1);
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        let c = "c".repeat(40);
        let body = format!("0000{}{}{}0000", line(&a, "refs/tags/v1"), line(&b, "refs/tags/v1^{}"), line(&c, "refs/heads/main"));
        let r = parse_refs(body.as_bytes()).unwrap();
        assert_eq!(r.resolve(Some("v1")).unwrap(), b);
        assert_eq!(r.resolve(Some("main")).unwrap(), c);
        assert!(parse_refs(b"<html>not git</html>").is_err());
    }
}
