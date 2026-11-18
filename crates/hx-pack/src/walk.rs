//! The file walk: gitignore-aware, parallel, narrowed by globs.
//!
//! The walk only lists names. File contents are read later through the root's
//! capability handle. Symlinks are never followed, so a link cannot lead the
//! walk outside the root. Globs narrow the work in two ways: they choose the
//! directories the walk starts from, and they filter names before any file is
//! opened.

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use ignore::{WalkBuilder, WalkState};

use crate::error::{Error, Result};
use crate::never_pack::NeverPack;
use crate::paths::{RelPath, Root};
use crate::types::{Control, WalkOptions, Withheld, WithheldFile};

/// Which files to list.
pub(crate) struct WalkSpec<'a> {
    /// Gitignore-style globs; empty means everything. A leading `!` excludes.
    pub globs: &'a [String],
    /// Directories or files to start from; empty means the root.
    pub starts: &'a [RelPath],
    /// Extra name filter on the relative path, applied before globs.
    pub name_filter: Option<&'a (dyn Fn(&str) -> bool + Sync)>,
    /// Skip list and size cap.
    pub opts: &'a WalkOptions,
}

/// The files a walk found, sorted by path, and the ones it withheld.
#[derive(Debug, Default)]
pub(crate) struct Walked {
    pub files: Vec<RelPath>,
    pub withheld: Withheld,
}

/// A compiled glob list.
pub(crate) struct GlobFilter {
    include: Option<GlobSet>,
    exclude: Option<GlobSet>,
    /// Directories the includes are confined to; empty means the whole root.
    prefixes: Vec<String>,
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
            RelPath::parse(&body.replace(['*', '?', '[', ']', '{', '}'], "x"))?;
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
/// # Errors
/// Path errors for starts that escape the root, request errors for bad globs,
/// and cancellation.
pub(crate) fn collect(root: &Root, spec: &WalkSpec<'_>, ctl: &Control) -> Result<Walked> {
    let never = NeverPack::embedded()?;
    let filter = GlobFilter::new(spec.globs)?;
    let starts = resolve_starts(root, spec.starts, &filter)?;
    let Some((first, rest)) = starts.split_first() else {
        return Ok(Walked::default());
    };
    let skip: HashSet<String> = spec.opts.skip_dirs().into_iter().collect();
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
            filter: &filter,
            name_filter: spec.name_filter,
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
    let mut out = Walked::default();
    for local in shared
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        out.files.extend(local.files);
        out.withheld.merge(local.withheld);
    }
    out.files.sort_unstable();
    out.files.dedup();
    Ok(out)
}

/// Turns the request's starts and the globs' prefixes into the directories to walk.
fn resolve_starts(root: &Root, starts: &[RelPath], filter: &GlobFilter) -> Result<Vec<RelPath>> {
    let mut wanted: Vec<RelPath> = starts.to_vec();
    for p in filter.prefixes() {
        wanted.push(RelPath::parse(p)?);
    }
    if wanted.is_empty() || wanted.iter().any(RelPath::is_root) {
        return Ok(vec![RelPath::root()]);
    }
    wanted.sort();
    wanted.dedup();
    let mut kept: Vec<RelPath> = Vec::new();
    for w in wanted {
        let exists = match (root.is_dir(&w), root.is_file(&w)) {
            (Ok(true), _) | (_, Ok(true)) => true,
            (Err(e @ Error::PathEscape(_)), _) | (_, Err(e @ Error::PathEscape(_))) => {
                return Err(e);
            }
            _ => false,
        };
        let covered = kept
            .iter()
            .any(|k| w.as_str().starts_with(&format!("{}/", k.as_str())));
        if exists && !covered {
            kept.push(w);
        }
    }
    Ok(kept)
}

#[derive(Default)]
struct Local {
    files: Vec<RelPath>,
    withheld: Withheld,
}

struct Visitor<'a> {
    root: &'a Root,
    never: &'a NeverPack,
    filter: &'a GlobFilter,
    name_filter: Option<&'a (dyn Fn(&str) -> bool + Sync)>,
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
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            return WalkState::Continue;
        }
        let Ok(rel) = entry.path().strip_prefix(self.root.path()) else {
            return WalkState::Continue;
        };
        let Some(rel) = rel.to_str() else {
            return WalkState::Continue; // names that are not UTF-8 cannot be reported
        };
        if self.name_filter.is_some_and(|f| !f(rel)) || !self.filter.matches(rel) {
            return WalkState::Continue;
        }
        let Ok(rel) = RelPath::parse(rel) else {
            return WalkState::Continue;
        };
        if let Some(reason) = self.never.check(&rel) {
            self.local.withheld.push(WithheldFile {
                path: rel.to_string(),
                reason: reason.to_owned(),
            });
        } else {
            self.local.files.push(rel);
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
