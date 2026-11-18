use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use local_artifacts::{
    spawn_artifact_server, ArtifactRepoSummary, ArtifactStore, ArtifactStoreError, GitRepoInfo,
    HealthResponse,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("hypo-{prefix}-{pid}-{id}"));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create temp test dir");
        Self { path }
    }

    fn path(&self) -> &PathBuf {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

async fn http_get(addr: std::net::SocketAddr, path: &str) -> (u16, String, String) {
    let mut stream = TcpStream::connect(addr).await.expect("connect loopback");
    let req = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).await.expect("write req");

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).await.expect("read resp");
    let text = String::from_utf8(raw).expect("utf8 http response");

    let (head, body) = text
        .split_once("\r\n\r\n")
        .expect("valid HTTP header/body separator");
    let status_line = head.lines().next().expect("status line");
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .expect("status code")
        .parse()
        .expect("numeric status");
    (status_code, head.to_string(), body.to_string())
}

#[test]
fn store_commits_v1_to_v2_reads_virtual_tree_and_diffs() {
    let tmp = TempDirGuard::new("artifacts-store");
    let store = ArtifactStore::new(tmp.path());

    let mut v1_files = HashMap::new();
    v1_files.insert("README.md".to_string(), "# Toast v1\nInitial draft\n".to_string());
    v1_files.insert(
        "src/CheckoutToast.tsx".to_string(),
        "export const version = 1;\n".to_string(),
    );

    let s1 = store
        .create_or_commit("default", "toast", v1_files, "initial toast component")
        .expect("v1 commit");

    assert_eq!(s1.id, "toast");
    assert_eq!(s1.namespace, "default");
    assert_eq!(s1.versions.len(), 1);
    assert_eq!(s1.versions[0].version, 1);
    assert_eq!(s1.versions[0].message, "initial toast component");
    assert_eq!(s1.head_commit, s1.versions[0].hash);

    // Verify local git author is aphesist without trailers.
    let repo_dir = store.repo_dir("default", "toast").expect("repo_dir");
    let author_out = Command::new("git")
        .current_dir(&repo_dir)
        .args(["log", "-1", "--format=%an|%B"])
        .output()
        .expect("git log");
    let author_str = String::from_utf8_lossy(&author_out.stdout);
    assert!(author_str.starts_with("aphesist|"), "got: {author_str}");
    assert!(!author_str.to_ascii_lowercase().contains("co-authored-by"));

    // Commit v2 modifying CheckoutToast.tsx.
    let mut v2_files = HashMap::new();
    v2_files.insert(
        "src/CheckoutToast.tsx".to_string(),
        "export const version = 2;\nexport const label = \"Shipped\";\n".to_string(),
    );
    let s2 = store
        .create_or_commit("default", "toast", v2_files, "upgrade toast to v2")
        .expect("v2 commit");

    assert_eq!(s2.versions.len(), 2);
    assert_eq!(s2.versions[0].version, 1);
    assert_eq!(s2.versions[1].version, 2);
    assert_ne!(s1.head_commit, s2.head_commit);
    assert_eq!(s2.head_commit, s2.versions[1].hash);

    // Virtual tree read via commit hash AND version alias.
    let content_v1 = store
        .read_file_at("default", "toast", &s1.head_commit, "src/CheckoutToast.tsx")
        .expect("read v1 by hash");
    assert_eq!(content_v1, "export const version = 1;\n");

    let content_v1_alias = store
        .read_file_at("default", "toast", "v1", "src/CheckoutToast.tsx")
        .expect("read v1 by alias");
    assert_eq!(content_v1_alias, content_v1);

    let content_v2 = store
        .read_file_at("default", "toast", &s2.head_commit, "src/CheckoutToast.tsx")
        .expect("read v2 by hash");
    assert!(content_v2.contains("version = 2"));

    // Diff v1 -> v2.
    let diff = store
        .diff_between("default", "toast", &s1.head_commit, &s2.head_commit)
        .expect("diff v1..v2");
    assert!(diff.contains("-export const version = 1;"));
    assert!(diff.contains("+export const version = 2;"));

    // Listing and lookup.
    let repos = store.list_repos().expect("list repos");
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].id, "toast");

    let fetched = store.get_repo("default", "toast").expect("get_repo");
    assert_eq!(fetched.head_commit, s2.head_commit);
}

#[test]
fn store_fork_repo_performs_local_clone_and_isolates_future_commits() {
    let tmp = TempDirGuard::new("artifacts-fork");
    let store = ArtifactStore::with_base_url(tmp.path(), "http://127.0.0.1:53954");

    let mut files = HashMap::new();
    files.insert("src/Widget.swift".to_string(), "struct Widget {}\n".to_string());
    let src = store
        .create_or_commit("ios", "widget-base", files, "base widget")
        .expect("base commit");

    let fork = store
        .fork_repo("ios", "widget-base", "widget-experiment")
        .expect("fork_repo");

    assert_eq!(fork.source_id, "widget-base");
    assert_eq!(fork.fork_id, "widget-experiment");
    assert_eq!(fork.head_commit, src.head_commit);
    assert_eq!(
        fork.fork_url,
        "http://127.0.0.1:53954/git/ios/widget-experiment.git"
    );

    // Committing to the fork does not alter the source repository.
    let mut fork_files = HashMap::new();
    fork_files.insert(
        "src/Widget.swift".to_string(),
        "struct Widget { let forked = true }\n".to_string(),
    );
    let fork_v2 = store
        .create_or_commit("ios", "widget-experiment", fork_files, "forked tweak")
        .expect("commit on fork");

    assert_eq!(fork_v2.versions.len(), 2);
    assert_ne!(fork_v2.head_commit, src.head_commit);

    let src_after = store.get_repo("ios", "widget-base").expect("source intact");
    assert_eq!(src_after.versions.len(), 1);
    assert_eq!(src_after.head_commit, src.head_commit);

    // Forking into an existing ID fails cleanly.
    let dup = store.fork_repo("ios", "widget-base", "widget-experiment");
    assert!(matches!(dup, Err(ArtifactStoreError::RepoAlreadyExists { .. })));
}

