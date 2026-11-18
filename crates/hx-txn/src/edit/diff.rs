//! Unified-diff hunks.
//!
//! The parser is deliberately lenient about what models get wrong (hunk line counts) and strict
//! about what matters (context must match exactly). Hunk header counts are ignored; the old
//! start line is only a hint, and the nearest exact match at or after the previous hunk wins.
//! There is no whitespace fuzz: a hunk that does not match exactly fails with the closest region.

use hx_proto::txn::FailureKind;

use super::Failure;
use super::closest::closest;
use super::text::{line_ending, split_lines};
use crate::limits::Limits;

/// One line of a hunk body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HunkLine {
    /// A line present in both versions.
    Context(String),
    /// A line removed.
    Del(String),
    /// A line added. The flag is true when a `\ No newline at end of file` marker follows it.
    Add(String, bool),
}

/// One `@@` hunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    /// The old-file start line from the header (1-based; 0 for an empty old range). A hint only.
    pub old_start: usize,
    /// The body, in order.
    pub lines: Vec<HunkLine>,
}

/// The hunks for one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilePatch {
    /// The `---` path, `None` for `/dev/null` or when there is no header.
    pub old_path: Option<String>,
    /// The `+++` path, `None` for `/dev/null` or when there is no header.
    pub new_path: Option<String>,
    /// Whether the diff carried `---`/`+++` headers for this file.
    pub has_headers: bool,
    /// The hunks, in file order.
    pub hunks: Vec<Hunk>,
}

/// What a patch does to its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchKind {
    /// Change an existing file.
    Modify,
    /// Create a file (`--- /dev/null`).
    Create,
    /// Delete a file (`+++ /dev/null`).
    Delete,
}

impl FilePatch {
    /// The workspace path this patch targets and what it does.
    ///
    /// Git's `a/` and `b/` prefixes are stripped when the two headers carry them.
    ///
    /// # Errors
    /// A rename (two different paths) or no usable path.
    pub fn target(&self) -> Result<(String, PatchKind), String> {
        match (&self.old_path, &self.new_path) {
            (None, Some(new)) => Ok((
                strip_prefix(new, "b/", self.old_path.is_none()),
                PatchKind::Create,
            )),
            (Some(old), None) => Ok((
                strip_prefix(old, "a/", self.new_path.is_none()),
                PatchKind::Delete,
            )),
            (Some(old), Some(new)) => {
                let git = old.starts_with("a/") && new.starts_with("b/");
                let (o, n) = if git {
                    (&old[2..], &new[2..])
                } else {
                    (old.as_str(), new.as_str())
                };
                if o == n {
                    Ok((n.to_owned(), PatchKind::Modify))
                } else {
                    Err(format!("renames are not supported (`{o}` to `{n}`)"))
                }
            }
            (None, None) => Err("the diff names no file".to_owned()),
        }
    }
}

fn strip_prefix(path: &str, prefix: &str, one_sided: bool) -> String {
    if one_sided {
        path.strip_prefix(prefix).unwrap_or(path).to_owned()
    } else {
        path.to_owned()
    }
}

fn header_path(rest: &str) -> Option<String> {
    let path = rest.split('\t').next().unwrap_or(rest).trim();
    if path == "/dev/null" {
        None
    } else {
        Some(path.trim_matches('"').to_owned())
    }
}

