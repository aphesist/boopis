//! The file walk: gitignore-aware, parallel, narrowed by globs.
//!
//! The walk only lists names. File contents are read later through the root's
//! capability handle. Symlinks are never followed, so a link cannot lead the
//! walk outside the root. Globs narrow the work in two ways: they choose the
//! directories the walk starts from, and they filter names before any file is
//! opened.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};

use crate::cache::Snapshot;
use crate::error::{Error, Result};
use crate::never_pack::NeverPack;
use crate::root::Root;
use crate::types::{Control, WalkOptions, Withheld, WithheldFile};
use hx_txn::paths::RelPath;

/// Which files to list. `starts` holds canonical relative paths; the empty string is the root.
pub(crate) struct WalkSpec<'a> {
    /// Gitignore-style globs; empty means everything. A leading `!` excludes.
    pub globs: &'a [String],
    /// Directories or files to start from; empty means the root.
    pub starts: &'a [String],
    /// Extra name filter on the relative path, applied before globs.
    pub name_filter: Option<&'a (dyn Fn(&str) -> bool + Sync)>,
    /// Skip list and size cap.
    pub opts: &'a WalkOptions,
}

/// A list of file paths, owned or shared with the walk cache.
#[derive(Debug)]
pub(crate) enum Files {
    Own(Vec<String>),
    Shared(Arc<Snapshot>),
}

impl Default for Files {
    fn default() -> Self {
        Self::Own(Vec::new())
    }
}

impl Files {
    pub(crate) fn as_slice(&self) -> &[String] {
        match self {
            Self::Own(v) => v,
            Self::Shared(s) => &s.files,
        }
    }

    pub(crate) fn into_vec(self) -> Vec<String> {
        match self {
            Self::Own(v) => v,
            Self::Shared(s) => s.files.clone(),
        }
    }
}

/// The files a walk found, sorted by path, and the ones it withheld.
#[derive(Debug, Default)]
pub(crate) struct Walked {
    pub files: Files,
    pub withheld: Withheld,
}

/// A compiled glob list.
pub(crate) struct GlobFilter {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
    /// Directories the includes are confined to; empty means the whole root.
    prefixes: Vec<String>,
}

/// A glob is a pattern, but it must not name a path outside the root. Wildcards are replaced
/// by a letter and the result goes through the shared path parser.
fn check_glob_path(body: &str) -> Result<()> {
    let probe = body.replace(['*', '?', '[', ']', '{', '}'], "x");
    match RelPath::parse(&probe) {
        Ok(_) | Err(hx_txn::paths::PathError::Empty) => Ok(()),
        Err(_) => Err(Error::PathEscape(body.escape_debug().to_string())),
    }
}

fn has_meta(s: &str) -> bool {
    s.contains(['*', '?', '[', '{'])
}

fn glob(pat: &str) -> Result<globset::Glob> {
    GlobBuilder::new(pat)
        .literal_separator(true)
        .build()
        .map_err(|e| Error::InvalidRequest(format!("bad glob {pat:?}: {e}")))
}

impl GlobFilter {
    pub(crate) fn new(globs: &[String]) -> Result<Self> {
        let mut inc = GlobSetBuilder::new();
        let mut exc = GlobSetBuilder::new();
        let (mut n_inc, mut n_exc) = (0, 0);
        let mut prefixes: Vec<String> = Vec::new();
        let mut unanchored = false;
        for raw in globs {
            let (negated, body) = raw
                .strip_prefix('!')
                .map_or((false, raw.as_str()), |b| (true, b));
            let body = body.strip_prefix("./").unwrap_or(body);
            if body.is_empty() {
                return Err(Error::InvalidRequest("empty glob".into()));
            }
            // Globs are patterns, but they must not name paths outside the root.
            check_glob_path(body)?;
            let body = body.trim_end_matches('/');
            let literal = !has_meta(body);
            let mut pats = Vec::new();
            if body.contains('/') {
                pats.push(body.to_owned());
            } else {
                pats.push(format!("**/{body}"));
            }
            if literal {
                let last = pats.last().cloned().unwrap_or_default();
                pats.push(format!("{last}/**"));
            }
            for p in pats {
                if negated {
                    exc.add(glob(&p)?);
                    n_exc += 1;
                } else {
                    inc.add(glob(&p)?);
                    n_inc += 1;
                }
            }
            if !negated {
                match literal_prefix(body) {
                    Some(p) if !p.is_empty() => prefixes.push(p),
                    _ => unanchored = true,
                }
            }
        }
        let build = |b: GlobSetBuilder| {
            b.build()
                .map_err(|e| Error::InvalidRequest(format!("bad glob set: {e}")))
        };
        // Without a positive glob every file passes; only excludes narrow it.
        if n_inc == 0 {
            unanchored = true;
        }
        if unanchored {
            prefixes.clear();
        }
        prefixes.sort();
        prefixes.dedup();
        Ok(Self {
            include: if n_inc > 0 { Some(build(inc)?) } else { None },
            exclude: if n_exc > 0 { Some(build(exc)?) } else { None },
            prefixes,
        })
    }

