//! `pack.outline`: the definitions of files and directories.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::files::{self, Skip};
use crate::languages::Registry;
use crate::never_pack::NeverPack;
use crate::paths::{RelPath, Root};
use crate::redact::Redactor;
use crate::render;
use crate::scan::{self, Weight};
use crate::symbols::{self, Symbol};
use crate::types::{
    Budget, Control, DEFAULT_MAX_BYTES, Truncation, WalkOptions, Withheld, WithheldFile, note,
};
use crate::walk::{self, WalkSpec};

/// What happened to one file of an outline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum OutlineStatus {
    /// Parsed; see `symbols`.
    Ok,
    /// No grammar is registered for the extension.
    Unsupported,
    /// A binary file.
    Binary,
    /// Over the per-file cap.
    TooLarge,
    /// The parser failed on this file.
    ParseFailed,
    /// Could not be read.
    Unreadable,
}

fn d_files() -> usize {
    200
}

/// The parameters of `pack.outline` apart from the root.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OutlineParams {
    /// Files or directories relative to the root. Empty means the whole root.
    #[serde(default)]
    pub paths: Vec<String>,
    /// Output budget in bytes (default 65536). In a bundle this is a cap on the item's share.
    #[serde(default)]
    pub max_bytes: Option<usize>,
    /// At most this many files when a directory is expanded (default 200).
    #[serde(default = "d_files")]
    pub max_files: usize,
    /// Skip list and per-file cap.
    #[serde(default)]
    pub walk: WalkOptions,
}

impl OutlineParams {
    /// The output budget in force: `max_bytes` or the default.
    #[must_use]
    pub fn max_bytes(&self) -> usize {
        self.max_bytes.unwrap_or(DEFAULT_MAX_BYTES)
    }
}

/// The request of `pack.outline`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct OutlineRequest {
    /// The root directory.
    pub root: String,
    /// The rest of the parameters.
    #[serde(flatten)]
    pub params: OutlineParams,
}

/// The outline of one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct FileOutline {
    /// Path relative to the root.
    pub path: String,
    /// Language id, when one is registered.
    pub language: Option<String>,
    /// What happened to the file.
    pub status: OutlineStatus,
    /// The definitions, in source order.
    pub symbols: Vec<Symbol>,
}

/// The response of `pack.outline`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct OutlineResponse {
    /// One entry per file, in path order.
    pub files: Vec<FileOutline>,
    /// Files withheld by the never-pack list.
    pub withheld: Withheld,
    /// Why the result is incomplete.
    pub truncated: Vec<Truncation>,
    /// Bytes charged to the budget.
    pub bytes: usize,
}

/// Bytes a symbol costs in the output.
fn symbol_cost(s: &Symbol) -> usize {
    s.kind.len() + s.name.len() + s.signature.len() + s.parent.as_ref().map_or(0, String::len) + 24
}

fn outline_file(
    root: &Root,
    registry: &Registry,
    redactor: &Redactor,
    rel: &RelPath,
    max_file: u64,
    buf: &mut Vec<u8>,
) -> Result<FileOutline> {
    let lang = registry.for_path(rel);
    let mut out = FileOutline {
        path: rel.to_string(),
        language: lang.map(|l| l.id().to_owned()),
        status: OutlineStatus::Unsupported,
        symbols: Vec::new(),
    };
    let Some(lang) = lang else { return Ok(out) };
    match files::load_walked(root, rel, max_file, buf)? {
        None => {}
        Some(skip) => {
            out.status = match skip {
                Skip::Binary => OutlineStatus::Binary,
                Skip::TooLarge => OutlineStatus::TooLarge,
                Skip::Unreadable => OutlineStatus::Unreadable,
            };
            return Ok(out);
        }
    }
    let lossy = String::from_utf8_lossy(buf);
    // Parse the redacted text so that signatures cannot carry a secret.
    let (text, _) = redactor.redact(rel.as_str(), &lossy);
    match symbols::definitions(lang, &text) {
        Ok(defs) => {
            out.status = OutlineStatus::Ok;
            out.symbols = defs;
        }
        Err(Error::ParseFailed(_)) => out.status = OutlineStatus::ParseFailed,
        Err(e) => return Err(e),
    }
    Ok(out)
}

