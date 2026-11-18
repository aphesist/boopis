//! `pack.read`: a whole file or line ranges, with line numbers.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::files::{self, Loaded};
use crate::never_pack::NeverPack;
use crate::paths::{RelPath, Root};
use crate::redact::Redactor;
use crate::render::{self, Line, SEP_SOURCE};
use crate::types::{
    Budget, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES, Redactions, Truncation, WalkOptions,
    WithheldFile, note,
};

/// An inclusive, 1-based line range.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LineRange {
    /// First line (1-based).
    pub start: u32,
    /// Last line, inclusive. Omit to read to the end of the file.
    #[serde(default)]
    pub end: Option<u32>,
}

/// A run of numbered lines.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Segment {
    /// First line, 1-based.
    pub start_line: u32,
    /// Last line, 1-based.
    pub end_line: u32,
    /// The lines, one per row: `N|text`.
    pub text: String,
}

/// What happened to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReadStatus {
    /// Read; see `segments`.
    Ok,
    /// On the never-pack list; see `withheld`.
    Withheld,
    /// A binary file; nothing returned.
    Binary,
    /// Over the per-file cap; nothing returned.
    TooLarge,
}

/// The parameters of `pack.read` apart from the root.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReadParams {
    /// File path relative to the root.
    pub path: String,
    /// Line ranges to return. Empty means the whole file.
    #[serde(default)]
    pub ranges: Vec<LineRange>,
    /// Output budget in bytes (default 65536). In a bundle this is a cap on the item's share.
    #[serde(default)]
    pub max_bytes: Option<usize>,
    /// Per-file cap.
    #[serde(default)]
    pub walk: WalkOptions,
}

impl ReadParams {
    /// The output budget in force: `max_bytes` or the default.
    #[must_use]
    pub fn max_bytes(&self) -> usize {
        self.max_bytes.unwrap_or(DEFAULT_MAX_BYTES)
    }
}

/// The request of `pack.read`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReadRequest {
    /// The root directory.
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: ReadParams,
}

/// The response of `pack.read`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ReadResponse {
    /// The path, normalised.
    pub path: String,
    /// What happened to the file.
    pub status: ReadStatus,
    /// Lines in the file (after redaction, which keeps line count). 0 unless `status` is `ok`.
    pub total_lines: u32,
    /// The returned lines, one segment per merged range.
    pub segments: Vec<Segment>,
    /// Requested ranges that start past the end of the file.
    pub unsatisfied: Vec<LineRange>,
    /// Set when the file was withheld.
    pub withheld: Option<WithheldFile>,
    /// Redactions inside `segments`.
    pub redactions: Redactions,
    /// Why the result is incomplete.
    pub truncated: Vec<Truncation>,
    /// Bytes charged to the budget.
    pub bytes: usize,
}

impl ReadResponse {
    fn empty(path: &RelPath, status: ReadStatus) -> Self {
        Self {
            path: path.to_string(),
            status,
            total_lines: 0,
            segments: Vec::new(),
            unsatisfied: Vec::new(),
            withheld: None,
            redactions: Redactions::default(),
            truncated: Vec::new(),
            bytes: 0,
        }
    }
}

const MAX_RANGES: usize = 100;

/// Merged line ranges to read, and the requested ones that start past the end.
type RangePlan = (Vec<(usize, usize)>, Vec<LineRange>);

/// Sorts and merges overlapping or touching ranges; clamps to `total`.
/// Returns the merged ranges and the ones that start past the end.
fn plan_ranges(ranges: &[LineRange], total: usize) -> Result<RangePlan> {
    if ranges.len() > MAX_RANGES {
        return Err(Error::InvalidRequest(format!(
            "at most {MAX_RANGES} ranges"
        )));
    }
    let mut wanted: Vec<(usize, usize, LineRange)> = Vec::new();
    for r in ranges {
        let end = r.end.unwrap_or(u32::MAX);
        if r.start == 0 || end < r.start {
            return Err(Error::InvalidRequest(format!(
                "bad range {}..{}: lines are 1-based and end must not precede start",
                r.start,
                r.end.map_or_else(String::new, |e| e.to_string())
            )));
        }
        wanted.push((r.start as usize, end as usize, *r));
    }
    wanted.sort_by_key(|w| (w.0, w.1));
    let mut merged: Vec<(usize, usize)> = Vec::new();
    let mut unsatisfied = Vec::new();
    for (s, e, orig) in wanted {
        if s > total {
            unsatisfied.push(orig);
            continue;
        }
        let e = e.min(total);
        match merged.last_mut() {
            Some(last) if s <= last.1 + 1 => last.1 = last.1.max(e),
            _ => merged.push((s, e)),
        }
    }
    Ok((merged, unsatisfied))
}

