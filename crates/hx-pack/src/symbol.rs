//! `pack.symbol`: the full source of the definitions with a given name.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::files::{self, Skip};
use crate::languages::Registry;
use crate::never_pack::NeverPack;
use crate::paths::{RelPath, Root};
use crate::redact::Redactor;
use crate::render::{self, Line, SEP_SOURCE};
use crate::scan::{self, Weight};
use crate::symbols::{self, Symbol};
use crate::types::{
    Budget, Control, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES, Redactions, Skipped, Truncation,
    WalkOptions, Withheld, WithheldFile, note,
};
use crate::walk::{self, WalkSpec};

fn d_defs() -> usize {
    20
}

/// The parameters of `pack.symbol` apart from the root.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SymbolParams {
    /// The name to find. `Type.method` or `Type::method` selects by parent too.
    pub name: String,
    /// Restrict to a file or directory under the root.
    #[serde(default)]
    pub path: Option<String>,
    /// Restrict to a language, by id or extension (`rust`, `rs`, `py`).
    #[serde(default)]
    pub lang: Option<String>,
    /// Return at most this many definitions (default 20).
    #[serde(default = "d_defs")]
    pub max_definitions: usize,
    /// Output budget in bytes (default 65536). In a bundle this is a cap on the item's share.
    #[serde(default)]
    pub max_bytes: Option<usize>,
    /// Skip list and per-file cap.
    #[serde(default)]
    pub walk: WalkOptions,
}

impl SymbolParams {
    /// The output budget in force: `max_bytes` or the default.
    #[must_use]
    pub fn max_bytes(&self) -> usize {
        self.max_bytes.unwrap_or(DEFAULT_MAX_BYTES)
    }
}

/// The request of `pack.symbol`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SymbolRequest {
    /// The root directory.
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: SymbolParams,
}

/// One definition with its source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct Found {
    /// Path relative to the root.
    pub path: String,
    /// Definition kind.
    pub kind: String,
    /// Identifier.
    pub name: String,
    /// Enclosing definitions, outermost first.
    pub parent: Option<String>,
    /// The declaration up to its body.
    pub signature: String,
    /// First line of the source, including attributes, decorators and doc comments.
    pub start_line: u32,
    /// Last line.
    pub end_line: u32,
    /// The source, one numbered row per line: `N|text`.
    pub text: String,
}

/// The response of `pack.symbol`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct SymbolResponse {
    /// Matching definitions, by path then line.
    pub definitions: Vec<Found>,
    /// Files parsed or checked before the call stopped.
    pub files_scanned: usize,
    /// Files left out.
    pub skipped: Skipped,
    /// Files withheld by the never-pack list.
    pub withheld: Withheld,
    /// Redactions inside `definitions`.
    pub redactions: Redactions,
    /// Why the result is incomplete.
    pub truncated: Vec<Truncation>,
    /// Bytes charged to the budget.
    pub bytes: usize,
}

struct Target<'a> {
    last: &'a str,
    parents: Vec<&'a str>,
}

impl<'a> Target<'a> {
    fn parse(name: &'a str) -> Result<Self> {
        let name = name.trim();
        let parts: Vec<&str> = name
            .split(['.', ':', '#'])
            .filter(|s| !s.is_empty())
            .collect();
        let Some((last, parents)) = parts.split_last() else {
            return Err(Error::InvalidRequest("name is empty".into()));
        };
        if name.len() > 200 {
            return Err(Error::InvalidRequest("name is too long".into()));
        }
        Ok(Self {
            last,
            parents: parents.to_vec(),
        })
    }

    fn matches(&self, d: &Symbol) -> bool {
        if d.name != self.last {
            return false;
        }
        if self.parents.is_empty() {
            return true;
        }
        let chain: Vec<&str> = d
            .parent
            .as_deref()
            .map_or_else(Vec::new, |p| p.split('.').collect());
        chain.len() >= self.parents.len()
            && chain[chain.len() - self.parents.len()..] == self.parents[..]
    }
}

#[derive(Default)]
struct FileFound {
    found: Vec<Found>,
    cost: usize,
    skip: Option<Skip>,
}

