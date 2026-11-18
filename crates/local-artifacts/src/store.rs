use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, RwLock};

use hypotaxis_contracts::{ArtifactCommit, ArtifactForkResult, ArtifactRepoSummary};
use thiserror::Error;

const DEFAULT_AUTHOR_NAME: &str = "aphesist";
const DEFAULT_AUTHOR_EMAIL: &str = "126630868+aphesist@users.noreply.github.com";

#[derive(Debug, Error)]
pub enum ArtifactStoreError {
    #[error("invalid identifier '{0}': must be a safe single path segment")]
    InvalidIdentifier(String),
    #[error("invalid relative path '{0}': traversal and absolute paths are forbidden")]
    InvalidRelativePath(String),
    #[error("invalid git revision '{0}'")]
    InvalidRevision(String),
    #[error("repository '{namespace}/{id}' not found")]
    RepoNotFound { namespace: String, id: String },
    #[error("fork target '{namespace}/{id}' already exists")]
    RepoAlreadyExists { namespace: String, id: String },
    #[error("git command failed ({cmd}): {stderr}")]
    GitFailed { cmd: String, stderr: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ArtifactStoreError>;

/// Manages isolated, Git-backed local artifact repositories under `<root>/<namespace>/<id>`.
#[derive(Debug, Clone)]
pub struct ArtifactStore {
    root: PathBuf,
    base_url: Arc<RwLock<Option<String>>>,
}

impl ArtifactStore {
    /// Creates an `ArtifactStore` rooted at `root`.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            base_url: Arc::new(RwLock::new(None)),
        }
    }

    /// Creates an `ArtifactStore` rooted at `root` with an HTTP base URL for `git_url` synthesis.
    pub fn with_base_url(root: impl Into<PathBuf>, base_url: impl Into<String>) -> Self {
        let normalized = base_url.into().trim_end_matches('/').to_string();
        Self {
            root: root.into(),
            base_url: Arc::new(RwLock::new(Some(normalized))),
        }
    }

    /// Returns the base directory where repositories are stored.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Sets or updates the loopback HTTP base URL used in `ArtifactRepoSummary::git_url`.
    pub fn set_base_url(&self, base_url: impl Into<String>) {
        let normalized = base_url.into().trim_end_matches('/').to_string();
        if let Ok(mut guard) = self.base_url.write() {
            *guard = Some(normalized);
        }
    }

    /// Returns the configured base URL if one has been set.
    pub fn base_url(&self) -> Option<String> {
        self.base_url.read().ok().and_then(|g| g.clone())
    }

