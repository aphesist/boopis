//! The guard of ADR-0031: boopis is the product and its engine is invisible, so no text the host writes for the UI names
//! the engine. This test reads the host's own sources and fails on any string literal that says "Hermes" (or "hermes")
//! where a person could read it.
//!
//! What it does not count, because nobody reads it in the app:
//! - code identifiers and paths: a literal with no space in it, in lower or upper case (`"hermes"`, `"HERMES_HOME"`,
//!   `"hermes-gateway-v1"`, `"../hermes-agent/install-stamp.json"`); the prose spelling `Hermes` always counts;
//! - the log and the raw detail of an error: a literal in a `tracing::` call, or built into an `Error` (the one mapper,
//!   `error::user_message`, shows the catalog's sentence for any error text that names the engine, and keeps the raw
//!   words for Diagnostics);
//! - tests (`tests.rs`, `tests/`, and the inline test module at the end of a file);
//! - [`PENDING`]: strings another branch is rewriting when two merge (empty now). Each entry must still be in the
//!   source, so the list empties itself as those strings change.

use std::path::{Path, PathBuf};

/// Literals another branch is rewriting at the time of a merge (empty now). Exact text, so an entry that no longer matches
/// fails the test and is removed.
const PENDING: &[(&str, &str)] = &[];

/// Literals that name the engine on purpose and never reach the app's screens, with the reason.
const ALLOWED: &[(&str, &str, &str)] = &[
    (
        "hermes/install.rs",
        "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
        "the engine's own installer, for `--engine existing` and the docs; the app does not show it",
    ),
    (
        "hermes/install.rs",
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
        "the same, on Linux and macOS",
    ),
];

/// The marks of a statement whose literals go to the log or into an error's raw detail.
const DETAIL_MARKS: &[&str] = &[
    "#[error(",
    "tracing::",
    "Error::",
    "Err(",
    "map_err",
    "error!(",
    "warn!(",
    "info!(",
    "debug!(",
    "trace!(",
    "panic!(",
    "expect(",
    "unreachable!(",
];

/// One string literal: its text as written (escapes kept) and where it starts.
struct Literal {
    text: String,
    at: usize,
}

/// The string literals of `src`, skipping comments and character literals.
#[allow(clippy::many_single_char_names)] // a small hand lexer: i, j, k, b, c
fn literals(src: &str) -> Vec<Literal> {
    let b: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        let next = b.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < b.len() && b[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            let mut depth = 1;
            i += 2;
            while i < b.len() && depth > 0 {
                if b[i] == '/' && b.get(i + 1) == Some(&'*') {
                    depth += 1;
                    i += 1;
                } else if b[i] == '*' && b.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    i += 1;
                }
                i += 1;
            }
        } else if c == '\'' {
            // a character literal ('a', '\n', '\'') or a lifetime ('a)
            if next == Some('\\') {
                i += 2;
                while i < b.len() && b[i] != '\'' {
                    i += 1;
                }
                i += 1;
            } else if b.get(i + 2) == Some(&'\'') {
                i += 3;
            } else {
                i += 1;
            }
        } else if c == 'r'
            && (next == Some('"') || next == Some('#'))
            && (i == 0 || !is_ident(b[i - 1]))
        {
            let mut j = i + 1;
            let mut hashes = 0;
            while b.get(j) == Some(&'#') {
                hashes += 1;
                j += 1;
            }
            if b.get(j) != Some(&'"') {
                i += 1;
                continue;
            }
            let start = j + 1;
            let mut k = start;
            loop {
                if k >= b.len() {
                    break;
                }
                if b[k] == '"' && (0..hashes).all(|h| b.get(k + 1 + h) == Some(&'#')) {
                    break;
                }
                k += 1;
            }
            out.push(Literal {
                text: b[start..k.min(b.len())].iter().collect(),
                at: i,
            });
            i = k + 1 + hashes;
        } else if c == '"' {
            let start = i + 1;
            let mut k = start;
            while k < b.len() && b[k] != '"' {
                if b[k] == '\\' {
                    k += 1;
                }
                k += 1;
            }
            out.push(Literal {
                text: b[start..k.min(b.len())].iter().collect(),
                at: i,
            });
            i = k + 1;
        } else {
            i += 1;
        }
    }
    // `at` counts chars; turn it into a byte offset for slicing the source
    let offsets: Vec<usize> = src.char_indices().map(|(o, _)| o).collect();
    for l in &mut out {
        l.at = offsets.get(l.at).copied().unwrap_or(src.len());
    }
    out
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// The source without its inline test module (by convention the last item of a file).
fn without_tests(src: &str) -> &str {
    let mut from = 0;
    while let Some(found) = src[from..].find("#[cfg(test)]") {
        let at = from + found;
        let mut rest = src[at + "#[cfg(test)]".len()..].trim_start();
        while rest.starts_with("#[") {
            rest = rest.split_once('\n').map_or("", |(_, r)| r).trim_start();
        }
        if rest.starts_with("mod ") && rest.split('\n').next().is_some_and(|l| l.contains('{')) {
            return &src[..at];
        }
        from = at + 1;
    }
    src
}