/// Runs `pack.outline` against an open root.
///
/// # Errors
/// Request, path, cancellation and configuration errors.
pub fn outline(root: &Root, p: &OutlineParams, ctl: &Control) -> Result<OutlineResponse> {
    outline_with(Registry::builtin()?, root, p, ctl)
}

/// [`outline`] with a caller-supplied language registry.
///
/// # Errors
/// As [`outline`].
pub fn outline_with(
    registry: &Registry,
    root: &Root,
    p: &OutlineParams,
    ctl: &Control,
) -> Result<OutlineResponse> {
    if p.max_bytes() == 0 || p.max_files == 0 {
        return Err(Error::InvalidRequest(
            "max_bytes and max_files must be positive".into(),
        ));
    }
    let never = NeverPack::embedded()?;
    let redactor = Redactor::embedded()?;
    let mut resp = OutlineResponse::default();
    let mut targets: Vec<RelPath> = Vec::new();
    let mut dirs: Vec<RelPath> = Vec::new();
    let paths = if p.paths.is_empty() {
        vec![String::new()]
    } else {
        p.paths.clone()
    };
    for raw in &paths {
        let rel = RelPath::parse(raw)?;
        if root.is_dir(&rel)? {
            dirs.push(rel);
        } else if let Some(reason) = never.check(&rel) {
            resp.withheld.push(WithheldFile {
                path: rel.to_string(),
                reason: reason.to_owned(),
            });
        } else if root.is_file(&rel)? {
            targets.push(rel);
        } else {
            return Err(Error::NotFound(rel.to_string()));
        }
    }
    if !dirs.is_empty() {
        let filter =
            |name: &str| RelPath::parse(name).is_ok_and(|r| registry.for_path(&r).is_some());
        let walked = walk::collect(
            root,
            &WalkSpec {
                globs: &[],
                starts: &dirs,
                name_filter: Some(&filter),
                opts: &p.walk,
            },
            ctl,
        )?;
        resp.withheld.merge(walked.withheld);
        targets.extend(walked.files);
    }
    targets.sort();
    targets.dedup();
    if targets.len() > p.max_files {
        targets.truncate(p.max_files);
        note(&mut resp.truncated, Truncation::MaxItems);
    }
    let max_file = p.walk.max_file_bytes();
    let slots = scan::ordered(
        &targets,
        ctl,
        Weight {
            matches: usize::MAX,
            bytes: p.max_bytes(),
        },
        || Vec::with_capacity(16 * 1024),
        |rel, buf| outline_file(root, registry, redactor, rel, max_file, buf),
        |o: &FileOutline| Weight {
            matches: 0,
            bytes: render::block_overhead(&o.path)
                + o.symbols.iter().map(symbol_cost).sum::<usize>(),
        },
    )?;
    let mut budget = Budget::new(p.max_bytes());
    for slot in slots {
        let Some(mut file) = slot else {
            note(&mut resp.truncated, Truncation::MaxBytes);
            break;
        };
        if !budget.try_take(render::block_overhead(&file.path)) {
            note(&mut resp.truncated, Truncation::MaxBytes);
            break;
        }
        let mut keep = 0;
        for s in &file.symbols {
            if !budget.try_take(symbol_cost(s)) {
                note(&mut resp.truncated, Truncation::MaxBytes);
                break;
            }
            keep += 1;
        }
        let cut = keep < file.symbols.len();
        file.symbols.truncate(keep);
        resp.files.push(file);
        if cut {
            break;
        }
    }
    resp.bytes = budget.used();
    Ok(resp)
}

/// `pack.outline`: the entry point a dispatcher calls.
///
/// # Errors
/// See [`outline`].
pub fn handle_outline(req: &OutlineRequest) -> Result<OutlineResponse> {
    handle_outline_with(req, &Control::none())
}

/// [`handle_outline`] with cancellation and a deadline.
///
/// # Errors
/// See [`outline`].
pub fn handle_outline_with(req: &OutlineRequest, ctl: &Control) -> Result<OutlineResponse> {
    outline(&Root::open(&req.root)?, &req.params, ctl)
}
