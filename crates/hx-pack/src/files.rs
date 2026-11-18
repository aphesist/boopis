//! Reading one file under the root, with the size cap and binary check.

use std::io::Read;

use crate::error::{Error, Result};
use crate::root::Root;

/// How many leading bytes are inspected for a NUL.
const BINARY_PROBE: usize = 8192;

/// What [`load`] found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Loaded {
    /// Text; the bytes are in the caller's buffer.
    Text,
    /// A NUL byte in the first 8 KiB.
    Binary,
    /// Longer than the cap; nothing past the cap was read.
    TooLarge,
}

/// Reads `rel` into `buf` (cleared first) through the root's capability handle.
///
/// # Errors
/// Path and I/O errors from [`Root::open_file`] or the read.
pub(crate) fn load(root: &Root, rel: &str, max_bytes: u64, buf: &mut Vec<u8>) -> Result<Loaded> {
    buf.clear();
    let file = root.open_file(rel)?;
    // `take` bounds the read even if the file grows while we read it.
    let mut limited = file.take(max_bytes.saturating_add(1));
    limited
        .read_to_end(buf)
        .map_err(|e| Error::from_io(rel, e))?;
    if buf.len() as u64 > max_bytes {
        buf.clear();
        return Ok(Loaded::TooLarge);
    }
    if buf.iter().take(BINARY_PROBE).any(|&b| b == 0) {
        buf.clear();
        return Ok(Loaded::Binary);
    }
    Ok(Loaded::Text)
}

/// Byte offset of the start of each line.
pub(crate) fn line_starts(text: &str) -> Vec<usize> {
    let mut v = vec![0];
    v.extend(text.match_indices('\n').map(|(i, _)| i + 1));
    if v.last() == Some(&text.len()) && text.ends_with('\n') {
        v.pop();
    }
    if text.is_empty() {
        v.clear();
    }
    v
}

/// The text of 1-based line `n`, without its line ending.
pub(crate) fn line_text<'a>(text: &'a str, starts: &[usize], n: usize) -> &'a str {
    let Some(&s) = starts.get(n.wrapping_sub(1)) else {
        return "";
    };
    let e = starts.get(n).copied().unwrap_or(text.len());
    text[s..e].trim_end_matches(['\n', '\r'])
}

/// Why a walked file was left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Skip {
    /// A NUL byte in the first 8 KiB.
    Binary,
    /// Over the per-file cap.
    TooLarge,
    /// Could not be opened or read (deleted mid-walk, permissions).
    Unreadable,
}

/// Loads a file found by a walk. `Ok(None)` means the text is in `buf`;
/// `Ok(Some(skip))` means the file was left out and `skip` says why.
///
/// # Errors
/// Only errors that are not about this one file (none today; kept for symmetry).
pub(crate) fn load_walked(
    root: &Root,
    rel: &str,
    max_bytes: u64,
    buf: &mut Vec<u8>,
) -> Result<Option<Skip>> {
    match load(root, rel, max_bytes, buf) {
        Ok(Loaded::Text) => Ok(None),
        Ok(Loaded::Binary) => Ok(Some(Skip::Binary)),
        Ok(Loaded::TooLarge) => Ok(Some(Skip::TooLarge)),
        Err(Error::NotFound(_) | Error::PathEscape(_) | Error::Io { .. }) => {
            Ok(Some(Skip::Unreadable))
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_helpers_agree_on_edge_cases() {
        for (text, lines) in [
            ("", 0),
            ("a", 1),
            ("a\n", 1),
            ("a\nb", 2),
            ("\n\n", 2),
            ("a\r\nb\r\n", 2),
        ] {
            let starts = line_starts(text);
            assert_eq!(starts.len(), lines, "{text:?}");
            for n in 1..=lines {
                assert!(!line_text(text, &starts, n).contains('\n'));
            }
        }
        let text = "one\r\ntwo\nthree";
        let starts = line_starts(text);
        assert_eq!(line_text(text, &starts, 1), "one");
        assert_eq!(line_text(text, &starts, 3), "three");
        assert_eq!(line_text(text, &starts, 4), "");
        assert_eq!(line_text(text, &starts, 0), "");
    }
}
