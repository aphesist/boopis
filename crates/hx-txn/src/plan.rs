//! Planning: turn a list of edits into the exact bytes of every touched file, in memory,
//! before anything is journaled or written.
//!
//! Order of checks (fail closed, cheapest first):
//! 1. parse and resolve every path (symlink escapes die here);
//! 2. scope and protected globs, on the requested and the real path (before reading content);
//! 3. read originals and apply each edit to the in-memory copy, collecting *every* failure;
//! 4. size limits.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use cap_std::fs::Dir;
use hx_proto::txn::{Edit, EditFailure, FailureKind, FileChange};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::edit::diff::{self, PatchKind};
use crate::edit::{Failure, replace};
use crate::error::{Error, Result};
use crate::fsops::{self, Meta};
use crate::limits::Limits;
use crate::paths::{self, Kind, PathError, RelPath, Resolved};
use crate::scope::Scope;

/// What a path was before the transaction.
#[derive(Debug)]
pub enum Original {
    /// It did not exist.
    Absent,
    /// A regular file.
    File {
        /// Its bytes.
        bytes: Vec<u8>,
        /// Its metadata.
        meta: Meta,
    },
    /// A symlink (a delete edit named the link itself).
    Symlink {
        /// The link's target text.
        target: String,
    },
}

/// What the transaction does to a path.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Nothing: the result equals the original.
    Unchanged,
    /// Write these bytes (create or modify).
    Write(Vec<u8>),
    /// Remove the path.
    Delete,
}

/// One touched path.
#[derive(Debug)]
pub struct PlannedFile {
    /// Canonical workspace-relative path.
    pub path: String,
    /// What it was.
    pub original: Original,
    /// What happens to it.
    pub outcome: Outcome,
}

impl PlannedFile {
    fn sha_before(&self) -> Option<String> {
        match &self.original {
            Original::Absent => None,
            Original::File { bytes, .. } => Some(sha(bytes)),
            Original::Symlink { target } => Some(sha(target.as_bytes())),
        }
    }

    /// The wire description of this file's change.
    #[must_use]
    pub fn change(&self) -> FileChange {
        let before = self.sha_before();
        let (after, created, deleted) = match &self.outcome {
            Outcome::Unchanged => (before.clone(), false, false),
            Outcome::Write(b) => (
                Some(sha(b)),
                matches!(self.original, Original::Absent),
                false,
            ),
            Outcome::Delete => (None, false, true),
        };
        FileChange {
            path: self.path.clone(),
            sha256_before: before,
            sha256_after: after,
            created,
            deleted,
        }
    }
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The validated result of planning.
#[derive(Debug)]
pub struct Plan {
    /// Every touched path, sorted by canonical path.
    pub files: Vec<PlannedFile>,
    /// Directories the transaction will create, shallowest first.
    pub created_dirs: Vec<String>,
}

impl Plan {
    /// The paths that actually change.
    pub fn changed(&self) -> impl Iterator<Item = &PlannedFile> {
        self.files
            .iter()
            .filter(|f| f.outcome != Outcome::Unchanged)
    }

