use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Parsed metadata extracted from YAML frontmatter (`--- ... ---`) or top-level YAML manifests.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub globs: Vec<String>,
    pub trigger: Option<String>,
    pub always_apply: Option<bool>,
    pub body: String,
}

fn key_value_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$").expect("valid key-value regex")
    })
}

fn list_item_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\s+-\s+(.+)$").expect("valid yaml list item regex"))
}

/// Parses optional YAML frontmatter (`--- ... ---`) at the top of a Markdown / `.mdc` file
/// without external YAML crate dependencies, extracting `name`, `description`, `globs`,
/// `trigger`, and `alwaysApply` plus the remaining document `body`.
pub fn parse_frontmatter(content: &str) -> Frontmatter {
    let normalized = content
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");

    let mut lines = normalized.lines();
    let Some(first_line) = lines.next() else {
        return Frontmatter::default();
    };

    if first_line.trim() != "---" {
        return Frontmatter {
            body: normalized,
            ..Default::default()
        };
    }

    let mut yaml_lines: Vec<&str> = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();
    let mut found_closing = false;

    for line in lines {
        if !found_closing && matches!(line.trim(), "---" | "...") {
            found_closing = true;
            continue;
        }
        if found_closing {
            body_lines.push(line);
        } else {
            yaml_lines.push(line);
        }
    }

    if !found_closing {
        // Malformed / unclosed frontmatter; treat whole document as body safely.
        return Frontmatter {
            body: normalized,
            ..Default::default()
        };
    }

    let yaml_block = yaml_lines.join("\n");
    let mut fm = parse_yaml_fields(&yaml_block);
    fm.body = body_lines.join("\n");
    fm
}

/// Parses top-level YAML key-value metadata directly (used both by `parse_frontmatter`
/// and standalone YAML files such as Hermes `plugin-catalog/*.yaml`).
pub fn parse_yaml_fields(yaml_text: &str) -> Frontmatter {
    let normalized = yaml_text
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n");
    let kv_re = key_value_regex();
    let list_re = list_item_regex();

    let mut fm = Frontmatter::default();

    enum ActiveMultiline {
        None,
        Scalar {
            key: String,
            folded: bool,
            lines: Vec<String>,
        },
        GlobsList,
    }

    let mut state = ActiveMultiline::None;

    let flush_scalar = |fm: &mut Frontmatter, state: &mut ActiveMultiline| {
        if let ActiveMultiline::Scalar { key, folded, lines } =
            std::mem::replace(state, ActiveMultiline::None)
        {
            let joined = if folded {
                lines
                    .into_iter()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ")
            } else {
                lines.join("\n").trim().to_string()
            };
            if !joined.is_empty() {
                assign_scalar_field(fm, &key, joined);
            }
        }
    };

    for raw_line in normalized.lines() {
        let trimmed = raw_line.trim();

        // Check active multi-line continuation before evaluating new top-level keys.
        match &mut state {
            ActiveMultiline::Scalar { lines, .. } => {
                let is_indented = raw_line.starts_with(' ') || raw_line.starts_with('\t');
                if trimmed.is_empty() {
                    lines.push(String::new());
                    continue;
                } else if is_indented {
                    lines.push(trimmed.to_string());
                    continue;
                } else {
                    flush_scalar(&mut fm, &mut state);
                }
            }
            ActiveMultiline::GlobsList => {
                if let Some(caps) = list_re.captures(raw_line) {
                    let item = strip_quotes(caps[1].trim());
                    if !item.is_empty() {
                        fm.globs.push(item);
                    }
                    continue;
                } else if trimmed.is_empty() {
                    continue;
                } else {
                    state = ActiveMultiline::None;
                }
            }
            ActiveMultiline::None => {}
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Only parse top-level keys (column 0) so nested blocks like metadata.hermes don't clobber.
        let is_indented = raw_line.starts_with(' ') || raw_line.starts_with('\t');
        if is_indented {
            continue;
        }

        let Some(caps) = kv_re.captures(raw_line) else {
            continue;
        };

        let key = caps[1].to_ascii_lowercase();
        let raw_val = caps[2].trim();

        if key == "globs" || key == "scope_globs" {
            if raw_val.is_empty() {
                state = ActiveMultiline::GlobsList;
            } else {
                fm.globs.extend(parse_glob_value(raw_val));
            }
            continue;
        }

        if matches!(raw_val, ">" | ">-" | "|" | "|-") {
            let folded = raw_val.starts_with('>');
            state = ActiveMultiline::Scalar {
                key,
                folded,
                lines: Vec::new(),
            };
            continue;
        }

        let val = strip_quotes(raw_val);
        if !val.is_empty() {
            assign_scalar_field(&mut fm, &key, val);
        }
    }

    flush_scalar(&mut fm, &mut state);
    fm
}

fn assign_scalar_field(fm: &mut Frontmatter, key: &str, value: String) {
    match key {
        "name" => fm.name = Some(value),
        "description" => fm.description = Some(value),
        "trigger" => fm.trigger = Some(value),
        "alwaysapply" | "always_apply" | "always-apply" => {
            if let Ok(b) = value.to_ascii_lowercase().parse::<bool>() {
                fm.always_apply = Some(b);
            }
        }
        _ => {}
    }
}

/// Parses inline YAML array (`["*.rs", "*.ts"]`), comma-separated Cursor glob string
/// (`*.rs, src/**/*.{ts,tsx}`), or single glob pattern, preserving `{a,b}` brace groups.
pub fn parse_glob_value(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Vec::new();
    }

    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        let inner = &trimmed[1..trimmed.len() - 1];
        return split_respecting_braces(inner.trim())
            .into_iter()
            .map(|part| strip_quotes(part.trim()))
            .filter(|part| !part.is_empty())
            .collect();
    }

    let first_pass = split_respecting_braces(trimmed);
    if first_pass.len() == 1 {
        let unquoted = strip_quotes(first_pass[0].trim());
        return split_respecting_braces(&unquoted)
            .into_iter()
            .map(|part| strip_quotes(part.trim()))
            .filter(|part| !part.is_empty())
            .collect();
    }

    first_pass
        .into_iter()
        .map(|part| strip_quotes(part.trim()))
        .filter(|part| !part.is_empty())
        .collect()
}

fn split_respecting_braces(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut brace_depth = 0usize;
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    for ch in input.chars() {
        match ch {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
                current.push(ch);
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
                current.push(ch);
            }
            '{' if !in_single_quote && !in_double_quote => {
                brace_depth += 1;
                current.push(ch);
            }
            '}' if !in_single_quote && !in_double_quote => {
                brace_depth = brace_depth.saturating_sub(1);
                current.push(ch);
            }
            ',' if brace_depth == 0 && !in_single_quote && !in_double_quote => {
                parts.push(std::mem::take(&mut current));
            }
            _ => current.push(ch),
        }
    }

    if !current.trim().is_empty() {
        parts.push(current);
    }

    parts
}

fn strip_quotes(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].trim().to_string()
    } else {
        trimmed.to_string()
    }
}
