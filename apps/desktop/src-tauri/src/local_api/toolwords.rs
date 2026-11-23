//! What a tool call is touching, in a few safe words (B40): "Read a file · shots/03.json", "Run a command · cargo test",
//! "Open a page · docs.rs". The engine's `tool.start` carries the call's full arguments (`args`); only the parts that say
//! what is being touched leave the host, and only these:
//! - a file's path, as its last two parts (never the folders above them, which name the owner's home);
//! - a command's program and, when it is a plain word, its subcommand (never its arguments, flags or environment);
//! - a page's host (never its path, query or credentials).
//!
//! Anything else (a search query, a message, file contents, a script) is left out: a tool that names none of these shows its
//! verb alone. The words then pass the local API's scrubber and its cap like every other engine text (`feed.rs`).

use serde_json::Value;

/// The longest detail before the scrubber's own cap: a short line on an island or a notch.
pub const MAX_DETAIL: usize = 80;

/// The verb a tool's name says, in words a person reads; `None` for a tool this table does not know (its name is shown).
fn verb(tool: &str) -> Option<&'static str> {
    let t = tool.to_ascii_lowercase();
    let t = t.rsplit(['.', ':']).next().unwrap_or(&t);
    Some(match t {
        "read_file" | "read" | "view" | "cat" | "open_file" | "read_many_files" => "Read a file",
        "write_file" | "write" | "create_file" => "Write a file",
        "patch" | "edit" | "edit_file" | "apply_patch" | "str_replace" | "str_replace_editor"
        | "multi_edit" => "Edit a file",
        "search_files" | "grep" | "glob" | "find_files" | "file_search" | "list_files"
        | "list_directory" => "Search files",
        "terminal" | "bash" | "shell" | "run_command" | "execute_command" | "process" => {
            "Run a command"
        }
        "execute_code" | "python" | "code_execution" | "exec" => "Run code",
        "web_fetch" | "fetch" | "browse" | "browser_navigate" | "browser_open" | "web_extract"
        | "url_fetch" => "Open a page",
        "web_search" => "Search the web",
        "pack" => "Read code",
        "ship" => "Write files",
        "dispatch" | "delegate_task" => "Hand off a task",
        _ => return None,
    })
}

fn text<'a>(args: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| args.get(*k).and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// A path's last two parts (`shots/03.json`), with no folder above them.
fn path_tail(path: &str) -> Option<String> {
    let parts: Vec<&str> = path
        .split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != ".")
        .collect();
    match parts.as_slice() {
        [] => None,
        [one] => Some((*one).to_owned()),
        [.., dir, file] => Some(format!("{dir}/{file}")),
    }
}

/// A word that can only be a subcommand (`status`, `test`, `install`): letters, digits and `-`/`_` inside, short, and not a
/// flag, a path, an assignment or a value with anything else in it.
fn plain_word(w: &str) -> bool {
    !w.is_empty()
        && w.len() <= 24
        && w.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && w.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// A command's program and plain subcommand: `cargo test`, `git status`, `ffmpeg`. Leading `NAME=value` assignments are
/// skipped (an environment value never leaves); only the first line counts.
fn command_head(command: &str) -> Option<String> {
    let line = command.lines().next().unwrap_or_default();
    let mut words = line.split_whitespace().skip_while(|w| w.contains('='));
    let program = words.next()?;
    let program = program
        .rsplit('/')
        .next()
        .unwrap_or(program)
        .trim_matches(|c| c == '"' || c == '\'');
    if program.is_empty()
        || !program
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.+".contains(c))
    {
        return None;
    }
    Some(match words.next().filter(|w| plain_word(w)) {
        Some(sub) => format!("{program} {sub}"),
        None => program.to_owned(),
    })
}

/// A page's host (`docs.rs`): no scheme, credentials, port, path or query.
fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host = authority.rsplit('@').next().unwrap_or_default();
    let host = if host.starts_with('[') {
        host.split(']')
            .next()
            .map(|h| format!("{h}]"))
            .unwrap_or_default()
    } else {
        host.split(':').next().unwrap_or_default().to_owned()
    };
    let ok = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.[]:".contains(c));
    ok.then(|| host.to_ascii_lowercase())
}

/// What the call touches, from its arguments: a path, else a command, else a page's host.
fn object(args: &Value) -> Option<String> {
    if let Some(p) = text(
        args,
        &[
            "path",
            "file_path",
            "filepath",
            "file",
            "filename",
            "target_file",
            "notebook_path",
        ],
    ) {
        return path_tail(p);
    }
    if let Some(first) = args
        .get("paths")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(Value::as_str)
    {
        let more = args
            .get("paths")
            .and_then(Value::as_array)
            .map_or(0, |a| a.len() - 1);
        return path_tail(first).map(|p| if more > 0 { format!("{p} +{more}") } else { p });
    }
    let command = text(args, &["command", "cmd"])
        .map(str::to_owned)
        .or_else(|| {
            args.get("command")
                .or_else(|| args.get("argv"))
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" ")
                })
        });
    if let Some(c) = command {
        return command_head(&c);
    }
    text(args, &["url", "uri", "href"]).and_then(url_host)
}