    /// The wire description of every touched path.
    #[must_use]
    pub fn changes(&self) -> Vec<FileChange> {
        self.files.iter().map(PlannedFile::change).collect()
    }
}

enum OpKind {
    Replace {
        old: String,
        new: String,
        all: bool,
    },
    Create {
        content: String,
        overwrite: bool,
    },
    Delete,
    Patch {
        hunks: Vec<diff::Hunk>,
        kind: PatchKind,
    },
}

struct Op {
    index: u32,
    requested: String,
    kind: OpKind,
    lexical: Option<RelPath>,
    resolved: Option<Resolved>,
}

enum Content {
    Original,
    Absent,
    New(Vec<u8>),
}

struct VFile {
    original: Original,
    content: Content,
    missing_dirs: Vec<String>,
}

impl VFile {
    fn current(&self) -> Option<&[u8]> {
        match &self.content {
            Content::Original => match &self.original {
                Original::File { bytes, .. } => Some(bytes),
                _ => None,
            },
            Content::Absent => None,
            Content::New(b) => Some(b),
        }
    }
}

fn failure(op: &Op, f: Failure) -> EditFailure {
    EditFailure {
        edit_index: op.index,
        path: op.requested.clone(),
        kind: f.kind,
        message: f.message,
        hunk: f.hunk,
        closest: f.closest,
        candidate_lines: f.candidate_lines,
    }
}

fn edit_failure(
    index: usize,
    path: &str,
    kind: FailureKind,
    message: impl Into<String>,
) -> EditFailure {
    EditFailure {
        edit_index: u32::try_from(index).unwrap_or(u32::MAX),
        path: path.to_owned(),
        kind,
        message: message.into(),
        hunk: None,
        closest: None,
        candidate_lines: Vec::new(),
    }
}

/// Expands edits into per-file operations. Unparseable diffs become failures.
fn expand(edits: &[Edit], failures: &mut Vec<EditFailure>) -> Vec<Op> {
    let mut ops = Vec::new();
    for (i, edit) in edits.iter().enumerate() {
        let index = u32::try_from(i).unwrap_or(u32::MAX);
        let mut push = |requested: &str, kind: OpKind| {
            ops.push(Op {
                index,
                requested: requested.to_owned(),
                kind,
                lexical: None,
                resolved: None,
            });
        };
        match edit {
            Edit::Replace {
                path,
                old,
                new,
                replace_all,
            } => {
                push(
                    path,
                    OpKind::Replace {
                        old: old.clone(),
                        new: new.clone(),
                        all: *replace_all,
                    },
                );
            }
            Edit::Create {
                path,
                content,
                overwrite,
            } => {
                push(
                    path,
                    OpKind::Create {
                        content: content.clone(),
                        overwrite: *overwrite,
                    },
                );
            }
            Edit::Delete { path } => push(path, OpKind::Delete),
            Edit::Diff { path, diff: text } => match diff::parse(text) {
                Err(message) => failures.push(edit_failure(
                    i,
                    path.as_deref().unwrap_or(""),
                    FailureKind::InvalidDiff,
                    message,
                )),
                Ok(patches) => expand_diff(i, path.as_deref(), patches, &mut push, failures),
            },
        }
    }
    ops
}

fn expand_diff(
    i: usize,
    explicit: Option<&str>,
    patches: Vec<diff::FilePatch>,
    push: &mut impl FnMut(&str, OpKind),
    failures: &mut Vec<EditFailure>,
) {
    if let Some(path) = explicit {
        let mut it = patches.into_iter();
        match (it.next(), it.next()) {
            (Some(p), None) => {
                let kind = if p.has_headers {
                    p.target().map_or(PatchKind::Modify, |(_, k)| k)
                } else {
                    PatchKind::Modify
                };
                push(
                    path,
                    OpKind::Patch {
                        hunks: p.hunks,
                        kind,
                    },
                );
            }
            _ => failures.push(edit_failure(
                i,
                path,
                FailureKind::InvalidDiff,
                "`path` is set, so the diff must describe exactly one file",
            )),
        }
        return;
    }
    for p in patches {
        if !p.has_headers {
            failures.push(edit_failure(
                i,
                "",
                FailureKind::InvalidDiff,
                "the diff has no `---`/`+++` headers; set `path`",
            ));
            continue;
        }
        match p.target() {
            Ok((path, kind)) => push(
                &path,
                OpKind::Patch {
                    hunks: p.hunks,
                    kind,
                },
            ),
            Err(message) => {
                let name = p
                    .new_path
                    .as_deref()
                    .or(p.old_path.as_deref())
                    .unwrap_or("");
                failures.push(edit_failure(i, name, FailureKind::Unsupported, message));
            }
        }
    }
}

fn path_failure(op: &Op, e: &PathError) -> EditFailure {
    let kind = match e {
        PathError::Io { .. } => FailureKind::Unreadable,
        _ => FailureKind::PathUnsafe,
    };
    failure(op, Failure::new(kind, e.to_string()))
}

fn load(
    root: &Dir,
    r: &Resolved,
    limits: &Limits,
    total: &mut u64,
) -> std::result::Result<(Original, Content), Failure> {
    let path = r.to_path();
    match r.kind {
        None => Ok((Original::Absent, Content::Absent)),
        Some(Kind::File) => {
            let (bytes, meta) =
                fsops::read_file(root, &path, limits.max_file_bytes).map_err(|e| {
                    let kind = if e.kind() == std::io::ErrorKind::InvalidData {
                        FailureKind::TooLarge
                    } else {
                        FailureKind::Unreadable
                    };
                    Failure::new(kind, e.to_string())
                })?;
            *total += bytes.len() as u64;
            if *total > limits.max_total_bytes {
                return Err(Failure::new(
                    FailureKind::TooLarge,
                    "the transaction touches too many bytes",
                ));
            }
            Ok((Original::File { bytes, meta }, Content::Original))
        }
        Some(Kind::Symlink) => {
            let target = fsops::read_link(root, &path)
                .map_err(|e| Failure::new(FailureKind::Unreadable, e.to_string()))?;
            Ok((
                Original::Symlink {
                    target: target.to_string_lossy().into_owned(),
                },
                Content::Original,
            ))
        }
        Some(Kind::Dir) => Err(Failure::new(
            FailureKind::IsDirectory,
            "the path is a directory",
        )),
        Some(Kind::Other) => Err(Failure::new(
            FailureKind::NotRegular,
            "the path is not a regular file",
        )),
    }
}

fn text_of(vf: &VFile) -> std::result::Result<&str, Failure> {
    match vf.current() {
        None => Err(Failure::new(
            FailureKind::NotFound,
            "the file does not exist; use `create` to make it",
        )),
        Some(b) => std::str::from_utf8(b).map_err(|_| {
            Failure::new(
                FailureKind::NotUtf8,
                "the file is not valid UTF-8, so it cannot take a text edit",
            )
        }),
    }
}

fn apply_op(vf: &mut VFile, kind: &OpKind, limits: &Limits) -> std::result::Result<(), Failure> {
    let new_content = match kind {
        OpKind::Replace { old, new, all } => {
            Content::New(replace::replace(text_of(vf)?, old, new, *all, limits)?.into_bytes())
        }
        OpKind::Create { content, overwrite } => {
            if vf.current().is_some() && !overwrite {
                return Err(Failure::new(
                    FailureKind::AlreadyExists,
                    "the file already exists; set `overwrite` to replace it",
                ));
            }
            Content::New(content.clone().into_bytes())
        }
        OpKind::Delete => {
            if vf.current().is_none() && !matches!(vf.original, Original::Symlink { .. }) {
                return Err(Failure::new(
                    FailureKind::NotFound,
                    "the file does not exist",
                ));
            }
            Content::Absent
        }
        OpKind::Patch {
            hunks,
            kind: PatchKind::Modify,
        } => Content::New(diff::apply(text_of(vf)?, hunks, limits)?.into_bytes()),
        OpKind::Patch {
            hunks,
            kind: PatchKind::Create,
        } => {
            if vf.current().is_some() {
                return Err(Failure::new(
                    FailureKind::AlreadyExists,
                    "the diff creates a file that already exists",
                ));
            }
            Content::New(diff::created_content(hunks).into_bytes())
        }
        OpKind::Patch {
            hunks,
            kind: PatchKind::Delete,
        } => {
            if !hunks.is_empty() && !diff::apply(text_of(vf)?, hunks, limits)?.is_empty() {
                return Err(Failure::new(
                    FailureKind::NoMatch,
                    "the diff deletes a file but does not remove all of its content",
                ));
            }
            text_of(vf)?;
            Content::Absent
        }
    };
    if let Content::New(b) = &new_content
        && b.len() as u64 > limits.max_file_bytes
    {
        return Err(Failure::new(
            FailureKind::TooLarge,
            "the result exceeds the file size limit",
        ));
    }
    vf.content = new_content;
    Ok(())
}

fn outcome(vf: &VFile) -> Outcome {
    match &vf.content {
        Content::Original => Outcome::Unchanged,
        Content::Absent => match vf.original {
            Original::Absent => Outcome::Unchanged,
            _ => Outcome::Delete,
        },
        Content::New(b) => match &vf.original {
            Original::File { bytes, .. } if bytes == b => Outcome::Unchanged,
            _ => Outcome::Write(b.clone()),
        },
    }
}

/// Inputs to [`build`].
pub struct PlanInput<'a> {
    /// The workspace.
    pub root: &'a Dir,
    /// The edits, in order.
    pub edits: &'a [Edit],
    /// Compiled scope and protected globs.
    pub scope: &'a Scope,
    /// Size and count limits.
    pub limits: &'a Limits,
    /// Cancellation, polled between edits.
    pub cancel: &'a CancellationToken,
}

