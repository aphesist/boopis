//! Scope and protected-path checks, run before anything is journaled.
//!
//! Globs use literal-separator semantics: `*` does not cross `/`, `**` does. A path is checked
//! twice, as the caller spelled it and as it resolves after symlinks, so a harmless-looking
//! symlink cannot reach a protected file. Protected patterns match case-insensitively so
//! `.ENV` on a case-insensitive file system does not slip through.

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};
use serde::Deserialize;

use crate::error::{Error, Result};

/// The shipped defaults for `protected`, a data file shared with other languages.
pub const DEFAULT_PROTECTED_JSON: &str = include_str!("../protected.default.json");

#[derive(Deserialize)]
struct DefaultsFile {
    patterns: Vec<String>,
}

/// The default protected patterns.
///
/// # Errors
/// Only if the embedded file is malformed, which a test rules out; callers then fail closed.
pub fn default_protected() -> Result<Vec<String>> {
    serde_json::from_str::<DefaultsFile>(DEFAULT_PROTECTED_JSON)
        .map(|f| f.patterns)
        .map_err(|e| Error::InvalidGlob {
            pattern: "protected.default.json".to_owned(),
            reason: e.to_string(),
        })
}

fn build_glob(pattern: &str, case_insensitive: bool) -> Result<Glob> {
    GlobBuilder::new(pattern)
        .literal_separator(true)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|e| Error::InvalidGlob {
            pattern: pattern.to_owned(),
            reason: e.kind().to_string(),
        })
}

fn build_set(patterns: &[String], case_insensitive: bool) -> Result<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        builder.add(build_glob(p, case_insensitive)?);
    }
    builder.build().map_err(|e| Error::InvalidGlob {
        pattern: patterns.join(", "),
        reason: e.to_string(),
    })
}

/// Compiled `allowed` and `protected` globs.
#[derive(Debug)]
pub struct Scope {
    allowed: Option<GlobSet>,
    protected: GlobSet,
}

impl Scope {
    /// Compiles the lists. `protected: None` means the shipped defaults; `Some(&[])` means none.
    /// `allowed: None` means no scope restriction; `Some(&[])` allows nothing.
    ///
    /// # Errors
    /// A glob does not parse.
    pub fn new(allowed: Option<&[String]>, protected: Option<&[String]>) -> Result<Self> {
        let defaults = if protected.is_none() {
            default_protected()?
        } else {
            Vec::new()
        };
        let protected_patterns = protected.unwrap_or(&defaults);
        Ok(Self {
            allowed: allowed.map(|a| build_set(a, false)).transpose()?,
            protected: build_set(protected_patterns, true)?,
        })
    }

    /// Checks one touched path. `requested` is the spelling from the request, `real` the path
    /// after resolving symlinks (both `/`-separated). Both must pass.
    #[must_use]
    pub fn verdict(&self, requested: &str, real: &str) -> Verdict {
        if self.protected.is_match(requested) || self.protected.is_match(real) {
            return Verdict::Protected;
        }
        if let Some(allowed) = &self.allowed
            && (!allowed.is_match(requested) || !allowed.is_match(real))
        {
            return Verdict::OutOfScope;
        }
        Verdict::Ok
    }

    /// Checks many paths and returns the error for the first category that has violations.
    /// Protected wins over scope.
    ///
    /// # Errors
    /// [`Error::ProtectedPath`] or [`Error::ScopeViolation`] listing every offending path.
    pub fn check<'a>(&self, paths: impl IntoIterator<Item = (&'a str, &'a str)>) -> Result<()> {
        let mut protected = Vec::new();
        let mut out_of_scope = Vec::new();
        for (requested, real) in paths {
            match self.verdict(requested, real) {
                Verdict::Ok => {}
                Verdict::Protected => protected.push(requested.to_owned()),
                Verdict::OutOfScope => out_of_scope.push(requested.to_owned()),
            }
        }
        protected.dedup();
        out_of_scope.dedup();
        if !protected.is_empty() {
            return Err(Error::ProtectedPath { paths: protected });
        }
        if !out_of_scope.is_empty() {
            return Err(Error::ScopeViolation {
                paths: out_of_scope,
            });
        }
        Ok(())
    }
}

