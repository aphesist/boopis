//! boopis's own list of skills and plugins (`apps/shared/data/recommended.json`, `docs/RECOMMENDED.md`) as data: compiled in and
//! parsed once, like the connector collection. Every entry was read against its publisher's own repository at the commit it pins,
//! and each kind is ordered by a cited popularity signal, most used first. The host only reads it; the install is the ordinary
//! one for a skill or a plugin (the entry's `raw` has the shape a marketplace entry's has), so nothing here is a way around the
//! review card.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::error::{Error, Result};

/// The shared data file, compiled in.
pub const RECOMMENDED_JSON: &str = include_str!("../../../../shared/data/recommended.json");

/// The whole list.
#[derive(Debug, Clone, Deserialize)]
pub struct Recommended {
    /// How each kind is ordered.
    pub popularity: Reads,
    /// The skills, most used first.
    pub skills: Vec<Entry>,
    /// The plugins, most used first.
    pub plugins: Vec<Entry>,
}

/// The two reads of a signal.
#[derive(Debug, Clone, Deserialize)]
pub struct Reads {
    /// The skills' signal.
    pub skills: Read,
    /// The plugins' signal.
    pub plugins: Read,
}

/// One read of a signal: which, when, where, and what it counts.
#[derive(Debug, Clone, Deserialize)]
pub struct Read {
    /// The signal's name.
    pub signal: String,
    /// The date of the read (`YYYY-MM-DD`).
    pub read: String,
    /// The page the counts were read from.
    pub evidence: String,
    /// What the count counts.
    pub note: String,
}

/// One skill or plugin.
#[derive(Debug, Clone, Deserialize)]
pub struct Entry {
    /// A lowercase token; the item's id is `boopis:skills/<id>` or `boopis:plugins/<id>`.
    pub id: String,
    /// The display name.
    pub name: String,
    /// Who publishes it.
    pub publisher: String,
    /// One line.
    pub description: String,
    /// The licence, as the publisher's files state it.
    pub license: String,
    /// The publisher's repository (an `https://github.com/...` address).
    pub repo: String,
    /// The folder in it, none for a repository that is one plugin.
    #[serde(default)]
    pub subdir: Option<String>,
    /// The full commit the entry is pinned to.
    pub commit: String,
    /// A plugin's version at that commit.
    #[serde(default)]
    pub version: Option<String>,
    /// What it is for.
    #[serde(default)]
    pub categories: Vec<String>,
    /// What was checked, when, against which sources.
    pub verified: Verified,
    /// Its place in the order.
    pub popularity: Popularity,
}

/// What was checked.
#[derive(Debug, Clone, Deserialize)]
pub struct Verified {
    /// The date of the check.
    pub date: String,
    /// The manifest read at the commit, with its hash.
    pub manifest: Manifest,
    /// The publisher's pages read.
    pub sources: Vec<String>,
    /// A note on where the licence was found, when it is not a licence file.
    #[serde(default)]
    pub license_note: Option<String>,
}

/// The manifest read at the commit.
#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    /// Its path in the repository.
    pub path: String,
    /// The name it gives itself.
    pub name: String,
    /// The SHA-256 of its bytes at the commit.
    pub sha256: String,
}

/// One entry's count.
#[derive(Debug, Clone, Deserialize)]
pub struct Popularity {
    /// The signal's name (the list's `popularity` says what it counts).
    pub signal: String,
    /// The count as the page showed it (`1.2M`, `1,134,112`).
    pub shown: String,
    /// The count as a number: exact when the page showed an exact one, else the shown figure.
    pub installs: u64,
    /// The page it was read from.
    pub url: String,
}

