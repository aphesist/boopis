//! Search and replace: the matching tiers.
//!
//! 1. **Exact.** `old` occurs once, byte for byte (or, with `replace_all`, every occurrence).
//! 2. **Line endings.** The same lines, ignoring `\r\n` versus `\n`. The file's own ending is kept.
//! 3. **Indent shift.** The same lines after removing a uniform indent and trailing whitespace.
//!    The replacement is re-indented to match the file.
//! 4. **Whitespace-normalised fuzzy.** Report-only. It never applies: it only tells the caller
//!    in `closest.whitespace_only` that the text differs in whitespace alone. Applying it could
//!    rewrite Python, YAML or string literals.

use hx_proto::txn::FailureKind;

use super::Failure;
use super::closest::closest;
use super::text::{
    Line, dedent, first_indent, line_ending, line_number_at, split_lines, split_logical_lines,
};
use crate::limits::Limits;

/// Applies one replacement to `text`.
pub fn replace(
    text: &str,
    old: &str,
    new: &str,
    replace_all: bool,
    limits: &Limits,
) -> Result<String, Failure> {
    if old.is_empty() {
        return if text.is_empty() {
            Ok(new.to_owned())
        } else {
            Err(Failure::new(
                FailureKind::NoMatch,
                "`old` is empty but the file is not; use `create` with `overwrite` to replace a whole file",
            ))
        };
    }

    let exact: Vec<usize> = text.match_indices(old).map(|(i, _)| i).collect();
    match exact.len() {
        1 => return Ok(splice(text, exact[0], exact[0] + old.len(), new)),
        n if n > 1 => {
            if replace_all {
                return Ok(text.replace(old, new));
            }
            return Err(ambiguous(
                format!(
                    "`old` matches {n} places exactly; add surrounding lines or set `replace_all`"
                ),
                exact.iter().map(|&o| line_number_at(text, o)).collect(),
                limits,
            ));
        }
        _ => {}
    }

    let lines = split_lines(text);
    let (old_lines, old_trailing_nl) = split_logical_lines(old);
    if !replace_all {
        let eol = line_ending(text);
        if let Some(done) =
            tier_line_endings(text, &lines, &old_lines, old_trailing_nl, new, eol, limits).or_else(
                || tier_indent_shift(text, &lines, &old_lines, old_trailing_nl, new, eol, limits),
            )
        {
            return done;
        }
    }
    Err(no_match(&lines, &old_lines, limits))
}

fn splice(text: &str, from: usize, to: usize, with: &str) -> String {
    let mut out = String::with_capacity(text.len() - (to - from) + with.len());
    out.push_str(&text[..from]);
    out.push_str(with);
    out.push_str(&text[to..]);
    out
}

fn ambiguous(message: String, mut lines: Vec<u32>, limits: &Limits) -> Failure {
    lines.truncate(limits.max_candidates);
    let mut f = Failure::new(FailureKind::Ambiguous, message);
    f.candidate_lines = lines;
    f
}

fn no_match(lines: &[Line<'_>], old_lines: &[&str], limits: &Limits) -> Failure {
    let closest = closest(lines, old_lines, limits);
    let message = match &closest {
        None => "`old` was not found: the file is empty".to_owned(),
        Some(c) if c.whitespace_only => format!(
            "`old` differs from lines {}-{} only in whitespace; it was not applied. Resend it with the file's exact whitespace",
            c.start_line, c.end_line
        ),
        Some(c) => format!(
            "`old` was not found; the closest region is lines {}-{}",
            c.start_line, c.end_line
        ),
    };
    let mut f = Failure::new(FailureKind::NoMatch, message);
    f.closest = closest;
    f
}

/// Start indexes of every window of `m` lines that satisfies `pred`.
fn windows(lines: &[Line<'_>], m: usize, pred: impl Fn(&[Line<'_>]) -> bool) -> Vec<usize> {
    if m == 0 || m > lines.len() {
        return Vec::new();
    }
    (0..=lines.len() - m)
        .filter(|&i| pred(&lines[i..i + m]))
        .collect()
}