    pub(crate) fn matches(&self, rel: &str) -> bool {
        self.include.as_ref().is_none_or(|s| s.is_match(rel))
            && !self.exclude.as_ref().is_some_and(|s| s.is_match(rel))
    }

    /// True when there are no globs at all.
    pub(crate) fn is_empty(&self) -> bool {
        self.include.is_none() && self.exclude.is_none()
    }

    pub(crate) fn prefixes(&self) -> &[String] {
        &self.prefixes
    }
}

/// The directory part of `glob` before its first wildcard segment, for globs
/// anchored with a `/`. A glob without `/` matches at any depth, so it has no
/// prefix and the walk must start at the root. A literal path is its own prefix.
fn literal_prefix(glob: &str) -> Option<String> {
    if !glob.contains('/') {
        return None;
    }
    let parts: Vec<&str> = glob.split('/').take_while(|seg| !has_meta(seg)).collect();
    Some(parts.join("/"))
}

/// Lists the files `spec` selects.
///
/// A walk of the whole root can be served from the control's [`WalkCache`].
///
/// # Errors
/// Path errors for starts that escape the root, request errors for bad globs,
/// and cancellation.
pub(crate) fn collect(root: &Root, spec: &WalkSpec<'_>, ctl: &Control) -> Result<Walked> {
    let filter = GlobFilter::new(spec.globs)?;
    let starts = resolve_starts(root, spec.starts, &filter)?;
    let whole_root = starts.len() == 1 && starts[0].is_empty();
    let skip = spec.opts.skip_dirs();
    if whole_root && let Some(cache) = ctl.cache() {
        let snap = if let Some(hit) = cache.get(root, &skip) {
            hit
        } else {
            let started = SystemTime::now();
            let snap = Arc::new(walk_dirs(root, &starts, &skip, None, ctl, true)?);
            cache.put(root, &skip, &snap, started);
            snap
        };
        return Ok(filter_snapshot(snap, &filter, spec.name_filter));
    }
    let raw = walk_dirs(
        root,
        &starts,
        &skip,
        Some(Filters {
            globs: &filter,
            name: spec.name_filter,
        }),
        ctl,
        false,
    )?;
    Ok(Walked {
        files: Files::Own(raw.files),
        withheld: withheld_of(raw.withheld),
    })
}

fn withheld_of(all: Vec<WithheldFile>) -> Withheld {
    let mut w = Withheld::default();
    for f in all {
        w.push(f);
    }
    w
}

/// Applies the glob and name filters to a cached list. With no filters the cached list is
/// shared, not copied.
fn filter_snapshot(
    snap: Arc<Snapshot>,
    globs: &GlobFilter,
    name: Option<&(dyn Fn(&str) -> bool + Sync)>,
) -> Walked {
    let keep = |p: &str| name.is_none_or(|f| f(p)) && globs.matches(p);
    if name.is_none() && globs.is_empty() {
        let withheld = withheld_of(snap.withheld.clone());
        return Walked {
            files: Files::Shared(snap),
            withheld,
        };
    }
    let files = snap.files.iter().filter(|p| keep(p)).cloned().collect();
    let withheld = withheld_of(
        snap.withheld
            .iter()
            .filter(|w| keep(&w.path))
            .cloned()
            .collect(),
    );
    Walked {
        files: Files::Own(files),
        withheld,
    }
}

/// The filters a walk applies while it lists, so non-matching names are never kept.
#[derive(Clone, Copy)]
struct Filters<'a> {
    globs: &'a GlobFilter,
    name: Option<&'a (dyn Fn(&str) -> bool + Sync)>,
}

