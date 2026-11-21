//! What a folder holds, read without running anything: skills (`SKILL.md` with its front matter, the agentskills format),
//! Claude Code plugins (`.claude-plugin/plugin.json`), mods (a plugin whose `hooks/hooks.json` names `modules`), and the
//! counts of what a tree adds. Used when the user adds a source (a GitHub address, a folder), and when an item is staged to
//! check its manifest (`hx.store.invalid_manifest`). The plugin (workstream B) does the full analysis for the plan; this is the
//! host's own reading, enough to list an item truthfully and to refuse one that is not what it says.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde_json::Value;

use super::stage;
use super::types::ComponentCounts;

const MAX_SKILLS: usize = 500;

/// The key-value front matter of a `SKILL.md`: `---` on the first line, `key: value` lines, `---`. Quotes are stripped and a
/// folded value (`>`, `|`, `>-`) takes the indented lines under it. Not a YAML parser: nested values are ignored.
#[must_use]
pub fn frontmatter(text: &str) -> Option<BTreeMap<String, String>> {
    let mut lines = text.strip_prefix('\u{feff}').unwrap_or(text).lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let mut out = BTreeMap::new();
    let mut open: Option<String> = None;
    let mut closed = false;
    for line in lines {
        if line.trim_end() == "---" {
            closed = true;
            break;
        }
        if let Some(key) = &open {
            if line.starts_with([' ', '\t']) {
                let e = out.entry(key.clone()).or_insert_with(String::new);
                if !e.is_empty() {
                    e.push(' ');
                }
                e.push_str(line.trim());
                continue;
            }
            open = None;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        if k.starts_with([' ', '\t']) || k.is_empty() {
            continue;
        }
        let v = v.trim();
        if matches!(v, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            open = Some(k.trim().to_owned());
            out.insert(k.trim().to_owned(), String::new());
        } else {
            let v = v.trim_matches(|c| c == '"' || c == '\'');
            out.insert(k.trim().to_owned(), v.to_owned());
        }
    }
    closed.then_some(out)
}

/// A skill, as its `SKILL.md` says.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillDoc {
    /// The folder, relative to the root (`""` for the root).
    pub dir: String,
    /// Its name.
    pub name: String,
    /// What it says it does.
    pub description: String,
    /// Its licence, when stated.
    pub license: Option<String>,
}