    /// Resolves the on-disk directory path `<root>/<namespace>/<id>` after validating segments.
    pub fn repo_dir(&self, namespace: &str, id: &str) -> Result<PathBuf> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        Ok(self.root.join(ns).join(repo_id))
    }

    /// Resolves the public/local `git_url` for a repository.
    pub fn git_url(&self, namespace: &str, id: &str) -> Result<String> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        if let Some(base) = self.base_url() {
            return Ok(format!("{base}/git/{ns}/{repo_id}.git"));
        }
        let path = self.repo_dir(ns, repo_id)?;
        let slash = path.to_string_lossy().replace('\\', "/");
        if slash.starts_with('/') {
            Ok(format!("file://{slash}"))
        } else {
            Ok(format!("file:///{slash}"))
        }
    }

    /// Initializes a Git repo if missing, writes `files`, stages all changes, commits as `aphesist`,
    /// and returns the updated `ArtifactRepoSummary` with `versions` (`v1`, `v2`, ...).
    pub fn create_or_commit(
        &self,
        namespace: &str,
        id: &str,
        files: HashMap<String, String>,
        message: &str,
    ) -> Result<ArtifactRepoSummary> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        let repo_dir = self.repo_dir(ns, repo_id)?;

        if !repo_dir.join(".git").exists() {
            std::fs::create_dir_all(&repo_dir)?;
            run_git(Some(&repo_dir), &["-c", "init.defaultBranch=main", "init"])?;
        }

        configure_local_repo(&repo_dir)?;

        // Sort paths deterministically before writing to disk.
        let mut sorted_files = BTreeMap::new();
        for (raw_path, content) in files {
            let rel = normalize_rel_path(&raw_path)?;
            sorted_files.insert(rel, content);
        }

        for (rel, content) in sorted_files {
            let full_path = repo_dir.join(&rel);
            if let Some(parent) = full_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&full_path, content.as_bytes())?;
        }

        run_git(Some(&repo_dir), &["add", "-A"])?;

        let clean_msg = if message.trim().is_empty() {
            "artifact snapshot"
        } else {
            message.trim()
        };

        run_git(
            Some(&repo_dir),
            &[
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--no-verify",
                "--allow-empty",
                "-m",
                clean_msg,
            ],
        )?;

        self.get_repo(ns, repo_id)
    }

    /// Lists all Git-backed artifact repositories under `<root>/<namespace>/<id>`.
    pub fn list_repos(&self) -> Result<Vec<ArtifactRepoSummary>> {
        if !self.root.exists() {
            return Ok(Vec::new());
        }

        let mut pairs: Vec<(String, String)> = Vec::new();
        for ns_entry in std::fs::read_dir(&self.root)? {
            let ns_entry = ns_entry?;
            if !ns_entry.file_type()?.is_dir() {
                continue;
            }
            let ns_name = ns_entry.file_name().to_string_lossy().to_string();
            if validate_segment(&ns_name).is_err() {
                continue;
            }
            for repo_entry in std::fs::read_dir(ns_entry.path())? {
                let repo_entry = repo_entry?;
                if !repo_entry.file_type()?.is_dir() {
                    continue;
                }
                let id_name = repo_entry.file_name().to_string_lossy().to_string();
                if validate_segment(&id_name).is_err() {
                    continue;
                }
                if repo_entry.path().join(".git").exists() {
                    pairs.push((ns_name.clone(), id_name));
                }
            }
        }

        pairs.sort();
        let mut summaries = Vec::with_capacity(pairs.len());
        for (ns, id) in pairs {
            summaries.push(self.get_repo(&ns, &id)?);
        }
        Ok(summaries)
    }

    /// Returns repository metadata and commit history (`v1`, `v2`, ...) for `<namespace>/<id>`.
    pub fn get_repo(&self, namespace: &str, id: &str) -> Result<ArtifactRepoSummary> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        let repo_dir = self.repo_dir(ns, repo_id)?;
        if !repo_dir.join(".git").exists() {
            return Err(ArtifactStoreError::RepoNotFound {
                namespace: ns.to_string(),
                id: repo_id.to_string(),
            });
        }

        let versions = read_versions(&repo_dir)?;
        let head_commit = versions
            .last()
            .map(|c| c.hash.clone())
            .unwrap_or_default();

        Ok(ArtifactRepoSummary {
            id: repo_id.to_string(),
            namespace: ns.to_string(),
            name: repo_id.to_string(),
            git_url: self.git_url(ns, repo_id)?,
            head_commit,
            versions,
        })
    }

    /// Performs a virtual tree read of `rel_path` at `commit_hash` (or `v1`/`v2`/`HEAD`) via `git show`.
    pub fn read_file_at(
        &self,
        namespace: &str,
        id: &str,
        commit_hash: &str,
        rel_path: &str,
    ) -> Result<String> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        let repo_dir = self.repo_dir(ns, repo_id)?;
        if !repo_dir.join(".git").exists() {
            return Err(ArtifactStoreError::RepoNotFound {
                namespace: ns.to_string(),
                id: repo_id.to_string(),
            });
        }

        let resolved_rev = resolve_revision(&repo_dir, commit_hash)?;
        let norm_path = normalize_rel_path(rel_path)?;
        let spec = format!("{resolved_rev}:{norm_path}");
        run_git(Some(&repo_dir), &["show", &spec])
    }

    /// Computes unified diff between `from_hash` and `to_hash` (accepting hashes or `v1`/`v2`).
    pub fn diff_between(
        &self,
        namespace: &str,
        id: &str,
        from_hash: &str,
        to_hash: &str,
    ) -> Result<String> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        let repo_dir = self.repo_dir(ns, repo_id)?;
        if !repo_dir.join(".git").exists() {
            return Err(ArtifactStoreError::RepoNotFound {
                namespace: ns.to_string(),
                id: repo_id.to_string(),
            });
        }

        let from_rev = resolve_revision(&repo_dir, from_hash)?;
        let to_rev = resolve_revision(&repo_dir, to_hash)?;
        run_git(
            Some(&repo_dir),
            &["diff", "--no-ext-diff", &from_rev, &to_rev],
        )
    }

    /// Lists all tracked file paths in the repository tree at `rev` (or `HEAD`/`v1`).
    pub fn list_files_at(&self, namespace: &str, id: &str, rev: &str) -> Result<Vec<String>> {
        let ns = validate_segment(namespace)?;
        let repo_id = validate_segment(id)?;
        let repo_dir = self.repo_dir(ns, repo_id)?;
        if !repo_dir.join(".git").exists() {
            return Err(ArtifactStoreError::RepoNotFound {
                namespace: ns.to_string(),
                id: repo_id.to_string(),
            });
        }

        let has_head = run_git(Some(&repo_dir), &["rev-parse", "--verify", "HEAD"]).is_ok();
        if !has_head {
            return Ok(Vec::new());
        }

        let resolved_rev = resolve_revision(&repo_dir, rev)?;
        let output = run_git(
            Some(&repo_dir),
            &["ls-tree", "-r", "--name-only", &resolved_rev],
        )?;
        let mut files: Vec<String> = output
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(ToString::to_string)
            .collect();
        files.sort();
        Ok(files)
    }

    /// Performs an O(1)/hardlinked local clone (`git clone --local`) from `<namespace>/<source_id>`
    /// into `<namespace>/<new_id>`.
    pub fn fork_repo(
        &self,
        namespace: &str,
        source_id: &str,
        new_id: &str,
    ) -> Result<ArtifactForkResult> {
        let ns = validate_segment(namespace)?;
        let src_id = validate_segment(source_id)?;
        let dst_id = validate_segment(new_id)?;

        let src_dir = self.repo_dir(ns, src_id)?;
        if !src_dir.join(".git").exists() {
            return Err(ArtifactStoreError::RepoNotFound {
                namespace: ns.to_string(),
                id: src_id.to_string(),
            });
        }

        let dst_dir = self.repo_dir(ns, dst_id)?;
        if dst_dir.exists() {
            return Err(ArtifactStoreError::RepoAlreadyExists {
                namespace: ns.to_string(),
                id: dst_id.to_string(),
            });
        }

        if let Some(parent) = dst_dir.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Pass filesystem paths directly (not file:// URLs) so `git clone --local` hardlinks objects in O(1).
        let src_str = src_dir.to_string_lossy().to_string();
        let dst_str = dst_dir.to_string_lossy().to_string();
        run_git(None, &["clone", "--local", &src_str, &dst_str])?;

        configure_local_repo(&dst_dir)?;
        let head_commit = run_git(Some(&dst_dir), &["rev-parse", "HEAD"])?
            .trim()
            .to_string();

        Ok(ArtifactForkResult {
            source_id: src_id.to_string(),
            fork_id: dst_id.to_string(),
            fork_url: self.git_url(ns, dst_id)?,
            head_commit,
        })
    }
}