/// Walks `starts` in parallel. With `record`, also notes the modification time of every
/// directory and ignore file seen, which is what the cache validates against.
fn walk_dirs(
    root: &Root,
    starts: &[String],
    skip: &[String],
    filters: Option<Filters<'_>>,
    ctl: &Control,
    record: bool,
) -> Result<Snapshot> {
    let never = NeverPack::embedded()?;
    let Some((first, rest)) = starts.split_first() else {
        return Ok(Snapshot::default());
    };
    let skip: HashSet<String> = skip.iter().cloned().collect();
    let mut builder = WalkBuilder::new(root.abs(first));
    for s in rest {
        builder.add(root.abs(s));
    }
    builder
        .hidden(false)
        .git_global(false)
        .require_git(false)
        .follow_links(false)
        .threads(crate::scan::worker_count())
        .filter_entry(move |e| {
            e.depth() == 0
                || !e.file_type().is_some_and(|t| t.is_dir())
                || e.file_name().to_str().is_none_or(|n| !skip.contains(n))
        });
    let shared: Mutex<Vec<Local>> = Mutex::new(Vec::new());
    let failed: Mutex<Option<Error>> = Mutex::new(None);
    let stop = AtomicBool::new(false);
    builder.build_parallel().run(|| {
        let mut v = Visitor {
            root,
            never,
            filters,
            record,
            ctl,
            shared: &shared,
            failed: &failed,
            stop: &stop,
            local: Local::default(),
            tick: 0,
        };
        Box::new(move |entry| v.visit(entry))
    });
    if let Some(e) = failed
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        return Err(e);
    }
    let mut out = Snapshot::default();
    for local in shared
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        out.files.extend(local.files);
        out.withheld.extend(local.withheld);
        out.stamps.extend(local.stamps);
    }
    out.files.sort_unstable();
    out.files.dedup();
    out.withheld.sort_by(|a, b| a.path.cmp(&b.path));
    if record {
        // Not walked (`.git` is skipped) but it holds ignore rules.
        out.stamps.push((
            ".git/info/exclude".to_owned(),
            root.modified(".git/info/exclude"),
        ));
        out.stamps.sort();
    }
    Ok(out)
}

/// Turns the request's starts and the globs' prefixes into the directories to walk.
fn resolve_starts(root: &Root, starts: &[String], filter: &GlobFilter) -> Result<Vec<String>> {
    let mut wanted: Vec<String> = starts.to_vec();
    for p in filter.prefixes() {
        // A prefix that names nothing matches nothing; one that escapes is an error.
        if let Some(t) = root.target_if_exists(p)? {
            wanted.push(t.rel);
        }
    }
    if starts.is_empty() && filter.prefixes().is_empty() || wanted.iter().any(String::is_empty) {
        return Ok(vec![String::new()]);
    }
    wanted.sort();
    wanted.dedup();
    let mut kept: Vec<String> = Vec::new();
    for w in wanted {
        let covered = kept.iter().any(|k| w.starts_with(&format!("{k}/")));
        if !covered {
            kept.push(w);
        }
    }
    Ok(kept)
}

#[derive(Default)]
struct Local {
    files: Vec<String>,
    withheld: Vec<WithheldFile>,
    stamps: Vec<(String, Option<SystemTime>)>,
}

/// File names whose content changes what a walk lists.
const IGNORE_FILES: &[&str] = &[".gitignore", ".ignore", ".rgignore"];

struct Visitor<'a> {
    root: &'a Root,
    never: &'a NeverPack,
    filters: Option<Filters<'a>>,
    record: bool,
    ctl: &'a Control,
    shared: &'a Mutex<Vec<Local>>,
    failed: &'a Mutex<Option<Error>>,
    stop: &'a AtomicBool,
    local: Local,
    tick: u32,
}