/// The outcome for one path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The path may be touched.
    Ok,
    /// The path matches a protected pattern.
    Protected,
    /// The path is outside `allowed`.
    OutOfScope,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Scope {
        Scope::new(None, None).unwrap()
    }

    #[test]
    fn the_defaults_file_parses_and_has_the_explicit_forms() {
        let p = default_protected().unwrap();
        for want in [
            "tests/**",
            "**/test_*.py",
            "**/*_test.go",
            "**/*.spec.*",
            "**/__tests__/**",
            "**/*.pem",
            "**/id_rsa*",
        ] {
            assert!(p.iter().any(|x| x == want), "{want}");
        }
        assert!(
            !p.iter().any(|x| x.contains("*test*")),
            "no substring patterns"
        );
    }

    #[test]
    fn explicit_forms_protect_what_they_name() {
        let s = defaults();
        for path in [
            "tests/a/b.rs",
            "tests/x",
            "src/test_util.py",
            "test_x.py",
            "pkg/db_test.go",
            "web/app.spec.ts",
            "web/__tests__/a.js",
            ".git/config",
            "sub/.git/HEAD",
            ".env",
            ".env.local",
            "apps/web/.env.production",
            "certs/server.pem",
            "home/id_rsa",
            "home/id_rsa.pub",
        ] {
            assert_eq!(s.verdict(path, path), Verdict::Protected, "{path}");
        }
    }

    #[test]
    fn the_legacy_substring_false_positives_are_not_protected() {
        let s = defaults();
        // The audit's probed false positives, plus look-alikes.
        for path in [
            "src/latest.rs",
            "src/inspector.rs",
            "docs/contest.md",
            "src/aspect.rs",
            "src/protest.py",
            "src/contests/mod.rs",
            "src/testing_notes.md",
            "src/attest.rs",
            "specs/design.md",
            "src/lib.rs",
        ] {
            assert_eq!(s.verdict(path, path), Verdict::Ok, "{path}");
        }
    }

    #[test]
    fn star_does_not_cross_separators() {
        let s = Scope::new(Some(&["src/*.rs".to_owned()]), Some(&[])).unwrap();
        assert_eq!(s.verdict("src/a.rs", "src/a.rs"), Verdict::Ok);
        assert_eq!(
            s.verdict("src/deep/a.rs", "src/deep/a.rs"),
            Verdict::OutOfScope
        );
        let s = Scope::new(Some(&["src/**/*.rs".to_owned()]), Some(&[])).unwrap();
        assert_eq!(
            s.verdict("src/deep/er/a.rs", "src/deep/er/a.rs"),
            Verdict::Ok
        );
    }

    #[test]
    fn an_explicit_empty_protected_list_replaces_the_defaults() {
        let s = Scope::new(None, Some(&[])).unwrap();
        assert_eq!(s.verdict("tests/a.rs", "tests/a.rs"), Verdict::Ok);
    }

    #[test]
    fn an_empty_allowed_list_allows_nothing() {
        let s = Scope::new(Some(&[]), Some(&[])).unwrap();
        assert_eq!(s.verdict("a", "a"), Verdict::OutOfScope);
    }

    #[test]
    fn protected_matches_case_insensitively() {
        assert_eq!(defaults().verdict(".ENV", ".ENV"), Verdict::Protected);
        assert_eq!(defaults().verdict("TESTS/a", "TESTS/a"), Verdict::Protected);
    }

    #[test]
    fn the_real_path_is_checked_too() {
        let s = defaults();
        assert_eq!(s.verdict("notes.txt", ".env"), Verdict::Protected);
        let s = Scope::new(Some(&["docs/**".to_owned()]), Some(&[])).unwrap();
        assert_eq!(s.verdict("docs/link", "src/real.rs"), Verdict::OutOfScope);
    }

    #[test]
    fn check_reports_every_path_and_protected_wins() {
        let s = Scope::new(Some(&["src/**".to_owned()]), None).unwrap();
        let err = s
            .check([
                ("src/ok.rs", "src/ok.rs"),
                ("lib/x.rs", "lib/x.rs"),
                ("src/tests/y.rs", "src/tests/y.rs"),
                ("tests/z", "tests/z"),
            ])
            .unwrap_err();
        match err {
            Error::ProtectedPath { paths } => assert_eq!(paths, vec!["tests/z"]),
            other => panic!("{other:?}"),
        }
        let err = s
            .check([("lib/a", "lib/a"), ("lib/b", "lib/b")])
            .unwrap_err();
        assert!(matches!(err, Error::ScopeViolation { paths } if paths.len() == 2));
    }

    #[test]
    fn bad_globs_are_rejected() {
        assert!(matches!(
            Scope::new(Some(&["[".to_owned()]), None),
            Err(Error::InvalidGlob { .. })
        ));
    }
}