fn skill_name_ok(n: &str) -> bool {
    (1..=64).contains(&n.len())
        && !n.starts_with('-')
        && !n.ends_with('-')
        && n.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Check a `SKILL.md` against the agentskills format: a front matter with a `name` (1 to 64 of a-z, 0-9 and `-`, equal to its
/// folder's name unless it is the root) and a `description` (1 to 1024).
///
/// # Errors
/// What is wrong, in words.
pub fn skill_doc(dir: &str, text: &str) -> Result<SkillDoc, String> {
    let fm =
        frontmatter(text).ok_or("SKILL.md has no front matter (--- name and description ---)")?;
    let name = fm
        .get("name")
        .filter(|n| !n.is_empty())
        .ok_or("the front matter has no name")?;
    if !skill_name_ok(name) {
        return Err(format!(
            "the name {name:?} is not 1 to 64 of a-z, 0-9 and -"
        ));
    }
    let leaf = dir.rsplit('/').next().unwrap_or("");
    if !dir.is_empty() && leaf != name {
        return Err(format!(
            "the name {name:?} is not the folder's name {leaf:?}"
        ));
    }
    let description = fm
        .get("description")
        .filter(|d| !d.is_empty())
        .ok_or("the front matter has no description")?;
    if description.chars().count() > 1024 {
        return Err("the description is longer than 1024 characters".into());
    }
    Ok(SkillDoc {
        dir: dir.to_owned(),
        name: name.clone(),
        description: description.clone(),
        license: fm.get("license").cloned(),
    })
}

/// Every folder under `root` with a `SKILL.md`, each checked.
#[must_use]
pub fn find_skills(root: &Path) -> Vec<(String, Result<SkillDoc, String>)> {
    let mut out = Vec::new();
    for rel in stage::list_files(root).unwrap_or_default() {
        if out.len() >= MAX_SKILLS {
            break;
        }
        let Some(dir) = rel
            .strip_suffix("SKILL.md")
            .map(|d| d.trim_end_matches('/'))
        else {
            continue;
        };
        if !(rel == "SKILL.md" || rel.ends_with("/SKILL.md")) {
            continue;
        }
        let text = fs::read_to_string(root.join(&rel)).unwrap_or_default();
        out.push((dir.to_owned(), skill_doc(dir, &text)));
    }
    out
}

/// A Claude Code plugin's manifest.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PluginDoc {
    /// Its name.
    pub name: String,
    /// Its version.
    pub version: Option<String>,
    /// What it is.
    pub description: Option<String>,
    /// Its licence.
    pub license: Option<String>,
    /// Its author.
    pub author: Option<String>,
    /// Its home page.
    pub homepage: Option<String>,
    /// Its hooks file names modules: it is a mod.
    pub is_mod: bool,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The plugin manifest at `root/.claude-plugin/plugin.json`.
///
/// # Errors
/// `Ok(None)` when there is none; `Err` when it is there and unusable (unreadable JSON, no name).
pub fn plugin_doc(root: &Path) -> Result<Option<PluginDoc>, String> {
    let path = root.join(".claude-plugin/plugin.json");
    if !path.is_file() {
        return Ok(None);
    }
    let v = read_json(&path).ok_or("plugin.json is not readable JSON")?;
    let text = |k: &str| {
        v.get(k)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|t| !t.is_empty())
    };
    let name = text("name").ok_or("plugin.json has no name")?;
    let hooks = read_json(&root.join("hooks/hooks.json"));
    let is_mod = hooks
        .as_ref()
        .is_some_and(|h| h.get("modules").is_some() || h.pointer("/hooks/modules").is_some());
    Ok(Some(PluginDoc {
        name,
        version: text("version"),
        description: text("description"),
        license: text("license"),
        author: v
            .pointer("/author/name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| text("author")),
        homepage: text("homepage"),
        is_mod,
    }))
}

fn u(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// What a tree adds, by counting files in the places a plugin keeps its parts. Exact, because it is read from the tree.
#[must_use]
pub fn count_components(root: &Path) -> ComponentCounts {
    let files = stage::list_files(root).unwrap_or_default();
    let under = |prefix: &str, suffix: &str| {
        files
            .iter()
            .filter(|f| f.starts_with(prefix) && f.ends_with(suffix))
            .count()
    };
    let hooks = read_json(&root.join("hooks/hooks.json"));
    let modules = hooks
        .as_ref()
        .and_then(|h| h.get("modules").or_else(|| h.pointer("/hooks/modules")))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let hook_count = hooks
        .as_ref()
        .and_then(|h| h.get("hooks"))
        .and_then(Value::as_object)
        .map_or(usize::from(hooks.is_some()), serde_json::Map::len);
    let mcp = read_json(&root.join(".mcp.json")).map_or(0, |m| {
        m.get("mcpServers").and_then(Value::as_object).map_or(
            m.as_object().map_or(0, serde_json::Map::len),
            serde_json::Map::len,
        )
    });
    let scripts = files
        .iter()
        .filter(|f| {
            let ext = f.rsplit('.').next().unwrap_or("");
            (f.starts_with("scripts/") || f.contains("/scripts/") || f.starts_with("bin/"))
                && matches!(ext, "sh" | "py" | "js" | "ts" | "rb" | "ps1" | "bash")
        })
        .count();
    ComponentCounts {
        known: true,
        skills: u(files
            .iter()
            .filter(|f| f.ends_with("/SKILL.md") || *f == "SKILL.md")
            .count()),
        commands: u(under("commands/", ".md")),
        agents: u(under("agents/", ".md")),
        hooks: u(hook_count),
        mcp_servers: u(mcp),
        modules: u(modules),
        scripts: u(scripts),
        python: u(files.iter().filter(|f| f.ends_with(".py")).count()),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const SKILL: &str = "---\nname: release-notes\ndescription: >\n  Turns commits into notes.\n  Grouped by reader impact.\nlicense: \"Apache-2.0\"\n---\n# Body\n";

    #[test]
    fn front_matter_is_read_with_folded_values_and_quotes() {
        let fm = frontmatter(SKILL).unwrap();
        assert_eq!(
            fm["description"],
            "Turns commits into notes. Grouped by reader impact."
        );
        assert_eq!(fm["license"], "Apache-2.0");
        assert!(frontmatter("# no front matter").is_none());
        assert!(
            frontmatter("---\nname: x\n").is_none(),
            "an unclosed block is not one"
        );
    }

    #[test]
    fn a_skill_is_checked_against_the_format() {
        assert_eq!(
            skill_doc("skills/release-notes", SKILL).unwrap().name,
            "release-notes"
        );
        assert!(
            skill_doc("skills/other", SKILL)
                .unwrap_err()
                .contains("folder's name")
        );
        assert!(skill_doc("", SKILL).is_ok(), "the root may hold any name");
        assert!(
            skill_doc("x", "---\nname: Bad Name\ndescription: d\n---\n")
                .unwrap_err()
                .contains("not 1 to 64")
        );
        assert!(
            skill_doc("x", "---\nname: x\n---\n")
                .unwrap_err()
                .contains("description")
        );
        let long = format!("---\nname: x\ndescription: {}\n---\n", "d".repeat(1025));
        assert!(skill_doc("x", &long).unwrap_err().contains("1024"));
    }

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn a_tree_is_read_for_skills_a_plugin_and_what_it_adds() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        write(r, "skills/release-notes/SKILL.md", SKILL);
        write(r, "skills/broken/SKILL.md", "no front matter");
        write(r, "skills/release-notes/scripts/run.sh", "echo hi");
        write(
            r,
            ".claude-plugin/plugin.json",
            r#"{"name":"kit","version":"1.2.0","author":{"name":"A"},"license":"MIT"}"#,
        );
        write(
            r,
            "hooks/hooks.json",
            r#"{"hooks":{"PreToolUse":[]},"modules":["a.js","b.js"]}"#,
        );
        write(r, "commands/go.md", "x");
        write(r, ".mcp.json", r#"{"mcpServers":{"a":{},"b":{}}}"#);
        let skills = find_skills(r);
        assert_eq!(skills.len(), 2);
        assert!(
            skills
                .iter()
                .any(|(d, s)| d == "skills/broken" && s.is_err())
        );
        let doc = plugin_doc(r).unwrap().unwrap();
        assert_eq!(
            (doc.name.as_str(), doc.is_mod, doc.author.as_deref()),
            ("kit", true, Some("A"))
        );
        let c = count_components(r);
        assert_eq!(
            (
                c.skills,
                c.commands,
                c.hooks,
                c.mcp_servers,
                c.modules,
                c.scripts
            ),
            (2, 1, 1, 2, 2, 1)
        );
        assert!(c.known);
        assert!(
            plugin_doc(d.path().join("skills").as_path())
                .unwrap()
                .is_none()
        );
        write(r, ".claude-plugin/plugin.json", "{}");
        assert!(plugin_doc(r).is_err());
    }
}