impl Visitor<'_> {
    fn visit(&mut self, entry: std::result::Result<ignore::DirEntry, ignore::Error>) -> WalkState {
        self.tick = self.tick.wrapping_add(1);
        if self.stop.load(Ordering::Relaxed) {
            return WalkState::Quit;
        }
        if self.tick.is_multiple_of(256)
            && let Err(e) = self.ctl.check()
        {
            if let Ok(mut slot) = self.failed.lock() {
                slot.get_or_insert(e);
            }
            self.stop.store(true, Ordering::Relaxed);
            return WalkState::Quit;
        }
        let Ok(entry) = entry else {
            return WalkState::Continue;
        };
        let Some(file_type) = entry.file_type() else {
            return WalkState::Continue;
        };
        let Ok(rel) = entry.path().strip_prefix(self.root.path()) else {
            return WalkState::Continue;
        };
        let Some(rel) = rel.to_str() else {
            return WalkState::Continue; // names that are not UTF-8 cannot be reported
        };
        if self.record
            && (file_type.is_dir()
                || file_type.is_file()
                    && entry
                        .file_name()
                        .to_str()
                        .is_some_and(|n| IGNORE_FILES.contains(&n)))
        {
            let mtime = entry.metadata().ok().and_then(|m| m.modified().ok());
            self.local.stamps.push((rel.to_owned(), mtime));
        }
        if !file_type.is_file() {
            return WalkState::Continue;
        }
        if let Some(f) = self.filters
            && (f.name.is_some_and(|n| !n(rel)) || !f.globs.matches(rel))
        {
            return WalkState::Continue;
        }
        // The walk lists names the file system returned, so they hold no `..`; every open
        // still goes through the root's capability handle.
        if let Some(reason) = self.never.check(rel) {
            self.local.withheld.push(WithheldFile {
                path: rel.to_owned(),
                reason: reason.to_owned(),
            });
        } else {
            self.local.files.push(rel.to_owned());
        }
        WalkState::Continue
    }
}

impl Drop for Visitor<'_> {
    fn drop(&mut self) {
        let local = std::mem::take(&mut self.local);
        if let Ok(mut shared) = self.shared.lock() {
            shared.push(local);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(globs: &[&str]) -> GlobFilter {
        let owned: Vec<String> = globs.iter().map(|s| (*s).to_owned()).collect();
        GlobFilter::new(&owned).unwrap()
    }

    #[test]
    fn unanchored_globs_match_at_any_depth_anchored_ones_do_not() {
        let f = filter(&["*.rs"]);
        assert!(f.matches("a.rs") && f.matches("x/y/a.rs") && !f.matches("a.ts"));
        assert!(f.prefixes().is_empty());
        let f = filter(&["src/*.rs"]);
        assert!(f.matches("src/a.rs") && !f.matches("src/x/a.rs") && !f.matches("a.rs"));
        assert_eq!(f.prefixes(), ["src"]);
        let f = filter(&["src/**/test_*.py"]);
        assert!(f.matches("src/a/b/test_x.py") && !f.matches("lib/test_x.py"));
    }

    #[test]
    fn literal_names_match_files_and_directories() {
        let f = filter(&["Cargo.toml"]);
        assert!(f.matches("Cargo.toml") && f.matches("crates/x/Cargo.toml"));
        let f = filter(&["docs"]);
        assert!(f.matches("docs/a.md") && f.matches("x/docs/a.md") && !f.matches("docs.md"));
        let f = filter(&["docs/"]);
        assert!(f.matches("docs/a.md"));
    }

    #[test]
    fn excludes_narrow_and_alone_they_select_everything_else() {
        let f = filter(&["!target"]);
        assert!(f.matches("src/a.rs") && !f.matches("target/debug/x"));
        let f = filter(&["*.rs", "!gen/**"]);
        assert!(f.matches("a.rs") && !f.matches("gen/a.rs"));
        assert!(f.prefixes().is_empty());
        assert!(filter(&[]).matches("anything"));
    }

    #[test]
    fn nested_prefixes_collapse_and_mixed_globs_walk_the_root() {
        let f = filter(&["a/b/*.rs", "a/c/*.rs", "a/b/x/*.rs"]);
        assert_eq!(f.prefixes(), ["a/b", "a/b/x", "a/c"]);
        let f = filter(&["a/b/*.rs", "*.md"]);
        assert!(f.prefixes().is_empty());
    }

    #[test]
    fn bad_globs_are_request_errors() {
        for bad in ["", "[", "a/**{"] {
            let owned = vec![bad.to_owned()];
            let e = GlobFilter::new(&owned).err().unwrap();
            assert_eq!(e.code(), "hx.pack.invalid_request", "{bad:?}");
        }
        let owned = vec!["../x".to_owned()];
        assert_eq!(
            GlobFilter::new(&owned).err().unwrap().code(),
            "hx.pack.path_escape"
        );
    }
}
