//! Line formatting and cost, shared by search, read and symbol.
//!
//! A numbered line is `N<sep>text` followed by a newline. The separator is
//! `:` for a search match, `-` for a context line (ripgrep's convention,
//! which models read well) and `|` for plain numbered source.

use crate::types::{ITEM_OVERHEAD, clip_line};

/// Separator of a matched line.
pub(crate) const SEP_MATCH: char = ':';
/// Separator of a context line.
pub(crate) const SEP_CONTEXT: char = '-';
/// Separator of numbered source (read, symbol).
pub(crate) const SEP_SOURCE: char = '|';

/// Decimal digits of `n`.
pub(crate) fn digits(n: usize) -> usize {
    n.checked_ilog10().map_or(1, |d| d as usize + 1)
}

/// Bytes one numbered line takes in the output, newline included.
pub(crate) fn line_cost(n: usize, text_len: usize) -> usize {
    digits(n) + 1 + text_len + 1
}

/// Bytes a block header and framing take for `path`.
pub(crate) fn block_overhead(path: &str) -> usize {
    ITEM_OVERHEAD + path.len()
}

/// Appends `N<sep>text\n` to `out`.
pub(crate) fn push_line(out: &mut String, n: usize, sep: char, text: &str) {
    out.push_str(&n.to_string());
    out.push(sep);
    out.push_str(text);
    out.push('\n');
}

/// A line already clipped to the line cap, with its number.
#[derive(Debug, Clone)]
pub(crate) struct Line {
    pub n: usize,
    pub text: String,
    pub is_match: bool,
}

impl Line {
    /// Clips `raw` to `max` bytes. The flag says whether it was cut.
    pub(crate) fn new(n: usize, raw: &str, max: usize, is_match: bool) -> (Self, bool) {
        let (text, clipped) = clip_line(raw, max);
        (Self { n, text, is_match }, clipped)
    }

    pub(crate) fn cost(&self) -> usize {
        line_cost(self.n, self.text.len())
    }
}