/// Takes lines `first..=last` of `text` into a [`Segment`] while the budget
/// allows. Returns the segment (if any line fit) and whether all lines fit.
pub(crate) fn take_segment(
    text: &str,
    starts: &[usize],
    (first, last): (usize, usize),
    path: &str,
    budget: &mut Budget,
    clipped: &mut bool,
) -> (Option<Segment>, bool) {
    if !budget.try_take(render::block_overhead(path)) {
        return (None, false);
    }
    let mut out = String::new();
    let mut taken_last = None;
    let mut complete = true;
    for n in first..=last {
        let (line, was_clipped) = Line::new(
            n,
            files::line_text(text, starts, n),
            DEFAULT_MAX_LINE_BYTES,
            false,
        );
        if !budget.try_take(line.cost()) {
            complete = false;
            break;
        }
        *clipped |= was_clipped;
        render::push_line(&mut out, n, SEP_SOURCE, &line.text);
        taken_last = Some(n);
    }
    let seg = taken_last.map(|l| Segment {
        start_line: u32::try_from(first).unwrap_or(u32::MAX),
        end_line: u32::try_from(l).unwrap_or(u32::MAX),
        text: out,
    });
    (seg, complete)
}

/// Runs `pack.read` against an open root.
///
/// # Errors
/// Request, path and I/O errors. A withheld, binary or oversized file is a
/// successful result with the matching `status`.
pub fn read(root: &Root, p: &ReadParams) -> Result<ReadResponse> {
    if p.path.is_empty() {
        return Err(Error::InvalidRequest("path is empty".into()));
    }
    if p.max_bytes() == 0 {
        return Err(Error::InvalidRequest("max_bytes must be positive".into()));
    }
    let rel = RelPath::parse(&p.path)?;
    if let Some(reason) = NeverPack::embedded()?.check(&rel) {
        let mut r = ReadResponse::empty(&rel, ReadStatus::Withheld);
        r.withheld = Some(WithheldFile {
            path: rel.to_string(),
            reason: reason.to_owned(),
        });
        return Ok(r);
    }
    if root.is_dir(&rel)? {
        return Err(Error::InvalidRequest(format!("{rel} is a directory")));
    }
    let mut buf = Vec::new();
    match files::load(root, &rel, p.walk.max_file_bytes(), &mut buf)? {
        Loaded::Binary => return Ok(ReadResponse::empty(&rel, ReadStatus::Binary)),
        Loaded::TooLarge => return Ok(ReadResponse::empty(&rel, ReadStatus::TooLarge)),
        Loaded::Text => {}
    }
    let redactor = Redactor::embedded()?;
    let lossy = String::from_utf8_lossy(&buf);
    // The whole file is redacted before any slicing, so a secret that spans
    // the edge of a requested range is still caught.
    let (text, _) = redactor.redact(rel.as_str(), &lossy);
    let starts = files::line_starts(&text);
    let total = starts.len();
    let ranges = if p.ranges.is_empty() && total > 0 {
        vec![LineRange {
            start: 1,
            end: None,
        }]
    } else {
        p.ranges.clone()
    };
    let (plan, unsatisfied) = plan_ranges(&ranges, total)?;
    let mut resp = ReadResponse::empty(&rel, ReadStatus::Ok);
    resp.total_lines = u32::try_from(total).unwrap_or(u32::MAX);
    resp.unsatisfied = unsatisfied;
    let mut budget = Budget::new(p.max_bytes());
    let mut clipped = false;
    for range in plan {
        let (seg, complete) = take_segment(
            &text,
            &starts,
            range,
            rel.as_str(),
            &mut budget,
            &mut clipped,
        );
        resp.segments.extend(seg);
        if !complete {
            note(&mut resp.truncated, Truncation::MaxBytes);
            break;
        }
    }
    if clipped {
        note(&mut resp.truncated, Truncation::LineClipped);
    }
    resp.bytes = budget.used();
    for s in &resp.segments {
        redactor.count_placeholders(&s.text, &mut resp.redactions);
    }
    Ok(resp)
}

/// `pack.read`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`read`].
pub fn handle_read(req: &ReadRequest) -> Result<ReadResponse> {
    read(&Root::open(&req.root)?, &req.params)
}
