//! Line-level helpers shared by the matchers.

/// One line of a text: where it sits and what it holds, without its terminator.
#[derive(Debug, Clone, Copy)]
pub struct Line<'a> {
    /// Byte offset of the first character.
    pub start: usize,
    /// Byte offset just before the terminator.
    pub end: usize,
    /// Byte offset just after the terminator (equal to `end` for an unterminated last line).
    pub end_with_eol: usize,
    /// The text without the terminator (`\n` or `\r\n`).
    pub text: &'a str,
}

/// Splits into lines, recognising `\n` and `\r\n`. A final unterminated line is kept.
#[must_use]
pub fn split_lines(text: &str) -> Vec<Line<'_>> {
    let bytes = text.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            let end = if i > start && bytes[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            lines.push(Line {
                start,
                end,
                end_with_eol: i + 1,
                text: &text[start..end],
            });
            start = i + 1;
        }
    }
    if start < bytes.len() {
        let end = if bytes[bytes.len() - 1] == b'\r' && bytes.len() - 1 > start {
            bytes.len() - 1
        } else {
            bytes.len()
        };
        lines.push(Line {
            start,
            end,
            end_with_eol: bytes.len(),
            text: &text[start..end],
        });
    }
    lines
}

/// Splits a snippet the model wrote into logical lines, and says whether it ended in a newline.
#[must_use]
pub fn split_logical_lines(text: &str) -> (Vec<&str>, bool) {
    let had_trailing_nl = text.ends_with('\n');
    let stripped = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);
    if stripped.is_empty() && !text.is_empty() {
        return (vec![""], had_trailing_nl);
    }
    let lines = stripped
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    (lines, had_trailing_nl)
}

/// The file's dominant line ending: CRLF when at least half of its newlines are CRLF.
#[must_use]
pub fn line_ending(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    if crlf > 0 && crlf * 2 >= lf {
        "\r\n"
    } else {
        "\n"
    }
}

/// Collapses runs of whitespace to one space and trims.
#[must_use]
pub fn normalize_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Removes the smallest common indentation and trailing whitespace from each line.
#[must_use]
pub fn dedent(lines: &[&str]) -> Vec<String> {
    let min_indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l[min_indent.min(l.len())..].trim_end().to_owned()
            }
        })
        .collect()
}

/// The leading whitespace of the first non-blank line.
#[must_use]
pub fn first_indent<'a>(lines: &[&'a str]) -> &'a str {
    lines
        .iter()
        .find(|l| !l.trim().is_empty())
        .map_or("", |l| &l[..l.len() - l.trim_start().len()])
}

/// The 1-based line number of a byte offset.
#[must_use]
pub fn line_number_at(text: &str, offset: usize) -> u32 {
    let before = text.get(..offset.min(text.len())).unwrap_or("");
    u32::try_from(before.matches('\n').count() + 1).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_handle_both_endings_and_a_missing_final_newline() {
        let t = "a\r\nb\nc";
        let lines = split_lines(t);
        assert_eq!(
            lines.iter().map(|l| l.text).collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
        assert_eq!(&t[lines[0].start..lines[0].end_with_eol], "a\r\n");
        assert_eq!(lines[2].end, t.len());
    }

    #[test]
    fn logical_lines() {
        assert_eq!(split_logical_lines("a\nb\n"), (vec!["a", "b"], true));
        assert_eq!(split_logical_lines("a\r\nb"), (vec!["a", "b"], false));
        assert_eq!(split_logical_lines("\n"), (vec![""], true));
    }

    #[test]
    fn dominant_line_ending() {
        assert_eq!(line_ending("a\r\nb\r\n"), "\r\n");
        assert_eq!(line_ending("a\nb\r\nc\nd\n"), "\n");
        assert_eq!(line_ending("none"), "\n");
    }

    #[test]
    fn dedent_and_indent() {
        assert_eq!(dedent(&["    a", "      b  ", ""]), ["a", "  b", ""]);
        assert_eq!(first_indent(&["", "\t\tx"]), "\t\t");
    }

    #[test]
    fn offsets_to_lines() {
        assert_eq!(line_number_at("a\nb\nc", 0), 1);
        assert_eq!(line_number_at("a\nb\nc", 4), 3);
    }
}
