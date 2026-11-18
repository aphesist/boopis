pub mod server;
pub mod store;

pub use hypotaxis_contracts::*;
pub use server::{
    build_router, spawn_artifact_server, spawn_artifact_server_on, ArtifactServerHandle,
    GitRepoInfo, HealthResponse,
};
pub use store::{ArtifactStore, ArtifactStoreError};

pub fn artifacts_ready() -> bool {
    true
}