/// Whether the literal at `at` is in a statement that logs or builds an error.
fn in_detail(src: &str, at: usize) -> bool {
    let head = &src[..at];
    let start = head.rfind([';', '}']).map_or(0, |p| p + 1);
    let statement = &head[start..];
    DETAIL_MARKS.iter().any(|m| statement.contains(m))
}

/// Whether the text is a name for code (no space, and not the prose spelling).
fn is_identifier(text: &str) -> bool {
    !text.contains(char::is_whitespace) && !text.contains("Hermes")
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if p.file_name().is_some_and(|n| n == "tests") {
                continue;
            }
            rust_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs")
            && !p
                .file_name()
                .is_some_and(|n| n == "tests.rs" || n == "engine_words.rs")
        {
            out.push(p);
        }
    }
}

#[test]
fn no_host_text_names_the_engine() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&src_dir, &mut files);
    files.sort();
    assert!(
        files.len() > 40,
        "the sources were not found: {}",
        src_dir.display()
    );
    let mut found = Vec::new();
    let mut pending_seen = vec![false; PENDING.len()];
    for file in &files {
        let rel = file
            .strip_prefix(&src_dir)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let text = std::fs::read_to_string(file).unwrap();
        let src = without_tests(&text);
        for lit in literals(src) {
            if !lit.text.to_ascii_lowercase().contains("hermes")
                || is_identifier(&lit.text)
                || in_detail(src, lit.at)
            {
                continue;
            }
            if ALLOWED.iter().any(|(f, t, _)| *f == rel && *t == lit.text) {
                continue;
            }
            if let Some(k) = PENDING
                .iter()
                .position(|(f, t)| *f == rel && *t == lit.text)
            {
                pending_seen[k] = true;
                continue;
            }
            let line = src[..lit.at].lines().count();
            found.push(format!("{rel}:{line}: \"{}\"", lit.text));
        }
    }
    assert!(
        found.is_empty(),
        "text for the UI names the engine (ADR-0031; say what it is in boopis's words):\n{}",
        found.join("\n")
    );
    let stale: Vec<_> = PENDING
        .iter()
        .zip(&pending_seen)
        .filter(|(_, seen)| !**seen)
        .map(|(p, _)| p)
        .collect();
    assert!(
        stale.is_empty(),
        "these PENDING entries are gone from the source; remove them: {stale:?}"
    );
}

#[test]
fn the_scanner_reads_literals_and_skips_comments_and_detail() {
    let src = "// \"Hermes in a comment\"\nlet a = 'x'; let b: &'static str = \"Hermes on screen\";\n\
               tracing::info!(\"Hermes in the log\");\nreturn Err(Error::Io(format!(\"hermes said {e}\")));\n\
               let c = r#\"raw \"Hermes\"\"#;\nlet d = \"HERMES_HOME\";";
    let all: Vec<_> = literals(src)
        .into_iter()
        .map(|l| (l.text.clone(), in_detail(src, l.at)))
        .collect();
    assert_eq!(
        all,
        vec![
            ("Hermes on screen".to_owned(), false),
            ("Hermes in the log".to_owned(), true),
            ("hermes said {e}".to_owned(), true),
            ("raw \"Hermes\"".to_owned(), false),
            ("HERMES_HOME".to_owned(), false),
        ]
    );
    assert!(
        is_identifier("HERMES_HOME")
            && is_identifier("hermes-gateway-v1")
            && !is_identifier("Hermes")
    );
    assert_eq!(
        without_tests("a\n#[cfg(test)]\nmod tests;\nb\n#[cfg(test)]\nmod tests {\n}"),
        "a\n#[cfg(test)]\nmod tests;\nb\n"
    );
}
