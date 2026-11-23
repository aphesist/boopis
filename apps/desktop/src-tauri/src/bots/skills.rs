//! Which of a bot's skills boopis switches off, in the bot's own `skills.disabled` (the engine's one list of skills a home does
//! not offer; `profiles.describe` and the prompt's skill index both read it).
//!
//! - **Made for another OS** (ADR-0042). A skill names the systems it works on in its `SKILL.md` front matter
//!   (`platforms: [macos]`); the engine leaves such a skill out of the prompt on any other system, but still lists it as on
//!   (`profiles.describe`), so a Linux bot shows `apple-notes` and `imessage` switched on. Switched off when
//!   boopis makes a bot, and once for the bots that exist. A skill with no `platforms` works everywhere; a value this reader does not understand leaves the skill as it is.
//! - **Outside the bots' default index** (ADR-0046). Every engine-bundled skill sits in every prompt's skill index; a bot keeps
//!   only the ones `apps/shared/data/bot-skills.json` names, switched off when boopis makes the bot and once for the bots that
//!   exist. Only the engine's bundled skills (its own list, `skills/.bundled_manifest`) are ever switched off this way.

use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

/// The bots' default index, compiled in.
pub const DEFAULT_JSON: &str = include_str!("../../../../shared/data/bot-skills.json");

/// The engine's names for the systems (`agent/skill_utils.py` `PLATFORM_MAP`), and this build's.
const NAMES: &[(&str, &str)] = &[
    ("macos", "darwin"),
    ("linux", "linux"),
    ("windows", "win32"),
];

/// This system as the engine names it (`sys.platform`).
#[must_use]
pub fn this_system() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(windows) {
        "win32"
    } else {
        "linux"
    }
}

/// The `platforms` a `SKILL.md` names: `None` when it names none (the skill works everywhere) or the front matter cannot be
/// read. Reads the one key, inline (`platforms: [macos, linux]`, `platforms: macos`) or as a block list.
#[must_use]
pub fn platforms(skill_md: &str) -> Option<Vec<String>> {
    let mut lines = skill_md.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut found: Option<Vec<String>> = None;
    let mut in_block = false;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if in_block {
            if let Some(item) = trimmed.strip_prefix("- ") {
                found.get_or_insert_with(Vec::new).push(clean(item));
                continue;
            }
            if line.starts_with(' ') || line.starts_with('\t') || trimmed.is_empty() {
                continue;
            }
            in_block = false;
        }
        if let Some(rest) = line.strip_prefix("platforms:") {
            let rest = rest.trim();
            if rest.is_empty() {
                in_block = true;
            } else if let Some(inner) = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                found = Some(
                    inner
                        .split(',')
                        .map(clean)
                        .filter(|s| !s.is_empty())
                        .collect(),
                );
            } else {
                found = Some(vec![clean(rest)]);
            }
        }
    }
    found.filter(|f| !f.is_empty())
}

fn clean(raw: &str) -> String {
    raw.split('#')
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_lowercase()
}

/// Whether a skill that names `platforms` works on `system` (the engine's rule: a name, or the system it maps to, that the
/// system's name starts with).
#[must_use]
pub fn works_on(platforms: &[String], system: &str) -> bool {
    platforms.iter().any(|p| {
        let mapped = NAMES
            .iter()
            .find(|(name, _)| name == p)
            .map_or(p.as_str(), |(_, sys)| sys);
        system.starts_with(mapped)
    })
}

/// The skills under `<home>/skills` (by folder name, as `profiles.describe` lists them) that name only other systems.
#[must_use]
pub fn for_other_systems(home: &Path, system: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![home.join("skills")];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > 20_000 {
                return out; // a skills folder this large is not one boopis walks
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if !kind.is_dir() || name.starts_with('.') || name == "node_modules" {
                continue;
            }
            let md = path.join("SKILL.md");
            match std::fs::read_to_string(&md) {
                Ok(text) => {
                    if platforms(&text).is_some_and(|p| !works_on(&p, system)) {
                        out.push(name);
                    }
                }
                Err(_) => stack.push(path), // a category folder: its skills are one level down
            }
        }
    }
    out.sort();
    out
}

#[derive(Deserialize)]
struct Defaults {
    on: Vec<Kept>,
}

#[derive(Deserialize)]
struct Kept {
    name: String,
}

/// The bundled skills a new bot keeps on (`bot-skills.json`). Empty when the file cannot be read, which a test rules out.
#[must_use]
pub fn kept_on() -> &'static [String] {
    static KEPT: OnceLock<Vec<String>> = OnceLock::new();
    KEPT.get_or_init(|| {
        serde_json::from_str::<Defaults>(DEFAULT_JSON)
            .map(|d| d.on.into_iter().map(|k| k.name).collect())
            .unwrap_or_default()
    })
}

/// Whether a new bot has the skill `name` on: every skill that is not the engine's bundled one, and the bundled ones the
/// default index names. `bundled` is the engine's list of its bundled skills. With no index (it could not be read) every skill
/// stays on: nothing is switched off on a list nobody wrote.
#[must_use]
pub fn on_for_a_new_bot(name: &str, bundled: &[String]) -> bool {
    let kept = kept_on();
    kept.is_empty() || !bundled.iter().any(|b| b == name) || kept.iter().any(|k| k == name)
}

/// Whether a new bot has the skill `name` on from the start: a bundled one (`bundled` is the engine's list) the default index
/// keeps. A team file names every other skill a bot has on (`team export`).
#[must_use]
pub fn a_new_bot_has(name: &str, bundled: &[String]) -> bool {
    let kept = kept_on();
    bundled.iter().any(|b| b == name) && (kept.is_empty() || kept.iter().any(|k| k == name))
}