fn configure_local_repo(repo_dir: &Path) -> Result<()> {
    let empty_hooks = repo_dir.join(".git").join("no-hooks");
    std::fs::create_dir_all(&empty_hooks)?;
    let hooks_path = empty_hooks.to_string_lossy().replace('\\', "/");

    run_git(Some(repo_dir), &["config", "--local", "user.name", DEFAULT_AUTHOR_NAME])?;
    run_git(
        Some(repo_dir),
        &["config", "--local", "user.email", DEFAULT_AUTHOR_EMAIL],
    )?;
    run_git(Some(repo_dir), &["config", "--local", "commit.gpgsign", "false"])?;
    run_git(Some(repo_dir), &["config", "--local", "core.autocrlf", "false"])?;
    run_git(Some(repo_dir), &["config", "--local", "core.hooksPath", &hooks_path])?;
    Ok(())
}

fn read_versions(repo_dir: &Path) -> Result<Vec<ArtifactCommit>> {
    if run_git(Some(repo_dir), &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Ok(Vec::new());
    }

    let raw = run_git(
        Some(repo_dir),
        &["log", "--reverse", "--format=%H%x1f%s%x1f%cI%x1e"],
    )?;

    let mut commits = Vec::new();
    for (idx, record) in raw
        .split('\x1e')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .enumerate()
    {
        let mut fields = record.splitn(3, '\x1f');
        let hash = fields.next().unwrap_or_default().trim().to_string();
        let message = fields.next().unwrap_or_default().trim().to_string();
        let timestamp = fields.next().unwrap_or_default().trim().to_string();
        if hash.is_empty() {
            continue;
        }
        commits.push(ArtifactCommit {
            hash,
            version: (idx + 1) as u32,
            message,
            timestamp,
        });
    }
    Ok(commits)
}