fn cut(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_owned();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// The detail of a tool call: its verb and what it touches, `None` when neither is known. The caller scrubs it.
#[must_use]
pub fn detail(tool: &str, args: Option<&Value>) -> Option<String> {
    let thing = args.filter(|a| a.is_object()).and_then(object);
    let words = match (verb(tool), thing) {
        (Some(v), Some(t)) => format!("{v} · {t}"),
        (Some(v), None) => v.to_owned(),
        (None, Some(t)) if !tool.trim().is_empty() => format!("{} · {t}", tool.trim()),
        _ => return None,
    };
    Some(cut(&words, MAX_DETAIL))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_file_shows_its_last_two_parts_and_never_the_home_above_them() {
        assert_eq!(
            detail(
                "read_file",
                Some(&json!({"path": "/home/owner/repos/paper-shorts/shots/03.json"}))
            )
            .as_deref(),
            Some("Read a file · shots/03.json")
        );
        assert_eq!(
            detail("write_file", Some(&json!({"file_path": "notes.md"}))).as_deref(),
            Some("Write a file · notes.md")
        );
        assert_eq!(
            detail(
                "patch",
                Some(&json!({"paths": ["a/b/c.rs", "d.rs", "e.rs"]}))
            )
            .as_deref(),
            Some("Edit a file · b/c.rs +2")
        );
    }

    #[test]
    fn a_command_shows_its_program_and_subcommand_and_nothing_else() {
        let cases = [
            (
                "cargo test -p boopis-host --lib",
                "Run a command · cargo test",
            ),
            ("git status", "Run a command · git status"),
            (
                "API_KEY=sk-123456 curl -H 'Authorization: Bearer x' https://a.b/c?token=1",
                "Run a command · curl",
            ),
            (
                "/usr/bin/ffmpeg -i in.mp4 out.mp4",
                "Run a command · ffmpeg",
            ),
            (
                "python3 scripts/render.py --secret=abc",
                "Run a command · python3",
            ),
            ("npm install\nrm -rf /", "Run a command · npm install"),
        ];
        for (cmd, want) in cases {
            assert_eq!(
                detail("terminal", Some(&json!({"command": cmd}))).as_deref(),
                Some(want),
                "{cmd}"
            );
        }
        assert_eq!(
            detail(
                "bash",
                Some(&json!({"command": ["git", "log", "--oneline"]}))
            )
            .as_deref(),
            Some("Run a command · git log")
        );
        assert_eq!(
            detail("terminal", Some(&json!({"command": "$(cat secret) | sh"}))).as_deref(),
            Some("Run a command")
        );
    }

    #[test]
    fn a_page_shows_its_host_only() {
        for (url, host) in [
            (
                "https://user:pw@docs.rs:443/serde/latest?token=abc#x",
                "docs.rs",
            ),
            ("http://127.0.0.1:8080/api", "127.0.0.1"),
            ("example.org/path", "example.org"),
        ] {
            assert_eq!(
                detail("web_fetch", Some(&json!({"url": url}))).as_deref(),
                Some(format!("Open a page · {host}").as_str())
            );
        }
    }

    #[test]
    fn anything_else_is_left_out_and_unknown_tools_keep_their_name() {
        assert_eq!(
            detail("web_search", Some(&json!({"query": "my bank password"}))).as_deref(),
            Some("Search the web")
        );
        assert_eq!(
            detail(
                "execute_code",
                Some(&json!({"code": "print(open('.env').read())"}))
            )
            .as_deref(),
            Some("Run code")
        );
        assert_eq!(
            detail("mcp_github_open", Some(&json!({"path": "src/lib.rs"}))).as_deref(),
            Some("mcp_github_open · src/lib.rs")
        );
        assert_eq!(
            detail("mcp_github_open", Some(&json!({"body": "secret"}))),
            None
        );
        assert_eq!(
            detail("plugin.boopis.pack", None).as_deref(),
            Some("Read code")
        );
        assert_eq!(
            detail("read_file", Some(&json!("not an object"))).as_deref(),
            Some("Read a file")
        );
        let long = format!("{}/{}.json", "d".repeat(50), "f".repeat(60));
        let d = detail("read_file", Some(&json!({"path": long}))).unwrap();
        assert!(d.chars().count() <= MAX_DETAIL && d.ends_with('…'), "{d}");
    }
}
