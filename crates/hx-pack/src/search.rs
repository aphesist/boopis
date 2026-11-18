//! `pack.search`: matches with surrounding lines.
//!
//! Search runs on the raw bytes to find candidate files quickly. A file with
//! a hit is then redacted as a whole and searched *again* on the redacted
//! text, and only that second result is reported. So a pattern can never
//! match a secret that the output hides, which would otherwise let a caller
//! recover it one regex at a time.

use std::io;

use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::sinks::Bytes;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::files::{self, Skip};
use crate::redact::Redactor;
use crate::render::{self, Line, SEP_CONTEXT, SEP_MATCH};
use crate::root::Root;
use crate::scan::{self, Weight};
use crate::types::{
    Budget, Control, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES, Redactions, Skipped, Truncation,
    WalkOptions, Withheld, note,
};
use crate::walk::{self, WalkSpec};

/// How the pattern is read.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PatternMode {
    /// A regular expression (Rust regex syntax).
    #[default]
    Regex,
    /// Plain text, no escaping needed.
    Literal,
}

/// How letter case is treated.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CaseMode {
    /// Case-insensitive unless the pattern has an uppercase letter.
    #[default]
    Smart,
    /// Exact case.
    Sensitive,
    /// Ignore case.
    Insensitive,
}

fn d_before() -> usize {
    2
}
fn d_after() -> usize {
    2
}
fn d_matches() -> usize {
    200
}

/// The parameters of `pack.search` apart from the root (a bundle shares one root).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SearchParams {
    /// The pattern.
    pub pattern: String,
    /// `regex` (default) or `literal`.
    #[serde(default)]
    pub mode: PatternMode,
    /// `smart` (default), `sensitive` or `insensitive`.
    #[serde(default)]
    pub case: CaseMode,
    /// Gitignore-style globs that narrow the files; `!glob` excludes. Empty means all.
    #[serde(default)]
    pub globs: Vec<String>,
    /// Lines of context before each match (default 2, at most 200).
    #[serde(default = "d_before")]
    pub context_before: usize,
    /// Lines of context after each match (default 2, at most 200).
    #[serde(default = "d_after")]
    pub context_after: usize,
    /// Stop after this many matching lines (default 200, at most 10000).
    #[serde(default = "d_matches")]
    pub max_matches: usize,
    /// Output budget in bytes (default 65536). In a bundle this is a cap on the item's share.
    #[serde(default)]
    pub max_bytes: Option<usize>,
    /// Skip list and per-file cap.
    #[serde(default)]
    pub walk: WalkOptions,
}

impl SearchParams {
    /// The output budget in force: `max_bytes` or the default.
    #[must_use]
    pub fn max_bytes(&self) -> usize {
        self.max_bytes.unwrap_or(DEFAULT_MAX_BYTES)
    }

    /// Params for `pattern` with every default.
    #[must_use]
    pub fn new(pattern: impl Into<String>) -> Self {
        Self {
            pattern: pattern.into(),
            mode: PatternMode::default(),
            case: CaseMode::default(),
            globs: Vec::new(),
            context_before: d_before(),
            context_after: d_after(),
            max_matches: d_matches(),
            max_bytes: None,
            walk: WalkOptions::default(),
        }
    }
}

/// The request of `pack.search`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SearchRequest {
    /// The directory to search; everything stays inside it.
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: SearchParams,
}

/// A run of consecutive lines around one or more matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Block {
    /// Path relative to the root.
    pub path: String,
    /// First line, 1-based.
    pub start_line: u32,
    /// Last line, 1-based.
    pub end_line: u32,
    /// The lines in this block that matched.
    pub match_lines: Vec<u32>,
    /// The lines, one per row: `N:text` for a match, `N-text` for context.
    pub text: String,
}