fn parse_old_start(header: &str) -> Option<usize> {
    let rest = header.strip_prefix("@@ -")?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// Parses a unified diff into per-file patches.
///
/// # Errors
/// A message for the first thing that is not a diff: text before any hunk, or no hunks at all.
pub fn parse(diff: &str) -> Result<Vec<FilePatch>, String> {
    let raw: Vec<&str> = diff
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let mut patches: Vec<FilePatch> = Vec::new();
    let mut i = 0usize;
    while i < raw.len() {
        let line = raw[i];
        if line.starts_with("--- ") && raw.get(i + 1).is_some_and(|n| n.starts_with("+++ ")) {
            patches.push(FilePatch {
                old_path: header_path(&line[4..]),
                new_path: header_path(&raw[i + 1][4..]),
                has_headers: true,
                hunks: Vec::new(),
            });
            i += 2;
        } else if line.starts_with("@@") {
            let Some(old_start) = parse_old_start(line) else {
                return Err(format!("malformed hunk header: `{line}`"));
            };
            if patches.is_empty() {
                patches.push(FilePatch {
                    old_path: None,
                    new_path: None,
                    has_headers: false,
                    hunks: Vec::new(),
                });
            }
            i += 1;
            let (lines, next) = hunk_body(&raw, i);
            i = next;
            if let Some(patch) = patches.last_mut() {
                patch.hunks.push(Hunk { old_start, lines });
            }
        } else {
            // Preamble: `diff --git`, `index`, mode lines, prose. Ignored until a header or hunk.
            i += 1;
        }
    }
    if patches.is_empty() {
        return Err("the diff contains no hunks".to_owned());
    }
    if let Some(p) = patches
        .iter()
        .find(|p| p.hunks.is_empty() && p.old_path.is_some() && p.new_path.is_some())
    {
        let name = p.new_path.as_deref().unwrap_or_default();
        return Err(format!("the diff for `{name}` contains no hunks"));
    }
    Ok(patches)
}

fn is_file_header(raw: &[&str], i: usize) -> bool {
    raw[i].starts_with("--- ") && raw.get(i + 1).is_some_and(|n| n.starts_with("+++ "))
}

fn hunk_body(raw: &[&str], mut i: usize) -> (Vec<HunkLine>, usize) {
    let mut lines: Vec<HunkLine> = Vec::new();
    while i < raw.len() {
        let line = raw[i];
        if line.starts_with("@@") || line.starts_with("diff --git ") || is_file_header(raw, i) {
            break;
        }
        match line.chars().next() {
            Some(' ') => lines.push(HunkLine::Context(line[1..].to_owned())),
            Some('-') => lines.push(HunkLine::Del(line[1..].to_owned())),
            Some('+') => lines.push(HunkLine::Add(line[1..].to_owned(), false)),
            Some('\\') => {
                if let Some(HunkLine::Add(_, no_nl)) = lines.last_mut() {
                    *no_nl = true;
                }
            }
            // A blank line inside a hunk is an empty context line that lost its space.
            None => lines.push(HunkLine::Context(String::new())),
            Some(_) => break,
        }
        i += 1;
    }
    // Blank lines at the end of a hunk are separators, not context: a real empty context line
    // is written as a single space.
    while matches!(lines.last(), Some(HunkLine::Context(c)) if c.is_empty()) {
        lines.pop();
    }
    (lines, i)
}

/// Applies `hunks` to `text`.
///
/// # Errors
/// A [`Failure`] naming the first hunk that does not match, with the closest region.
pub fn apply(text: &str, hunks: &[Hunk], limits: &Limits) -> Result<String, Failure> {
    let lines = split_lines(text);
    let eol = line_ending(text);
    let mut out = String::with_capacity(text.len());
    let mut pending_eol = false; // The last kept line had no terminator and more text follows.
    let mut cursor = 0usize;

    let push = |out: &mut String, content: &str, terminator: &str, pending: &mut bool| {
        if *pending {
            out.push_str(eol);
        }
        out.push_str(content);
        out.push_str(terminator);
        *pending = terminator.is_empty();
    };

    for (n, hunk) in hunks.iter().enumerate() {
        let expected: Vec<&str> = hunk
            .lines
            .iter()
            .filter_map(|l| match l {
                HunkLine::Context(s) | HunkLine::Del(s) => Some(s.as_str()),
                HunkLine::Add(..) => None,
            })
            .collect();
        let hunk_no = u32::try_from(n).unwrap_or(u32::MAX);
        let Some(pos) = locate(&lines, &expected, hunk.old_start, cursor) else {
            let mut f = Failure::new(
                FailureKind::NoMatch,
                format!("hunk {n} does not match the file; its context must match exactly"),
            );
            f.hunk = Some(hunk_no);
            f.closest = closest(&lines, &expected, limits);
            return Err(f);
        };
        for l in &lines[cursor..pos] {
            push(
                &mut out,
                l.text,
                &text[l.end..l.end_with_eol],
                &mut pending_eol,
            );
        }
        let mut k = pos;
        for hl in &hunk.lines {
            match hl {
                HunkLine::Context(_) => {
                    let l = &lines[k];
                    push(
                        &mut out,
                        l.text,
                        &text[l.end..l.end_with_eol],
                        &mut pending_eol,
                    );
                    k += 1;
                }
                HunkLine::Del(_) => k += 1,
                HunkLine::Add(s, no_newline) => {
                    push(
                        &mut out,
                        s,
                        if *no_newline { "" } else { eol },
                        &mut pending_eol,
                    );
                }
            }
        }
        cursor = k;
    }
    for l in &lines[cursor..] {
        push(
            &mut out,
            l.text,
            &text[l.end..l.end_with_eol],
            &mut pending_eol,
        );
    }
    Ok(out)
}

/// Finds where `expected` sits, nearest to the header's hint, never before `cursor`.
fn locate(
    lines: &[super::text::Line<'_>],
    expected: &[&str],
    old_start: usize,
    cursor: usize,
) -> Option<usize> {
    let n = lines.len();
    if expected.is_empty() {
        // A pure insertion: `-L,0` means "after line L".
        return Some(old_start.clamp(cursor, n));
    }
    if expected.len() > n {
        return None;
    }
    let last = n - expected.len();
    let hint = old_start.saturating_sub(1).clamp(cursor, last.max(cursor));
    let fits = |p: usize| {
        p >= cursor
            && p <= last
            && expected
                .iter()
                .enumerate()
                .all(|(k, e)| lines[p + k].text == *e)
    };
    (0..=n).find_map(|d| {
        let after = hint + d;
        if fits(after) {
            return Some(after);
        }
        hint.checked_sub(d).filter(|&before| fits(before))
    })
}

/// Builds the full text for a created file from its hunks.
#[must_use]
pub fn created_content(hunks: &[Hunk]) -> String {
    let mut out = String::new();
    for h in hunks {
        for l in &h.lines {
            if let HunkLine::Add(s, no_newline) = l {
                out.push_str(s);
                if !no_newline {
                    out.push('\n');
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str, diff: &str) -> Result<String, Failure> {
        let patches = parse(diff).unwrap();
        assert_eq!(patches.len(), 1);
        apply(text, &patches[0].hunks, &Limits::default())
    }

    #[test]
    fn headerless_hunk_applies() {
        let out = run("a\nb\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n").unwrap();
        assert_eq!(out, "a\nB\nc\n");
    }

    #[test]
    fn wrong_line_numbers_and_counts_still_apply() {
        let text: String = (1..=20)
            .map(|i| format!("l{i}\n"))
            .collect::<Vec<_>>()
            .concat();
        let out = run(&text, "@@ -2,99 +2,1 @@\n l9\n-l10\n+ten\n l11\n").unwrap();
        assert!(out.contains("l9\nten\nl11\n"));
        assert!(!out.contains("l10"));
    }

    #[test]
    fn git_headers_give_the_target() {
        let d = "diff --git a/src/x.rs b/src/x.rs\nindex 1..2 100644\n--- a/src/x.rs\n+++ b/src/x.rs\n@@ -1 +1 @@\n-a\n+b\n";
        let p = &parse(d).unwrap()[0];
        assert_eq!(
            p.target().unwrap(),
            ("src/x.rs".to_owned(), PatchKind::Modify)
        );
    }

    #[test]
    fn create_and_delete_targets() {
        let c = &parse("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n").unwrap()[0];
        assert_eq!(
            c.target().unwrap(),
            ("new.txt".to_owned(), PatchKind::Create)
        );
        assert_eq!(created_content(&c.hunks), "one\ntwo\n");
        let d = &parse("--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n").unwrap()[0];
        assert_eq!(
            d.target().unwrap(),
            ("old.txt".to_owned(), PatchKind::Delete)
        );
    }

    #[test]
    fn renames_are_unsupported() {
        let p = &parse("--- a/x\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n").unwrap()[0];
        assert!(p.target().unwrap_err().contains("renames"));
    }

    #[test]
    fn multiple_files_and_hunks() {
        let d = "--- a/one\n+++ b/one\n@@ -1 +1 @@\n-a\n+b\n@@ -5 +5 @@\n-e\n+E\n--- a/two\n+++ b/two\n@@ -1 +1 @@\n-x\n+y\n";
        let p = parse(d).unwrap();
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].hunks.len(), 2);
        let out = apply("a\nb\nc\nd\ne\n", &p[0].hunks, &Limits::default()).unwrap();
        assert_eq!(out, "b\nb\nc\nd\nE\n");
    }

    #[test]
    fn a_mismatch_fails_with_the_closest_region() {
        let f = run("a\nb\nc\n", "@@ -1,3 +1,3 @@\n a\n-X\n+B\n c\n").unwrap_err();
        assert_eq!(f.kind, FailureKind::NoMatch);
        assert_eq!(f.hunk, Some(0));
        let c = f.closest.unwrap();
        assert_eq!(
            (c.start_line, c.end_line, c.first_diff_line),
            (1, 3, Some(2))
        );
    }

    #[test]
    fn whitespace_differences_do_not_match() {
        let f = run("  a\n", "@@ -1 +1 @@\n-a\n+b\n").unwrap_err();
        assert!(f.closest.unwrap().whitespace_only);
    }

    #[test]
    fn crlf_files_keep_their_line_endings() {
        let out = run("a\r\nb\r\nc\r\n", "@@ -1,3 +1,4 @@\n a\n b\n+new\n c\n").unwrap();
        assert_eq!(out, "a\r\nb\r\nnew\r\nc\r\n");
    }

    #[test]
    fn no_newline_markers() {
        // Adding a newline at EOF.
        let out = run("x", "@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+x\n").unwrap();
        assert_eq!(out, "x\n");
        // Appending after an unterminated last line.
        let out = run("x", "@@ -1 +1,2 @@\n x\n+y\n").unwrap();
        assert_eq!(out, "x\ny\n");
        // Removing the final newline.
        let out = run("x\n", "@@ -1 +1 @@\n-x\n+x\n\\ No newline at end of file\n").unwrap();
        assert_eq!(out, "x");
    }

    #[test]
    fn pure_insertion_uses_the_header_position() {
        let out = run("a\nb\n", "@@ -1,0 +2,1 @@\n+mid\n").unwrap();
        assert_eq!(out, "a\nmid\nb\n");
    }

    #[test]
    fn hunks_cannot_overlap_or_reorder() {
        let diff = "@@ -3 +3 @@\n-c\n+C\n@@ -1 +1 @@\n-a\n+A\n";
        let f = run("a\nb\nc\n", diff).unwrap_err();
        assert_eq!(f.hunk, Some(1));
    }

    #[test]
    fn garbage_is_rejected() {
        assert!(parse("just some words").is_err());
        assert!(parse("--- a/x\n+++ b/x\n").is_err());
        assert!(parse("@@ nonsense @@\n").is_err());
    }
}