/// The list, parsed once.
///
/// # Errors
/// `Config` when the compiled-in file does not parse (a build mistake; the unit tests catch it).
pub fn load() -> Result<&'static Recommended> {
    static LIST: OnceLock<std::result::Result<Recommended, String>> = OnceLock::new();
    LIST.get_or_init(|| serde_json::from_str(RECOMMENDED_JSON).map_err(|e| e.to_string()))
        .as_ref()
        .map_err(|e| Error::Config(format!("the recommended list does not parse: {e}")))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn is_commit(s: &str) -> bool {
        s.len() == 40
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }

    #[test]
    fn the_list_parses_and_every_entry_is_pinned_and_checked() {
        let l = load().unwrap();
        assert!(l.skills.len() >= 8 && l.plugins.len() >= 8);
        for (kind, list, read) in [
            ("skill", &l.skills, &l.popularity.skills),
            ("plugin", &l.plugins, &l.popularity.plugins),
        ] {
            assert!(crate::store::time::parse(&format!("{}T00:00:00Z", read.read)).is_some());
            assert!(read.evidence.starts_with("https://"), "{}", read.evidence);
            assert!(!read.note.is_empty());
            for e in list {
                let id = format!("{kind} {}", e.id);
                assert!(e.repo.starts_with("https://github.com/"), "{id}");
                assert!(is_commit(&e.commit), "{id}: a full commit, not a branch");
                assert_eq!(e.verified.manifest.sha256.len(), 64, "{id}");
                assert!(!e.verified.manifest.path.is_empty(), "{id}");
                assert_eq!(e.popularity.signal, read.signal, "{id}");
                assert!(e.popularity.installs > 0, "{id}: a count, not a guess");
                assert!(e.popularity.url.starts_with("https://"), "{id}");
                assert!(
                    !e.verified.sources.is_empty(),
                    "{id}: its publisher's pages"
                );
                assert!(
                    e.verified.sources.iter().all(|s| s.starts_with("https://")),
                    "{id}"
                );
                assert!(
                    crate::store::time::parse(&format!("{}T00:00:00Z", e.verified.date)).is_some(),
                    "{id}"
                );
                assert!(!e.license.trim().is_empty(), "{id}: a stated licence");
                assert!(e.description.len() <= 140, "{id}: one line");
            }
        }
    }

    #[test]
    fn each_kind_is_ordered_most_used_first() {
        let l = load().unwrap();
        for (kind, list) in [("skills", &l.skills), ("plugins", &l.plugins)] {
            let n: Vec<u64> = list.iter().map(|e| e.popularity.installs).collect();
            assert!(
                n.windows(2).all(|w| w[0] >= w[1]),
                "{kind}: most used first, {n:?}"
            );
        }
    }

    #[test]
    fn a_shown_count_and_its_number_agree() {
        // The skills directory rounds ("1.2M", "921.7K"); the number is that figure, never a finer one. An exact count agrees
        // with itself.
        let l = load().unwrap();
        for e in l.skills.iter().chain(&l.plugins) {
            let s = e.popularity.shown.replace(',', "");
            let n = match s.strip_suffix(['K', 'M']) {
                Some(f) => {
                    let unit = if s.ends_with('M') { 1_000_000 } else { 1_000 };
                    let (whole, tenth) = f.split_once('.').unwrap_or((f, "0"));
                    whole.parse::<u64>().unwrap() * unit
                        + tenth.parse::<u64>().unwrap() * (unit / 10)
                }
                None => s.parse().unwrap(),
            };
            assert_eq!(n, e.popularity.installs, "{}", e.id);
        }
    }

    #[test]
    fn ids_are_unique_in_a_kind_and_the_checked_tree_is_the_pinned_one() {
        let l = load().unwrap();
        for list in [&l.skills, &l.plugins] {
            let mut ids: Vec<&str> = list.iter().map(|e| e.id.as_str()).collect();
            ids.sort_unstable();
            let n = ids.len();
            ids.dedup();
            assert_eq!(ids.len(), n, "ids are unique");
            for e in list {
                let tree = match &e.subdir {
                    Some(sub) => format!("{}/tree/{}/{sub}", e.repo, e.commit),
                    None => format!("{}/tree/{}", e.repo, e.commit),
                };
                assert!(
                    e.verified.sources.contains(&tree),
                    "{}: the checked tree is the pinned one",
                    e.id
                );
            }
        }
    }
}