/// Parses and resolves every operation's path. Failures are collected, not returned.
fn resolve_ops(
    root: &Dir,
    ops: &mut [Op],
    cancel: &CancellationToken,
    failures: &mut Vec<EditFailure>,
) -> Result<()> {
    for op in ops {
        check_cancel(cancel)?;
        let follow = !matches!(
            op.kind,
            OpKind::Delete
                | OpKind::Patch {
                    kind: PatchKind::Delete,
                    ..
                }
        );
        match RelPath::parse_for_write(&op.requested).and_then(|rel| {
            let resolved = paths::resolve(root, &rel, follow)?;
            resolved.check_for_write()?;
            Ok((rel, resolved))
        }) {
            Ok((rel, r)) => {
                op.lexical = Some(rel);
                op.resolved = Some(r);
            }
            Err(e) => failures.push(path_failure(op, &e)),
        }
    }
    Ok(())
}

/// Reads each touched file once and applies the operations to the in-memory copies, in order.
fn apply_ops(
    ops: &[Op],
    input: &PlanInput<'_>,
    failures: &mut Vec<EditFailure>,
) -> Result<BTreeMap<String, VFile>> {
    let PlanInput {
        root,
        limits,
        cancel,
        ..
    } = *input;
    let mut files: BTreeMap<String, VFile> = BTreeMap::new();
    let mut total = 0u64;
    for op in ops {
        check_cancel(cancel)?;
        let Some(r) = &op.resolved else { continue };
        let key = r.to_wire();
        if !files.contains_key(&key) {
            match load(root, r, limits, &mut total) {
                Ok((original, content)) => {
                    files.insert(
                        key.clone(),
                        VFile {
                            original,
                            content,
                            missing_dirs: r.missing_dirs(),
                        },
                    );
                }
                Err(f) => {
                    failures.push(failure(op, f));
                    continue;
                }
            }
        }
        if let Some(vf) = files.get_mut(&key)
            && let Err(f) = apply_op(vf, &op.kind, limits)
        {
            failures.push(failure(op, f));
        }
    }
    Ok(files)
}