/// The numbered source of `d`, cut at `cap` bytes on a line boundary.
fn source_text(text: &str, starts: &[usize], d: &Symbol, cap: usize) -> String {
    let first = d.start_line as usize;
    let last = d.end_line as usize;
    let mut out = String::new();
    for n in first..=last {
        let (line, _) = Line::new(
            n,
            files::line_text(text, starts, n),
            DEFAULT_MAX_LINE_BYTES,
            false,
        );
        if out.len() + line.cost() > cap {
            break;
        }
        render::push_line(&mut out, n, SEP_SOURCE, &line.text);
    }
    out
}

/// What every worker needs to look for one name.
struct Search<'a> {
    root: &'a Root,
    registry: &'a Registry,
    redactor: &'a Redactor,
    target: Target<'a>,
    only_lang: Option<&'a str>,
    max_file: u64,
    cap: usize,
}

impl Search<'_> {
    fn in_file(&self, rel: &RelPath, buf: &mut Vec<u8>) -> Result<FileFound> {
        let mut out = FileFound::default();
        let Some(lang) = self
            .registry
            .for_path(rel)
            .filter(|l| self.only_lang.is_none_or(|id| id == l.id()))
        else {
            return Ok(out);
        };
        if let Some(skip) = files::load_walked(self.root, rel, self.max_file, buf)? {
            out.skip = Some(skip);
            return Ok(out);
        }
        let needle = self.target.last;
        let lossy = String::from_utf8_lossy(buf);
        // Cheap prefilter: a file without the name cannot define it, so it is not parsed.
        if !lossy.contains(needle) {
            return Ok(out);
        }
        let (text, _) = self.redactor.redact(rel.as_str(), &lossy);
        if !text.contains(needle) {
            return Ok(out);
        }
        let defs = match symbols::definitions(lang, &text) {
            Ok(d) => d,
            Err(Error::ParseFailed(_)) => return Ok(out),
            Err(e) => return Err(e),
        };
        let starts = files::line_starts(&text);
        for d in defs.iter().filter(|d| self.target.matches(d)) {
            let body = source_text(&text, &starts, d, self.cap);
            out.cost += render::block_overhead(rel.as_str()) + d.signature.len() + body.len();
            out.found.push(Found {
                path: rel.to_string(),
                kind: d.kind.clone(),
                name: d.name.clone(),
                parent: d.parent.clone(),
                signature: d.signature.clone(),
                start_line: d.start_line,
                end_line: d.end_line,
                text: body,
            });
        }
        Ok(out)
    }
}

/// The files to look in: the named file, or a walk of the named directory.
fn candidates(
    root: &Root,
    p: &SymbolParams,
    ctl: &Control,
    wanted: &(dyn Fn(&str) -> bool + Sync),
    resp: &mut SymbolResponse,
) -> Result<Vec<RelPath>> {
    let start = match &p.path {
        Some(raw) => RelPath::parse(raw)?,
        None => RelPath::root(),
    };
    if root.is_dir(&start)? {
        let walked = walk::collect(
            root,
            &WalkSpec {
                globs: &[],
                starts: std::slice::from_ref(&start),
                name_filter: Some(wanted),
                opts: &p.walk,
            },
            ctl,
        )?;
        resp.withheld = walked.withheld;
        return Ok(walked.files);
    }
    if let Some(reason) = NeverPack::embedded()?.check(&start) {
        resp.withheld.push(WithheldFile {
            path: start.to_string(),
            reason: reason.to_owned(),
        });
        return Ok(Vec::new());
    }
    if root.is_file(&start)? {
        Ok(vec![start])
    } else {
        Err(Error::NotFound(start.to_string()))
    }
}

/// Runs `pack.symbol` against an open root.
///
/// # Errors
/// Request, path, language, cancellation and configuration errors.
pub fn symbol(root: &Root, p: &SymbolParams, ctl: &Control) -> Result<SymbolResponse> {
    symbol_with(Registry::builtin()?, root, p, ctl)
}

