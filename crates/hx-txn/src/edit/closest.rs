//! The closest region of a file to some wanted lines. Report-only: it never decides an edit.

use hx_proto::txn::ClosestMatch;

use super::text::{Line, normalize_ws};
use crate::limits::Limits;

/// How many needle lines are sampled to rank windows. Ranking costs O(file lines x this).
const SAMPLE: usize = 8;

struct Prepared<'a> {
    text: &'a str,
    norm: String,
    set: Vec<String>,
}

fn prepare(text: &str) -> Prepared<'_> {
    let norm = normalize_ws(text);
    let mut set: Vec<String> = norm
        .split(' ')
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect();
    set.sort_unstable();
    set.dedup();
    Prepared { text, norm, set }
}

fn jaccard(a: &[String], b: &[String]) -> f64 {
    let (mut i, mut j, mut inter) = (0, 0, 0usize);
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Equal => {
                inter += 1;
                i += 1;
                j += 1;
            }
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
        }
    }
    let union = a.len() + b.len() - inter;
    if union == 0 {
        1.0
    } else {
        count_f64(inter) / count_f64(union)
    }
}

/// Line counts are far below 2^52, so the conversion is exact.
#[allow(clippy::cast_precision_loss)]
fn count_f64(n: usize) -> f64 {
    n as f64
}

fn line_similarity(a: &Prepared<'_>, b: &Prepared<'_>) -> f64 {
    if a.text == b.text {
        1.0
    } else if a.norm == b.norm {
        0.98
    } else {
        jaccard(&a.set, &b.set) * 0.9
    }
}

fn clamp_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Finds the region of `lines` closest to `needle`, or `None` if either is empty.
#[must_use]
pub fn closest(lines: &[Line<'_>], needle: &[&str], limits: &Limits) -> Option<ClosestMatch> {
    if lines.is_empty() || needle.is_empty() {
        return None;
    }
    let file: Vec<Prepared<'_>> = lines.iter().map(|l| prepare(l.text)).collect();
    let want: Vec<Prepared<'_>> = needle.iter().map(|l| prepare(l)).collect();
    let w = want.len().min(file.len());

    let sample: Vec<usize> = if w <= SAMPLE {
        (0..w).collect()
    } else {
        (0..SAMPLE).map(|i| i * (w - 1) / (SAMPLE - 1)).collect()
    };

    let mut best_start = 0usize;
    let mut best_score = f64::NEG_INFINITY;
    for start in 0..=(file.len() - w) {
        let score: f64 = sample
            .iter()
            .map(|&k| line_similarity(&file[start + k], &want[k]))
            .sum();
        if score > best_score {
            best_score = score;
            best_start = start;
        }
    }

    let window = &file[best_start..best_start + w];
    let total: f64 = window
        .iter()
        .zip(&want)
        .map(|(a, b)| line_similarity(a, b))
        .sum();
    let whitespace_only =
        w == want.len() && window.iter().zip(&want).all(|(a, b)| a.norm == b.norm);
    let first_diff = window
        .iter()
        .zip(&want)
        .position(|(a, b)| {
            if whitespace_only {
                a.text != b.text
            } else {
                a.norm != b.norm
            }
        })
        .or((want.len() > w).then_some(w));

    Some(ClosestMatch {
        start_line: clamp_u32(best_start + 1),
        end_line: clamp_u32(best_start + w),
        first_diff_line: first_diff.map(|k| clamp_u32(best_start + k + 1)),
        snippet: snippet(window.iter().map(|p| p.text), limits),
        similarity: (total / count_f64(want.len().max(1))).clamp(0.0, 1.0),
        whitespace_only,
    })
}

/// Joins lines with `\n`, capped by line count and byte size.
fn snippet<'a>(lines: impl Iterator<Item = &'a str>, limits: &Limits) -> String {
    let mut out = String::new();
    for (count, line) in lines.enumerate() {
        if count == limits.snippet_lines || out.len() + line.len() > limits.snippet_bytes {
            out.push_str("\n…");
            return out;
        }
        if count > 0 {
            out.push('\n');
        }
        out.push_str(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::text::split_lines;
    use super::*;

    fn run(file: &str, needle: &[&str]) -> ClosestMatch {
        closest(&split_lines(file), needle, &Limits::default()).unwrap()
    }

    #[test]
    fn finds_the_most_similar_window() {
        let file = "fn a() {\n    let x = 1;\n}\nfn b() {\n    let y = 2;\n    let z = 3;\n}\n";
        let m = run(file, &["fn b() {", "    let y = 99;", "    let z = 3;"]);
        assert_eq!((m.start_line, m.end_line), (4, 6));
        assert_eq!(m.first_diff_line, Some(5));
        assert!(!m.whitespace_only);
        assert!(m.similarity > 0.5);
    }

    #[test]
    fn whitespace_only_differences_are_flagged() {
        let m = run("if x:\n    run()\n", &["if x:", "  run()"]);
        assert!(m.whitespace_only);
        assert_eq!(m.first_diff_line, Some(2));
    }

    #[test]
    fn a_needle_longer_than_the_file_points_past_the_window() {
        let m = run("a\n", &["a", "b", "c"]);
        assert_eq!(
            (m.start_line, m.end_line, m.first_diff_line),
            (1, 1, Some(2))
        );
        assert!(!m.whitespace_only);
    }

    #[test]
    fn empty_inputs_have_no_closest_match() {
        assert!(closest(&[], &["a"], &Limits::default()).is_none());
        assert!(closest(&split_lines("a"), &[], &Limits::default()).is_none());
    }

    #[test]
    fn snippets_are_capped() {
        let file: String = (0..100)
            .map(|i| format!("line {i}\n"))
            .collect::<Vec<_>>()
            .concat();
        let needle: Vec<String> = (0..100).map(|i| format!("line {i}")).collect();
        let needle: Vec<&str> = needle.iter().map(String::as_str).collect();
        let m = run(&file, &needle);
        assert!(m.snippet.lines().count() <= 41);
        assert!(m.snippet.ends_with('…'));
    }
}