/// Plans a transaction without writing anything.
///
/// # Errors
/// - [`Error::ProtectedPath`] / [`Error::ScopeViolation`] before any content is read;
/// - [`Error::AbortedBeforeWrite`] listing every failed edit;
/// - [`Error::LimitExceeded`], [`Error::Cancelled`].
pub fn build(input: &PlanInput<'_>) -> Result<Plan> {
    let PlanInput {
        root,
        edits,
        scope,
        limits,
        cancel,
    } = *input;
    if edits.len() > limits.max_edits {
        return Err(Error::LimitExceeded(format!(
            "{} edits exceed the limit of {}",
            edits.len(),
            limits.max_edits
        )));
    }
    let mut failures: Vec<EditFailure> = Vec::new();
    let mut ops = expand(edits, &mut failures);

    resolve_ops(root, &mut ops, cancel, &mut failures)?;

    let spelled: Vec<(String, String)> = ops
        .iter()
        .filter_map(|o| {
            Some((
                o.lexical.as_ref()?.to_wire(),
                o.resolved.as_ref()?.to_wire(),
            ))
        })
        .collect();
    scope.check(spelled.iter().map(|(a, b)| (a.as_str(), b.as_str())))?;

    let files = apply_ops(&ops, input, &mut failures)?;

    if !failures.is_empty() {
        failures.sort_by_key(|f| f.edit_index);
        return Err(Error::AbortedBeforeWrite { failures });
    }

    let mut created: BTreeSet<(usize, String)> = BTreeSet::new();
    let mut out = Vec::with_capacity(files.len());
    for (path, vf) in files {
        let outcome = outcome(&vf);
        if matches!(outcome, Outcome::Write(_)) && matches!(vf.original, Original::Absent) {
            created.extend(
                vf.missing_dirs
                    .iter()
                    .map(|d| (Path::new(d).components().count(), d.clone())),
            );
        }
        out.push(PlannedFile {
            path,
            original: vf.original,
            outcome,
        });
    }
    Ok(Plan {
        files: out,
        created_dirs: created.into_iter().map(|(_, d)| d).collect(),
    })
}

fn check_cancel(cancel: &CancellationToken) -> Result<()> {
    if cancel.is_cancelled() {
        Err(Error::Cancelled)
    } else {
        Ok(())
    }
}