/// [`symbol`] with a caller-supplied language registry.
///
/// # Errors
/// As [`symbol`].
pub fn symbol_with(
    registry: &Registry,
    root: &Root,
    p: &SymbolParams,
    ctl: &Control,
) -> Result<SymbolResponse> {
    if p.max_bytes() == 0 || p.max_definitions == 0 {
        return Err(Error::InvalidRequest(
            "max_bytes and max_definitions must be positive".into(),
        ));
    }
    let only_lang = match &p.lang {
        Some(l) => Some(
            registry
                .lookup(l)
                .map(|x| x.id().to_owned())
                .ok_or_else(|| Error::UnsupportedLanguage(l.clone()))?,
        ),
        None => None,
    };
    let wanted = |name: &str| {
        RelPath::parse(name).ok().is_some_and(|r| {
            registry
                .for_path(&r)
                .is_some_and(|l| only_lang.as_deref().is_none_or(|id| id == l.id()))
        })
    };
    let mut resp = SymbolResponse::default();
    let list = candidates(root, p, ctl, &wanted, &mut resp)?;
    let redactor = Redactor::embedded()?;
    let search = Search {
        root,
        registry,
        redactor,
        target: Target::parse(&p.name)?,
        only_lang: only_lang.as_deref(),
        max_file: p.walk.max_file_bytes(),
        cap: p.max_bytes(),
    };
    let slots = scan::ordered(
        &list,
        ctl,
        Weight {
            matches: p.max_definitions,
            bytes: p.max_bytes(),
        },
        || Vec::with_capacity(16 * 1024),
        |rel, buf| search.in_file(rel, buf),
        |f: &FileFound| Weight {
            matches: f.found.len(),
            bytes: f.cost,
        },
    )?;
    assemble(&mut resp, slots, p);
    for d in &resp.definitions {
        redactor.count_placeholders(&d.text, &mut resp.redactions);
    }
    Ok(resp)
}

/// Adds definitions in order while the budget and the count allow.
fn assemble(resp: &mut SymbolResponse, slots: Vec<Option<FileFound>>, p: &SymbolParams) {
    let mut budget = Budget::new(p.max_bytes());
    'files: for slot in slots {
        let Some(ff) = slot else {
            let full = resp.definitions.len() >= p.max_definitions;
            note(
                &mut resp.truncated,
                if full {
                    Truncation::MaxItems
                } else {
                    Truncation::MaxBytes
                },
            );
            break;
        };
        resp.files_scanned += 1;
        if let Some(skip) = ff.skip {
            resp.skipped.count(skip);
        }
        for mut f in ff.found {
            if resp.definitions.len() >= p.max_definitions {
                note(&mut resp.truncated, Truncation::MaxItems);
                break 'files;
            }
            if !budget.try_take(render::block_overhead(&f.path) + f.signature.len()) {
                note(&mut resp.truncated, Truncation::MaxBytes);
                break 'files;
            }
            let cut = cut_to_room(&mut f, budget.remaining());
            // Charged exactly what was kept, which fits by construction.
            let _ = budget.try_take(f.text.len());
            resp.definitions.push(f);
            if cut {
                note(&mut resp.truncated, Truncation::MaxBytes);
                break 'files;
            }
        }
    }
    resp.bytes = budget.used();
}

/// Cuts `f.text` to whole lines that fit in `room` bytes and fixes `end_line`.
/// Returns whether anything was cut.
fn cut_to_room(f: &mut Found, room: usize) -> bool {
    if f.text.len() <= room {
        return false;
    }
    let mut keep = 0;
    for line in f.text.split_inclusive('\n') {
        if keep + line.len() > room {
            break;
        }
        keep += line.len();
    }
    f.text.truncate(keep);
    let last = f
        .text
        .lines()
        .next_back()
        .and_then(|l| l.split(SEP_SOURCE).next())
        .and_then(|n| n.parse::<u32>().ok());
    f.end_line = last.unwrap_or(f.start_line.saturating_sub(1));
    true
}

/// `pack.symbol`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`symbol`].
pub fn handle_symbol(req: &SymbolRequest) -> Result<SymbolResponse> {
    handle_symbol_with(req, &Control::none())
}

/// [`handle_symbol`] with cancellation and a deadline.
///
/// # Errors
/// See [`symbol`].
pub fn handle_symbol_with(req: &SymbolRequest, ctl: &Control) -> Result<SymbolResponse> {
    symbol(&Root::open(&req.root)?, &req.params, ctl)
}
