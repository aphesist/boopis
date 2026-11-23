//! The paths a bot's instructions name that are not there (B14). A SOUL is a copy, frozen when it was written: when the
//! project it describes moves a file, nothing says so, and the bot keeps sending its teammates to a path that is gone. This
//! reads the instructions and lists the paths in them that do not exist on this computer. It only asks whether a path exists:
//! nothing is opened or read, so a secret folder a SOUL names is never looked into.
//!
//! What counts as a path, so that a sentence is never taken for one: a word that starts with `~/` or `/`, or a code span
//! (between backticks, with no space in it) that holds a `/`. A path with a placeholder in it (`episodes/<slug>.json`,
//! `out/*.mp4`, `$HOME/x`), an address (`https://...`) or a colon (`room:g-paper-past-@kai`) cannot be checked and is left
//! out. A relative path (`queue/pending.md`) is looked for under the folders the same instructions name that exist (the
//! project's folder, `~/repos/paper-shorts`); with no such folder it cannot be checked and is left out too: unknown is not
//! reported as missing.

use std::path::{Path, PathBuf};

/// The most of a SOUL that is read; a longer one is read up to here.
const MAX_BYTES: u64 = 256 * 1024;
/// Characters that make a word a pattern or a placeholder, not one path.
const PLACEHOLDER: &[char] = &[
    '<', '>', '{', '}', '[', ']', '*', '?', '$', '|', '@', ':', '#', '`', '"', '\'',
];

/// The candidate paths of `text`, as written, in order, each once.
fn candidates(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |raw: &str| {
        let word = raw.trim_end_matches(['.', ',', ';', ')', '!']);
        let word = word.trim_start_matches('(');
        if word.contains('/')
            && !word.starts_with('-')
            && !word.contains("//")
            && !word.contains(PLACEHOLDER)
            && word.chars().any(char::is_alphanumeric)
            && !out.iter().any(|w| w == word)
        {
            out.push(word.to_owned());
        }
    };
    for (i, part) in text.split('`').enumerate() {
        if i % 2 == 1 {
            // inside a code span: one path, or a command (with spaces), which is left out
            if !part.chars().any(char::is_whitespace) {
                push(part);
            }
        } else {
            for word in part.split_whitespace() {
                if word.starts_with("~/") || word.starts_with('/') {
                    push(word);
                }
            }
        }
    }
    out
}

/// Where `word` is, when it is absolute or under the home folder; `None` for a relative path.
fn absolute(word: &str, home: Option<&Path>) -> Option<PathBuf> {
    if let Some(rest) = word.strip_prefix("~/") {
        home.map(|h| h.join(rest))
    } else if word.starts_with('/') {
        Some(PathBuf::from(word))
    } else {
        None
    }
}

/// The paths `text` names that do not exist, as written. `home` is the user's home folder (for `~/`); without it, `~/` paths
/// cannot be checked and are left out.
#[must_use]
pub fn missing_paths(text: &str, home: Option<&Path>) -> Vec<String> {
    let words = candidates(text);
    let absolute_ones: Vec<(String, Option<PathBuf>)> = words
        .iter()
        .map(|w| (w.clone(), absolute(w, home)))
        .collect();
    // the folders the instructions name that exist: a relative path is looked for under them
    let bases: Vec<&PathBuf> = absolute_ones
        .iter()
        .filter_map(|(_, p)| p.as_ref())
        .filter(|p| p.is_dir())
        .collect();
    let mut out = Vec::new();
    for (word, at) in &absolute_ones {
        let there = match at {
            Some(p) => p.exists(),
            None if word.starts_with("~/") => continue, // no home folder to look in
            None if bases.is_empty() => continue,       // relative to nothing known
            None => bases.iter().any(|b| b.join(word).exists()),
        };
        if !there {
            out.push(word.clone());
        }
    }
    out
}

/// The paths the instructions of the bot whose home is `bot` (its `SOUL.md`) name that do not exist; none when it has no
/// instructions or they cannot be read.
#[must_use]
pub fn check(bot: &Path) -> Vec<String> {
    use std::io::Read;
    let Ok(file) = std::fs::File::open(bot.join("SOUL.md")) else {
        return Vec::new();
    };
    let mut text = String::new();
    if file.take(MAX_BYTES).read_to_string(&mut text).is_err() {
        return Vec::new();
    }
    missing_paths(&text, dirs::home_dir().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The owner's QA bot's instructions after the project moved its files (round 2, B11 there): the folder, a file that
    /// is still there, one that is gone, and the paths with placeholders, which cannot be checked.
    #[test]
    fn the_paths_that_are_gone_are_listed_and_the_rest_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let repo = home.join("repos/paper-shorts");
        std::fs::create_dir_all(repo.join("queue")).unwrap();
        std::fs::write(repo.join("queue/pending.md"), "").unwrap();
        std::fs::write(repo.join("CLAUDE.md"), "").unwrap();
        let soul = "\
# mira
- Workspace `~/repos/paper-shorts`. Read its `CLAUDE.md` first, and ~/repos/paper-shorts/CLAUDE.md is the source of truth.
- Put a line in `queue/pending.md`, never in `queue/approved.md`.
- Known issue: `out/qa/known/owner-1-woodpile-villager.png` (beat 3).
- Read `episodes/<slug>.json` and `worlds/<name>/scene.js`; outputs `out/<slug>.<lang>.mp4`.
- Run `uv run shorts.py sheet <slug>`; deliver to `room:g-paper-past-@kai`; see https://example.org/a/b.
- Never print anything in `~/.config/paper-shorts/` (keys). Old notes were in /srv/gone/notes.md.
";
        assert_eq!(
            missing_paths(soul, Some(home)),
            vec![
                "queue/approved.md".to_owned(),
                "out/qa/known/owner-1-woodpile-villager.png".to_owned(),
                "~/.config/paper-shorts/".to_owned(),
                "/srv/gone/notes.md".to_owned(),
            ]
        );
    }

    #[test]
    fn a_relative_path_with_no_folder_to_look_in_is_not_reported() {
        assert!(missing_paths("Write `out/qa/issues.md`.", None).is_empty());
        assert!(
            missing_paths("Read `~/repos/x/CLAUDE.md`.", None).is_empty(),
            "no home folder: unknown"
        );
    }

    #[test]
    fn a_bots_soul_is_read_from_its_home() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(check(tmp.path()).is_empty(), "no instructions");
        std::fs::write(tmp.path().join("SOUL.md"), "See /nowhere/at/all.md.").unwrap();
        assert_eq!(check(tmp.path()), vec!["/nowhere/at/all.md".to_owned()]);
    }
}