fn tier_line_endings(
    text: &str,
    lines: &[Line<'_>],
    old_lines: &[&str],
    old_trailing_nl: bool,
    new: &str,
    eol: &str,
    limits: &Limits,
) -> Option<Result<String, Failure>> {
    let found = windows(lines, old_lines.len(), |w| {
        w.iter().zip(old_lines).all(|(l, o)| l.text == *o)
    });
    finish(
        text,
        lines,
        &found,
        old_lines,
        old_trailing_nl,
        new,
        eol,
        false,
        "line-ending-tolerant",
        limits,
    )
}

fn tier_indent_shift(
    text: &str,
    lines: &[Line<'_>],
    old_lines: &[&str],
    old_trailing_nl: bool,
    new: &str,
    eol: &str,
    limits: &Limits,
) -> Option<Result<String, Failure>> {
    let want = dedent(old_lines);
    let found = windows(lines, old_lines.len(), |w| {
        // Cheap pre-check first: the trimmed lines must agree before we allocate to dedent.
        w.iter()
            .zip(old_lines)
            .all(|(l, o)| l.text.trim() == o.trim())
            && {
                let texts: Vec<&str> = w.iter().map(|l| l.text).collect();
                dedent(&texts) == want
            }
    });
    finish(
        text,
        lines,
        &found,
        old_lines,
        old_trailing_nl,
        new,
        eol,
        true,
        "indentation-tolerant",
        limits,
    )
}

#[allow(clippy::too_many_arguments)] // One internal call site pair; a struct would only rename the arguments.
fn finish(
    text: &str,
    lines: &[Line<'_>],
    found: &[usize],
    old_lines: &[&str],
    old_trailing_nl: bool,
    new: &str,
    eol: &str,
    reindent: bool,
    tier: &str,
    limits: &Limits,
) -> Option<Result<String, Failure>> {
    let m = old_lines.len();
    match found {
        [] => None,
        [i] => {
            let window = &lines[*i..*i + m];
            let replacement =
                format_replacement(window, old_lines, old_trailing_nl, new, eol, reindent);
            let from = window[0].start;
            // Deleting whole lines (`new` empty) also removes the last line's terminator.
            let to = if new.is_empty() && old_trailing_nl {
                window[m - 1].end_with_eol
            } else {
                window[m - 1].end
            };
            Some(Ok(splice(text, from, to, &replacement)))
        }
        many => Some(Err(ambiguous(
            format!(
                "the {tier} match found {} places; add surrounding lines",
                many.len()
            ),
            many.iter()
                .map(|&i| u32::try_from(i + 1).unwrap_or(u32::MAX))
                .collect(),
            limits,
        ))),
    }
}

fn format_replacement(
    window: &[Line<'_>],
    old_lines: &[&str],
    old_trailing_nl: bool,
    new: &str,
    eol: &str,
    reindent: bool,
) -> String {
    let (new_lines, new_trailing_nl) = split_logical_lines(new);
    let new_lines: Vec<String> = if reindent {
        let target = first_indent(&window.iter().map(|l| l.text).collect::<Vec<_>>());
        let old_indent = first_indent(old_lines);
        let new_indent = first_indent(&new_lines);
        if target != old_indent && new_indent == old_indent {
            new_lines
                .iter()
                .map(|l| match l.strip_prefix(old_indent) {
                    _ if l.trim().is_empty() => String::new(),
                    Some(rest) => format!("{target}{rest}"),
                    None => (*l).to_owned(),
                })
                .collect()
        } else {
            new_lines.iter().map(|s| (*s).to_owned()).collect()
        }
    } else {
        new_lines.iter().map(|s| (*s).to_owned()).collect()
    };

    if new.is_empty() {
        return String::new();
    }
    let mut out = new_lines.join(eol);
    // The window excludes the last line's terminator, so only add one when `new` ends a line
    // that `old` did not.
    if new_trailing_nl && !old_trailing_nl {
        out.push_str(eol);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str, old: &str, new: &str) -> Result<String, Failure> {
        replace(text, old, new, false, &Limits::default())
    }

    #[test]
    fn exact_single_match() {
        assert_eq!(run("a b c", "b", "X").unwrap(), "a X c");
    }

    #[test]
    fn exact_multiple_matches_are_ambiguous_with_line_numbers() {
        let f = run("x\ny\nx\n", "x", "z").unwrap_err();
        assert_eq!(f.kind, FailureKind::Ambiguous);
        assert_eq!(f.candidate_lines, vec![1, 3]);
    }

    #[test]
    fn replace_all_replaces_every_exact_match() {
        let out = replace("x\ny\nx\n", "x", "z", true, &Limits::default()).unwrap();
        assert_eq!(out, "z\ny\nz\n");
    }

    #[test]
    fn crlf_file_with_lf_old_text_keeps_crlf() {
        let original =
            "mod inner {\r\n    fn greet() {\r\n        let msg = \"hi\";\r\n    }\r\n}\r\n";
        let out = run(
            original,
            "fn greet() {\n    let msg = \"hi\";\n}",
            "fn greet() {\n    let msg = \"hello\";\n}",
        );
        // Indent differs too (file is indented), so this exercises tier 3 on a CRLF file.
        assert_eq!(
            out.unwrap(),
            "mod inner {\r\n    fn greet() {\r\n        let msg = \"hello\";\r\n    }\r\n}\r\n"
        );
    }

    #[test]
    fn crlf_only_difference_is_tier_two() {
        let out = run("a\r\nb\r\nc\r\n", "a\nb", "a\nB").unwrap();
        assert_eq!(out, "a\r\nB\r\nc\r\n");
    }

    #[test]
    fn indent_shift_reindents_the_replacement() {
        let original = "class A:\n    def f(self):\n        return 1\n";
        let out = run(
            original,
            "def f(self):\n    return 1",
            "def f(self):\n    return 2",
        )
        .unwrap();
        assert_eq!(out, "class A:\n    def f(self):\n        return 2\n");
    }

    #[test]
    fn deleting_lines_in_a_crlf_file_leaves_no_blank_line() {
        let out = run("a\r\nb\r\nc\r\n", "b\n", "").unwrap();
        // `b\n` does not match exactly (the file has \r\n), so tier 2 handles it.
        assert_eq!(out, "a\r\nc\r\n");
    }

    #[test]
    fn whitespace_only_difference_is_never_applied() {
        let original = "if x:\n    run()\n";
        let f = run(original, "if x:\n  run()", "if x:\n  stop()").unwrap_err();
        assert_eq!(f.kind, FailureKind::NoMatch);
        let c = f.closest.unwrap();
        assert!(c.whitespace_only);
        assert_eq!(
            (c.start_line, c.end_line, c.first_diff_line),
            (1, 2, Some(2))
        );
        assert!(f.message.contains("only in whitespace"));
    }

    #[test]
    fn a_miss_reports_the_closest_match() {
        let original = "fn alpha() {\n    let x = 1;\n    let y = 2;\n}\n";
        let f = run(
            original,
            "fn alpha() {\n    let x = 1;\n    let y = 999;\n}",
            "",
        )
        .unwrap_err();
        let c = f.closest.unwrap();
        assert_eq!(
            (c.start_line, c.end_line, c.first_diff_line),
            (1, 4, Some(3))
        );
        assert!(c.snippet.contains("let y = 2;"));
    }

    #[test]
    fn indent_shift_ambiguity_lists_candidates() {
        let original = "  x = 1\n\n    x = 1\n";
        let f = run(original, "x = 1", "x = 2");
        // Exact matches twice, so tier 1 already reports it.
        assert_eq!(f.unwrap_err().candidate_lines, vec![1, 3]);
        let f = run("  x = 1\ny\n    x = 1\n", "x = 1\ny", "z").unwrap();
        assert_eq!(f, "  z\n    x = 1\n");
    }

    #[test]
    fn empty_old_only_fills_an_empty_file() {
        assert_eq!(run("", "", "new").unwrap(), "new");
        assert_eq!(run("x", "", "new").unwrap_err().kind, FailureKind::NoMatch);
    }
}