fn resolve_revision(repo_dir: &Path, rev: &str) -> Result<String> {
    let trimmed = validate_revision(rev)?;
    if let Some(rest) = trimmed.strip_prefix('v') {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(ver) = rest.parse::<u32>() {
                let versions = read_versions(repo_dir)?;
                if let Some(commit) = versions.into_iter().find(|c| c.version == ver) {
                    return Ok(commit.hash);
                }
                return Err(ArtifactStoreError::InvalidRevision(trimmed.to_string()));
            }
        }
    }
    Ok(trimmed.to_string())
}

fn validate_segment(segment: &str) -> Result<&str> {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.starts_with('.')
        || segment.starts_with('-')
    {
        return Err(ArtifactStoreError::InvalidIdentifier(segment.to_string()));
    }
    if !segment
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(ArtifactStoreError::InvalidIdentifier(segment.to_string()));
    }
    Ok(segment)
}

fn normalize_rel_path(raw: &str) -> Result<String> {
    if raw.is_empty() || raw.contains('\0') {
        return Err(ArtifactStoreError::InvalidRelativePath(raw.to_string()));
    }
    let replaced = raw.replace('\\', "/");
    let trimmed = replaced.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err(ArtifactStoreError::InvalidRelativePath(raw.to_string()));
    }

    let mut parts: Vec<&str> = Vec::new();
    for comp in Path::new(trimmed).components() {
        match comp {
            Component::Normal(os_str) => {
                let s = os_str
                    .to_str()
                    .ok_or_else(|| ArtifactStoreError::InvalidRelativePath(raw.to_string()))?;
                if s.eq_ignore_ascii_case(".git") && parts.is_empty() {
                    return Err(ArtifactStoreError::InvalidRelativePath(raw.to_string()));
                }
                parts.push(s);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ArtifactStoreError::InvalidRelativePath(raw.to_string()));
            }
        }
    }

    if parts.is_empty() {
        return Err(ArtifactStoreError::InvalidRelativePath(raw.to_string()));
    }
    Ok(parts.join("/"))
}

fn validate_revision(rev: &str) -> Result<&str> {
    let trimmed = rev.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.contains("..")
        || trimmed.contains(':')
        || trimmed.contains('\0')
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '~' | '^'))
    {
        return Err(ArtifactStoreError::InvalidRevision(rev.to_string()));
    }
    Ok(trimmed)
}

fn run_git(cwd: Option<&Path>, args: &[&str]) -> Result<String> {
    let mut cmd = Command::new("git");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // Isolate subprocess from any ambient Git hook/repository env vars in parent shells.
    for var in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        cmd.env_remove(var);
    }
    cmd.args(args);

    let out = cmd.output()?;
    if !out.status.success() {
        return Err(ArtifactStoreError::GitFailed {
            cmd: format!("git {}", args.join(" ")),
            stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