/// The response of `pack.search`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SearchResponse {
    /// Blocks in path order, then line order. Overlapping windows are merged.
    pub blocks: Vec<Block>,
    /// Matching lines included in `blocks`.
    pub matches: usize,
    /// Files that passed the walk filters.
    pub files_walked: usize,
    /// Files scanned before the call stopped (the ordered prefix).
    pub files_scanned: usize,
    /// Scanned files that had at least one match.
    pub files_matched: usize,
    /// Files looked at and left out.
    pub skipped: Skipped,
    /// Files the never-pack list withheld.
    pub withheld: Withheld,
    /// Redactions inside `blocks`.
    pub redactions: Redactions,
    /// Why the result is incomplete; empty when it is complete.
    pub truncated: Vec<Truncation>,
    /// Bytes charged to the budget.
    pub bytes: usize,
}

pub(crate) fn validate(p: &SearchParams) -> Result<()> {
    let bad = |m: &str| Err(Error::InvalidRequest(m.to_owned()));
    if p.pattern.is_empty() {
        return bad("pattern is empty");
    }
    if p.pattern.contains(['\n', '\r']) {
        return Err(Error::InvalidPattern(
            "a pattern matches within one line; it cannot contain a line break".into(),
        ));
    }
    if p.max_matches == 0 || p.max_matches > 10_000 {
        return bad("max_matches must be 1..=10000");
    }
    if p.max_bytes() == 0 {
        return bad("max_bytes must be positive");
    }
    if p.context_before > 200 || p.context_after > 200 {
        return bad("context_before and context_after must be at most 200");
    }
    Ok(())
}

fn matcher(p: &SearchParams) -> Result<RegexMatcher> {
    let mut b = RegexMatcherBuilder::new();
    b.fixed_strings(p.mode == PatternMode::Literal);
    match p.case {
        CaseMode::Smart => b.case_smart(true),
        CaseMode::Insensitive => b.case_insensitive(true),
        CaseMode::Sensitive => &mut b,
    };
    b.build(&p.pattern)
        .map_err(|e| Error::InvalidPattern(e.to_string()))
}

/// A file window: consecutive lines already clipped.
struct Window {
    lines: Vec<Line>,
}

impl Window {
    fn cost(&self, path: &str) -> usize {
        render::block_overhead(path) + self.lines.iter().map(Line::cost).sum::<usize>()
    }

    fn matches(&self) -> usize {
        self.lines.iter().filter(|l| l.is_match).count()
    }
}

#[derive(Default)]
struct FileResult {
    windows: Vec<Window>,
    matches: usize,
    cost: usize,
    capped: bool,
    clipped: bool,
    skip: Option<Skip>,
}

struct Scratch {
    buf: Vec<u8>,
    searcher: Searcher,
}

struct Ctx<'a> {
    root: &'a Root,
    matcher: &'a RegexMatcher,
    redactor: &'a Redactor,
    p: &'a SearchParams,
    max_file: u64,
}

/// Runs the pattern over `haystack` and returns the 1-based matching lines
/// (at most `limit`) and whether the limit cut the list.
fn match_lines(
    matcher: &RegexMatcher,
    searcher: &mut Searcher,
    haystack: &[u8],
    limit: usize,
) -> Result<(Vec<usize>, bool)> {
    let mut lines = Vec::new();
    let mut capped = false;
    let sink = Bytes(|n, _line| {
        if lines.len() >= limit {
            capped = true;
            return Ok(false);
        }
        lines.push(usize::try_from(n).unwrap_or(usize::MAX));
        Ok(true)
    });
    searcher
        .search_slice(matcher, haystack, sink)
        .map_err(|e: io::Error| Error::Io {
            path: "<search>".into(),
            source: e,
        })?;
    Ok((lines, capped))
}