#[test]
fn store_rejects_path_traversal_and_invalid_identifiers() {
    let tmp = TempDirGuard::new("artifacts-security");
    let store = ArtifactStore::new(tmp.path());

    let mut bad_files = HashMap::new();
    bad_files.insert("../escape.txt".to_string(), "nope".to_string());
    let err = store.create_or_commit("default", "safe", bad_files, "bad path");
    assert!(matches!(err, Err(ArtifactStoreError::InvalidRelativePath(_))));

    let mut git_files = HashMap::new();
    git_files.insert(".git/config".to_string(), "tamper".to_string());
    let err2 = store.create_or_commit("default", "safe", git_files, "tamper git");
    assert!(matches!(err2, Err(ArtifactStoreError::InvalidRelativePath(_))));

    let bad_ns = store.get_repo("../etc", "safe");
    assert!(matches!(bad_ns, Err(ArtifactStoreError::InvalidIdentifier(_))));
}

#[tokio::test]
async fn axum_loopback_server_exposes_health_artifacts_tree_and_git_info() {
    let tmp = TempDirGuard::new("artifacts-http");
    let store = ArtifactStore::new(tmp.path());

    let mut v1 = HashMap::new();
    v1.insert(
        "src/CheckoutToast.tsx".to_string(),
        "export const toast = 'v1';\n".to_string(),
    );
    v1.insert("README.md".to_string(), "# Toast Artifact\n".to_string());
    let s1 = store
        .create_or_commit("default", "toast", v1, "v1 toast")
        .expect("commit v1");

    let mut v2 = HashMap::new();
    v2.insert(
        "src/CheckoutToast.tsx".to_string(),
        "export const toast = 'v2';\n".to_string(),
    );
    let s2 = store
        .create_or_commit("default", "toast", v2, "v2 toast")
        .expect("commit v2");

    let server = spawn_artifact_server(store.clone())
        .await
        .expect("spawn loopback server");
    let addr = server.addr();
    assert_eq!(addr.ip().to_string(), "127.0.0.1");
    assert_ne!(addr.port(), 0);

    // 1. /health
    let (status, _headers, body) = http_get(addr, "/health").await;
    assert_eq!(status, 200);
    let health: HealthResponse = serde_json::from_str(&body).expect("parse /health");
    assert_eq!(health.status, "ok");
    assert_eq!(health.service, "local-artifacts");

    // 2. /artifacts
    let (status, _headers, body) = http_get(addr, "/artifacts").await;
    assert_eq!(status, 200);
    let repos: Vec<ArtifactRepoSummary> = serde_json::from_str(&body).expect("parse /artifacts");
    assert_eq!(repos.len(), 1);
    assert_eq!(repos[0].id, "toast");
    assert_eq!(repos[0].versions.len(), 2);
    assert_eq!(
        repos[0].git_url,
        format!("http://{addr}/git/default/toast.git")
    );

    // 3. /artifacts/:ns/:id/tree/:rev/*path (both hash and v1 alias)
    let tree_v1_path = format!("/artifacts/default/toast/tree/{}/src/CheckoutToast.tsx", s1.head_commit);
    let (status, headers, body) = http_get(addr, &tree_v1_path).await;
    assert_eq!(status, 200);
    assert!(headers.to_ascii_lowercase().contains("etag:"));
    assert_eq!(body, "export const toast = 'v1';\n");

    let tree_v2_path = format!("/artifacts/default/toast/tree/{}/src/CheckoutToast.tsx", s2.head_commit);
    let (status, _headers, body) = http_get(addr, &tree_v2_path).await;
    assert_eq!(status, 200);
    assert_eq!(body, "export const toast = 'v2';\n");

    let (status, _headers, body) = http_get(addr, "/artifacts/default/toast/tree/v1/README.md").await;
    assert_eq!(status, 200);
    assert_eq!(body, "# Toast Artifact\n");

    let (status, _headers, body) = http_get(addr, "/artifacts/default/toast/diff/v1/v2").await;
    assert_eq!(status, 200);
    assert!(body.contains("-export const toast = 'v1';"));
    assert!(body.contains("+export const toast = 'v2';"));

    let (status, _headers, _body) = http_get(addr, "/artifacts/default/toast/tree/v1/no-such-file.txt").await;
    assert_eq!(status, 404);

    // 4. /git/:ns/:id (supporting .git suffix)
    let (status, _headers, body) = http_get(addr, "/git/default/toast.git").await;
    assert_eq!(status, 200);
    let info: GitRepoInfo = serde_json::from_str(&body).expect("parse /git info");
    assert_eq!(info.repo.id, "toast");
    assert_eq!(info.repo.versions.len(), 2);
    assert!(info.files.contains(&"src/CheckoutToast.tsx".to_string()));
    assert!(info.files.contains(&"README.md".to_string()));

    // 5. Missing repo returns 404
    let (status, _headers, _body) = http_get(addr, "/git/default/does-not-exist").await;
    assert_eq!(status, 404);

    // 6. Clean shutdown
    server.shutdown().await.expect("clean shutdown");
}
