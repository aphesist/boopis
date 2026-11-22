//! The skills of a bot that are made for another OS (ADR-0042). A skill names the systems it works on in its `SKILL.md`
//! front matter (`platforms: [macos]`); the engine leaves such a skill out of the prompt on any other system, but still lists
//! it as on (`profiles.describe`), so a Linux bot shows `apple-notes` and `imessage` switched on. boopis switches them off in
//! the bot's own `skills.disabled` when it makes a bot, and once for the bots that exist. A skill with no `platforms` works
//! everywhere; a value this reader does not understand leaves the skill as it is.

use std::path::Path;

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

#[cfg(test)]
mod tests {
    use super::*;

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