fn search_file(ctx: &Ctx<'_>, rel: &str, sc: &mut Scratch) -> Result<FileResult> {
    let mut out = FileResult::default();
    if let Some(skip) = files::load_walked(ctx.root, rel, ctx.max_file, &mut sc.buf)? {
        out.skip = Some(skip);
        return Ok(out);
    }
    let limit = ctx.p.max_matches;
    // Phase one, on the raw bytes: cheap, finds candidate files.
    let (raw_hits, _) = match_lines(ctx.matcher, &mut sc.searcher, &sc.buf, 1)?;
    if raw_hits.is_empty() {
        return Ok(out);
    }
    // Phase two, on the redacted text: what is reported.
    let text = String::from_utf8_lossy(&sc.buf);
    let (red, counts) = ctx.redactor.redact(rel, &text);
    let haystack = if counts.total == 0 {
        text.as_bytes()
    } else {
        red.as_bytes()
    };
    let (hits, capped) = match_lines(ctx.matcher, &mut sc.searcher, haystack, limit)?;
    if hits.is_empty() {
        return Ok(out);
    }
    let starts = files::line_starts(&red);
    out.matches = hits.len();
    out.capped = capped;
    let (before, after) = (ctx.p.context_before, ctx.p.context_after);
    let max_line = DEFAULT_MAX_LINE_BYTES;
    let mut i = 0;
    while i < hits.len() {
        let first = hits[i].saturating_sub(before).max(1);
        let mut last = hits[i];
        let mut j = i + 1;
        // Merge windows that overlap or touch.
        while j < hits.len()
            && hits[j].saturating_sub(before).max(1) <= (last + after).min(starts.len()) + 1
        {
            last = hits[j];
            j += 1;
        }
        let end = (last + after).min(starts.len());
        let mut lines = Vec::with_capacity(end - first + 1);
        for n in first..=end {
            let is_match = hits[i..j].binary_search(&n).is_ok();
            let (line, clipped) =
                Line::new(n, files::line_text(&red, &starts, n), max_line, is_match);
            out.clipped |= clipped;
            lines.push(line);
        }
        let w = Window { lines };
        out.cost += w.cost(rel);
        out.windows.push(w);
        i = j;
    }
    Ok(out)
}

/// Runs `pack.search` against an open root.
///
/// # Errors
/// Request, pattern, path, cancellation and configuration errors.
pub fn search(root: &Root, p: &SearchParams, ctl: &Control) -> Result<SearchResponse> {
    validate(p)?;
    let matcher = matcher(p)?;
    let redactor = Redactor::embedded()?;
    let walked = walk::collect(
        root,
        &WalkSpec {
            globs: &p.globs,
            starts: &[],
            name_filter: None,
            opts: &p.walk,
        },
        ctl,
    )?;
    let ctx = Ctx {
        root,
        matcher: &matcher,
        redactor,
        p,
        max_file: p.walk.max_file_bytes(),
    };
    let slots = scan::ordered(
        walked.files.as_slice(),
        ctl,
        Weight {
            matches: p.max_matches,
            bytes: p.max_bytes(),
        },
        || Scratch {
            buf: Vec::with_capacity(16 * 1024),
            searcher: SearcherBuilder::new()
                .line_number(true)
                .binary_detection(BinaryDetection::none())
                .build(),
        },
        |rel, sc| search_file(&ctx, rel, sc),
        |r: &FileResult| Weight {
            matches: r.matches,
            bytes: r.cost,
        },
    )?;
    Ok(assemble(p, &walked, slots, redactor))
}