/// The engine's bundled skills in a home, by name: its own list, `<home>/skills/.bundled_manifest` (`name:hash`, or a bare
/// `name` in its first version). Empty when there is no such list, so nothing is taken for bundled that the engine did not say.
#[must_use]
pub fn bundled(home: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(home.join("skills").join(".bundled_manifest")) else {
        return Vec::new();
    };
    let mut out: Vec<String> = text
        .lines()
        .filter_map(|l| l.split(':').next())
        .map(str::trim)
        .filter(|n| !n.is_empty() && !n.starts_with('#'))
        .map(str::to_owned)
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The bundled skills of a home that the bots' default index leaves off.
#[must_use]
pub fn outside_default(home: &Path) -> Vec<String> {
    let bundled = bundled(home);
    bundled
        .iter()
        .filter(|n| !on_for_a_new_bot(n, &bundled))
        .cloned()
        .collect()
}

/// The bots that were given the default index once (`<root>/boopis/bot-skills.json`, boopis's own file), so a bot prepared as
/// new again (made by `boopis team apply`, then seen by the app) does not lose the skills switched on since.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, Deserialize)]
#[serde(default)]
pub struct Given {
    /// The schema version.
    pub version: u32,
    /// The bots, by name.
    pub bots: std::collections::BTreeSet<String>,
}

impl Given {
    fn path(root: &Path) -> std::path::PathBuf {
        root.join("boopis").join("bot-skills.json")
    }

    /// Read it; a missing or unreadable file gives no bot.
    #[must_use]
    pub fn load(root: &Path) -> Self {
        std::fs::read_to_string(Self::path(root))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Whether the bot `name` was given it.
    #[must_use]
    pub fn has(&self, name: &str) -> bool {
        self.bots.contains(name)
    }

    /// Write it atomically (a temporary file, then a rename).
    ///
    /// # Errors
    /// `Io` when the write fails.
    pub fn save(&self, root: &Path) -> crate::error::Result<()> {
        let path = Self::path(root);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        let text = serde_json::to_string_pretty(&Self {
            version: 1,
            ..self.clone()
        })
        .map_err(|e| crate::error::Error::Io(e.to_string()))?;
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_index_reads_and_keeps_what_the_engine_needs() {
        let on = kept_on();
        assert!(!on.is_empty(), "bot-skills.json must parse");
        // the engine's manual cannot be switched off, and the kanban review lane loads sdlc-review into its workers
        for must in ["hermes-agent", "sdlc-review"] {
            assert!(on.iter().any(|k| k == must), "{must}");
        }
    }

    #[test]
    fn only_the_engines_bundled_skills_outside_the_index_go_off() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("skills")).unwrap();
        std::fs::write(
            tmp.path().join("skills/.bundled_manifest"),
            "apple-notes:a969\narxiv:1f2a\nhermes-agent:a6fb\nsdlc-review:4a4b\ngithub:78ea\n\n",
        )
        .unwrap();
        assert_eq!(
            outside_default(tmp.path()),
            vec![
                "apple-notes".to_owned(),
                "arxiv".to_owned(),
                "github".to_owned()
            ]
        );
        let bundled = bundled(tmp.path());
        assert!(
            on_for_a_new_bot("papercraft", &bundled),
            "not bundled: the bot's own"
        );
        assert!(on_for_a_new_bot("boopis-handoffs", &bundled));
        assert!(!on_for_a_new_bot("github", &bundled));
        assert!(a_new_bot_has("sdlc-review", &bundled));
        assert!(!a_new_bot_has("github", &bundled) && !a_new_bot_has("papercraft", &bundled));
        // no list from the engine: nothing is taken for bundled
        let none = tempfile::tempdir().unwrap();
        assert!(outside_default(none.path()).is_empty());
    }

    #[test]
    fn the_front_matter_names_the_systems() {
        assert_eq!(
            platforms("---\nname: apple-notes\nplatforms: [macos]\n---\nbody"),
            Some(vec!["macos".into()])
        );
        assert_eq!(
            platforms("---\nplatforms:\n  - macos\n  - \"linux\"\ndescription: x\n---\n"),
            Some(vec!["macos".into(), "linux".into()])
        );
        assert_eq!(
            platforms("---\nplatforms: windows # only there\n---\n"),
            Some(vec!["windows".into()])
        );
        assert_eq!(platforms("---\nname: everywhere\n---\n"), None);
        assert_eq!(platforms("no front matter\nplatforms: [macos]\n"), None);
    }

    #[test]
    fn the_engines_rule_decides() {
        let mac = vec!["macos".to_owned()];
        assert!(works_on(&mac, "darwin"));
        assert!(!works_on(&mac, "linux"));
        assert!(works_on(&["linux".to_owned(), "macos".to_owned()], "linux"));
        assert!(works_on(&["windows".to_owned()], "win32"));
    }

    #[test]
    fn a_linux_bot_turns_off_the_mac_skills_only() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = tmp.path().join("skills");
        for (dir, fm) in [
            ("apple/apple-notes", "platforms: [macos]"),
            ("apple/imessage", "platforms:\n  - macos"),
            ("arxiv", "name: arxiv"),
            ("linux-only", "platforms: [linux]"),
        ] {
            std::fs::create_dir_all(skills.join(dir)).unwrap();
            std::fs::write(
                skills.join(dir).join("SKILL.md"),
                format!("---\n{fm}\n---\n"),
            )
            .unwrap();
        }
        assert_eq!(
            for_other_systems(tmp.path(), "linux"),
            vec!["apple-notes".to_owned(), "imessage".to_owned()]
        );
        assert_eq!(
            for_other_systems(tmp.path(), "darwin"),
            vec!["linux-only".to_owned()]
        );
    }
}
