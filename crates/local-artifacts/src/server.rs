use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use hypotaxis_contracts::ArtifactRepoSummary;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::store::{ArtifactStore, ArtifactStoreError};

/// Response returned by `GET /health`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub timestamp: String,
}

/// Metadata + commit log + tracked file list returned by `GET /git/:ns/:id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitRepoInfo {
    #[serde(flatten)]
    pub repo: ArtifactRepoSummary,
    pub files: Vec<String>,
}

/// Handle to a running loopback `axum` ArtifactFS / Git metadata HTTP server.
pub struct ArtifactServerHandle {
    addr: SocketAddr,
    shutdown_tx: Option<oneshot::Sender<()>>,
    task: Option<JoinHandle<()>>,
}

impl ArtifactServerHandle {
    /// Returns the bound loopback socket address (`127.0.0.1:<port>`).
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Returns the HTTP base URL (`http://127.0.0.1:<port>`).
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Gracefully shuts down the HTTP server and awaits completion.
    pub async fn shutdown(mut self) -> anyhow::Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.task.take() {
            handle.await.context("artifact server task failed")?;
        }
        Ok(())
    }
}

impl Drop for ArtifactServerHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Builds the `axum::Router` for a given `ArtifactStore`.
pub fn build_router(store: ArtifactStore) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/artifacts", get(list_artifacts_handler))
        .route(
            "/artifacts/:ns/:id/tree/:rev/*path",
            get(read_tree_file_handler),
        )
        .route(
            "/artifacts/:ns/:id/diff/:from/:to",
            get(diff_artifacts_handler),
        )
        .route("/git/:ns/:id", get(git_info_handler))
        .with_state(store)
}

/// Spawns the loopback HTTP server on `127.0.0.1:0` (ephemeral port).
pub async fn spawn_artifact_server(store: ArtifactStore) -> anyhow::Result<ArtifactServerHandle> {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0);
    spawn_artifact_server_on(store, addr).await
}

/// Spawns the loopback HTTP server bound to `addr` (`127.0.0.1:0` for ephemeral).
pub async fn spawn_artifact_server_on(
    store: ArtifactStore,
    addr: SocketAddr,
) -> anyhow::Result<ArtifactServerHandle> {
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind artifact server on {addr}"))?;
    let bound_addr = listener.local_addr()?;

    if store.base_url().is_none() {
        store.set_base_url(format!("http://{bound_addr}"));
    }

    let app = build_router(store);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let task = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        let _ = server.await;
    });

    Ok(ArtifactServerHandle {
        addr: bound_addr,
        shutdown_tx: Some(shutdown_tx),
        task: Some(task),
    })
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        service: "local-artifacts".to_string(),
        timestamp: Utc::now().to_rfc3339(),
    })
}

async fn list_artifacts_handler(
    State(store): State<ArtifactStore>,
) -> std::result::Result<Json<Vec<ArtifactRepoSummary>>, ServerError> {
    let repos = tokio::task::spawn_blocking(move || store.list_repos())
        .await
        .map_err(ServerError::join)??;
    Ok(Json(repos))
}

async fn read_tree_file_handler(
    State(store): State<ArtifactStore>,
    Path((ns, raw_id, rev, rel_path)): Path<(String, String, String, String)>,
) -> std::result::Result<Response, ServerError> {
    let id = normalize_repo_id(&store, &ns, &raw_id);
    let path_for_mime = rel_path.clone();

    let content =
        tokio::task::spawn_blocking(move || store.read_file_at(&ns, &id, &rev, &rel_path))
            .await
            .map_err(ServerError::join)??;

    let digest = Sha256::digest(content.as_bytes());
    let etag_val = format!("\"{}\"", hex::encode(digest));
    let content_type = guess_content_type(&path_for_mime);

    let mut resp = (StatusCode::OK, content).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    if let Ok(etag_header) = HeaderValue::from_str(&etag_val) {
        resp.headers_mut().insert(header::ETAG, etag_header);
    }
    Ok(resp)
}

async fn diff_artifacts_handler(
    State(store): State<ArtifactStore>,
    Path((ns, raw_id, from_rev, to_rev)): Path<(String, String, String, String)>,
) -> std::result::Result<Response, ServerError> {
    let id = normalize_repo_id(&store, &ns, &raw_id);
    let diff =
        tokio::task::spawn_blocking(move || store.diff_between(&ns, &id, &from_rev, &to_rev))
            .await
            .map_err(ServerError::join)??;

    let mut resp = (StatusCode::OK, diff).into_response();
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    Ok(resp)
}

async fn git_info_handler(
    State(store): State<ArtifactStore>,
    Path((ns, raw_id)): Path<(String, String)>,
) -> std::result::Result<Json<GitRepoInfo>, ServerError> {
    let id = normalize_repo_id(&store, &ns, &raw_id);
    let info = tokio::task::spawn_blocking(move || -> crate::store::Result<GitRepoInfo> {
        let repo = store.get_repo(&ns, &id)?;
        let files = store.list_files_at(&ns, &id, "HEAD")?;
        Ok(GitRepoInfo { repo, files })
    })
    .await
    .map_err(ServerError::join)??;

    Ok(Json(info))
}

fn normalize_repo_id(store: &ArtifactStore, ns: &str, raw_id: &str) -> String {
    if let Ok(dir) = store.repo_dir(ns, raw_id) {
        if dir.join(".git").exists() {
            return raw_id.to_string();
        }
    }
    raw_id
        .strip_suffix(".git")
        .unwrap_or(raw_id)
        .to_string()
}

fn guess_content_type(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "text/markdown; charset=utf-8"
    } else if lower.ends_with(".html") || lower.ends_with(".htm") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "text/javascript; charset=utf-8"
    } else if lower.ends_with(".ts") || lower.ends_with(".tsx") {
        "text/typescript; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "text/plain; charset=utf-8"
    }
}

struct ServerError(StatusCode, String);

impl ServerError {
    fn join(err: tokio::task::JoinError) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("blocking task failed: {err}"),
        )
    }
}

impl From<ArtifactStoreError> for ServerError {
    fn from(err: ArtifactStoreError) -> Self {
        let code = match &err {
            ArtifactStoreError::InvalidIdentifier(_)
            | ArtifactStoreError::InvalidRelativePath(_)
            | ArtifactStoreError::InvalidRevision(_) => StatusCode::BAD_REQUEST,
            ArtifactStoreError::RepoNotFound { .. } => StatusCode::NOT_FOUND,
            ArtifactStoreError::RepoAlreadyExists { .. } => StatusCode::CONFLICT,
            ArtifactStoreError::GitFailed { stderr, .. } => {
                if stderr.contains("exists on disk, but not in")
                    || stderr.contains("does not exist in")
                    || stderr.contains("invalid object name")
                    || stderr.contains("unknown revision")
                    || stderr.contains("Path '")
                {
                    StatusCode::NOT_FOUND
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            }
            ArtifactStoreError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self(code, err.to_string())
    }
}

impl IntoResponse for ServerError {
    fn into_response(self) -> Response {
        let body = serde_json::json!({ "error": self.1 });
        (self.0, Json(body)).into_response()
    }
}