fn assemble(
    p: &SearchParams,
    walked: &walk::Walked,
    slots: Vec<Option<FileResult>>,
    redactor: &Redactor,
) -> SearchResponse {
    let mut resp = SearchResponse {
        files_walked: walked.files.as_slice().len(),
        withheld: Withheld {
            count: walked.withheld.count,
            files: walked.withheld.files.clone(),
        },
        ..SearchResponse::default()
    };
    let mut budget = Budget::new(p.max_bytes());
    let total = slots.len();
    'files: for (idx, (rel, slot)) in walked.files.as_slice().iter().zip(slots).enumerate() {
        let Some(fr) = slot else {
            // The scan stopped early because the finished prefix met a limit.
            note(
                &mut resp.truncated,
                if resp.matches >= p.max_matches {
                    Truncation::MaxMatches
                } else {
                    Truncation::MaxBytes
                },
            );
            break;
        };
        resp.files_scanned += 1;
        if let Some(skip) = fr.skip {
            resp.skipped.count(skip);
        }
        if fr.clipped {
            note(&mut resp.truncated, Truncation::LineClipped);
        }
        if fr.matches > 0 {
            resp.files_matched += 1;
        }
        let path = rel.as_str();
        for mut w in fr.windows {
            let remaining = p.max_matches - resp.matches;
            if remaining == 0 {
                note(&mut resp.truncated, Truncation::MaxMatches);
                break 'files;
            }
            if w.matches() > remaining {
                trim_to_matches(&mut w, remaining, p.context_after);
            }
            if !push_block(&mut resp, &mut budget, path, w) {
                note(&mut resp.truncated, Truncation::MaxBytes);
                break 'files;
            }
        }
        if fr.capped || (resp.matches >= p.max_matches && idx + 1 < total) {
            note(&mut resp.truncated, Truncation::MaxMatches);
            break;
        }
    }
    resp.bytes = budget.used();
    for b in &resp.blocks {
        redactor.count_placeholders(&b.text, &mut resp.redactions);
    }
    resp
}

/// Cuts a window after its `keep`-th match plus the trailing context. Lines
/// past that match that also matched are shown as context, so the window
/// never counts more than `keep` matches.
fn trim_to_matches(w: &mut Window, keep: usize, after: usize) {
    let mut seen = 0;
    let mut cut_at = None;
    for l in &mut w.lines {
        if l.is_match {
            seen += 1;
            if seen == keep {
                cut_at = Some(l.n + after);
            } else if seen > keep {
                l.is_match = false;
            }
        }
    }
    if let Some(end) = cut_at {
        w.lines.retain(|l| l.n <= end);
    }
}

/// Adds `w` as a block if it fits; otherwise adds the longest prefix that
/// fits (if any) and returns false.
fn push_block(resp: &mut SearchResponse, budget: &mut Budget, path: &str, mut w: Window) -> bool {
    let fits = budget.try_take(w.cost(path));
    if !fits {
        let mut room = budget
            .remaining()
            .saturating_sub(render::block_overhead(path));
        let mut keep = 0;
        for l in &w.lines {
            let c = l.cost();
            if c > room {
                break;
            }
            room -= c;
            keep += 1;
        }
        if keep == 0 {
            return false;
        }
        w.lines.truncate(keep);
        // Charged exactly what was kept: this cannot exceed the room computed above.
        let _ = budget.try_take(w.cost(path));
    }
    let mut text = String::new();
    let mut match_lines = Vec::new();
    for l in &w.lines {
        let sep = if l.is_match { SEP_MATCH } else { SEP_CONTEXT };
        render::push_line(&mut text, l.n, sep, &l.text);
        if l.is_match {
            match_lines.push(u32::try_from(l.n).unwrap_or(u32::MAX));
        }
    }
    resp.matches += match_lines.len();
    let (Some(first), Some(last)) = (w.lines.first(), w.lines.last()) else {
        return fits;
    };
    resp.blocks.push(Block {
        path: path.to_owned(),
        start_line: u32::try_from(first.n).unwrap_or(u32::MAX),
        end_line: u32::try_from(last.n).unwrap_or(u32::MAX),
        match_lines,
        text,
    });
    fits
}

/// `pack.search`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`search`].
pub fn handle_search(req: &SearchRequest) -> Result<SearchResponse> {
    handle_search_with(req, &Control::none())
}

/// [`handle_search`] with cancellation and a deadline.
///
/// # Errors
/// See [`search`].
pub fn handle_search_with(req: &SearchRequest, ctl: &Control) -> Result<SearchResponse> {
    search(&Root::open(&req.root)?, &req.params, ctl)
}
