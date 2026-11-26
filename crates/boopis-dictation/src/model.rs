//! The speech models boopis knows, as a table: where each one comes from, how large it is, and the SHA-256 it must have.
//!
//! A model file is **untrusted data until its hash matches**: [`read_verified`] reads the whole file, hashes those bytes
//! and returns them only when they are the pinned model, so what was hashed is what whisper.cpp then reads (no second
//! look at the disk). A file that is not the model is deleted and reported.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::{Error, Result};

/// One speech model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelSpec {
    /// The name a setting uses (`base-q5_1`).
    pub id: &'static str,
    /// The file's name in the app's speech folder.
    pub file: &'static str,
    /// Where it is fetched from: the official whisper.cpp model repository, at a pinned commit.
    pub url: &'static str,
    /// The SHA-256 of the file, lowercase hex.
    pub sha256: &'static str,
    /// The file's size in bytes.
    pub size: u64,
}

/// Whisper `base`, multilingual, quantized to 5 bits: 57 MB, English and Portuguese among its 99 languages.
pub const BASE_Q5_1: ModelSpec = ModelSpec {
    id: "base-q5_1",
    file: "ggml-base-q5_1.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin",
    sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
    size: 59_707_625,
};

/// Every model a setting may name. A larger one is a row here (and its name in the host's `speech_model` setting).
pub const MODELS: &[ModelSpec] = &[BASE_Q5_1];

/// The model used when no setting names one.
pub const DEFAULT: &ModelSpec = &BASE_Q5_1;

/// The model a setting names; `None` and an unknown name give the default (a setting from a newer build must not break
/// dictation).
#[must_use]
pub fn named(id: Option<&str>) -> &'static ModelSpec {
    id.and_then(|id| MODELS.iter().find(|m| m.id == id))
        .unwrap_or(DEFAULT)
}

/// The hosts a model may come from: the repository's own, and the content hosts its answers redirect to.
#[must_use]
pub fn host_allowed(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host.ends_with(".hf.co")
}

impl ModelSpec {
    /// Where the verified model lives in `dir` (the app's speech folder).
    #[must_use]
    pub fn path(&self, dir: &Path) -> PathBuf {
        dir.join(self.file)
    }

    /// Where a fetch in progress lives: the same folder, so the final rename is atomic.
    #[must_use]
    pub fn part_path(&self, dir: &Path) -> PathBuf {
        dir.join(format!("{}.part", self.file))
    }

    /// Whether a file of the model's exact size is in place. Its content is checked when it is read ([`read_verified`]).
    #[must_use]
    pub fn present(&self, dir: &Path) -> bool {
        std::fs::metadata(self.path(dir)).is_ok_and(|m| m.is_file() && m.len() == self.size)
    }
}

/// The SHA-256 of `bytes`, lowercase hex.
#[must_use]
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// The SHA-256 of the file at `path`, read in blocks.
///
/// # Errors
/// The read's failure, as text.
pub fn sha256_file(path: &Path) -> std::result::Result<String, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut block = vec![0_u8; 1 << 16];
    loop {
        let n = file.read(&mut block).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&block[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// The model's bytes, read from `dir` and returned only when they are the pinned file.
///
/// # Errors
/// [`Error::ModelMismatch`] when the size or the hash differs: the file has been deleted, so the next dictation fetches
/// it again. [`Error::Failed`] when it cannot be read.
pub fn read_verified(spec: &ModelSpec, dir: &Path) -> Result<Vec<u8>> {
    let path = spec.path(dir);
    let bytes = std::fs::read(&path)
        .map_err(|e| Error::Failed(format!("reading {}: {e}", path.display())))?;
    let found = sha256_hex(&bytes);
    if bytes.len() as u64 == spec.size && found == spec.sha256 {
        return Ok(bytes);
    }
    let removed = std::fs::remove_file(&path);
    tracing::warn!(
        model = spec.id,
        size = bytes.len(),
        sha256 = %found,
        removed = removed.is_ok(),
        "the speech model on disk is not the pinned file; it was deleted"
    );
    Err(Error::ModelMismatch(format!(
        "{} is {} bytes with sha256 {found}, expected {} bytes with {}",
        spec.file,
        bytes.len(),
        spec.size,
        spec.sha256
    )))
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    /// A stand-in model for the tests: `content` under a made-up name, with its real hash.
    pub(crate) fn spec_for(content: &[u8]) -> ModelSpec {
        ModelSpec {
            id: "test",
            file: "ggml-test.bin",
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/abc/ggml-test.bin",
            sha256: Box::leak(sha256_hex(content).into_boxed_str()),
            size: content.len() as u64,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::spec_for;
    use super::*;

    #[test]
    fn the_table_is_well_formed() {
        for m in MODELS {
            assert_eq!(m.sha256.len(), 64, "{}", m.id);
            assert!(
                m.sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            );
            let url = url::Url::parse(m.url).unwrap();
            assert_eq!(url.scheme(), "https");
            assert!(host_allowed(url.host_str().unwrap()));
            assert!(
                m.url.ends_with(m.file),
                "the file is named as the repository names it"
            );
            // a commit, not a branch: the address always names the same bytes
            assert!(
                !m.url.contains("/resolve/main/"),
                "{} is not pinned to a commit",
                m.id
            );
            assert!(m.size > 1_000_000);
        }
        assert_eq!(named(None).id, "base-q5_1");
        assert_eq!(named(Some("base-q5_1")).id, "base-q5_1");
        assert_eq!(
            named(Some("a-model-from-the-future")).id,
            "base-q5_1",
            "an unknown name is the default"
        );
    }

    #[test]
    fn only_the_repository_and_its_content_hosts_are_allowed() {
        for ok in [
            "huggingface.co",
            "HuggingFace.co",
            "cdn-lfs.huggingface.co",
            "us.aws.cdn.hf.co",
            "cas-bridge.xethub.hf.co",
        ] {
            assert!(host_allowed(ok), "{ok}");
        }
        for no in [
            "example.com",
            "huggingface.co.evil.example",
            "hf.co.evil.example",
            "nothuggingface.co",
            "evilhf.co",
            "127.0.0.1",
            "",
        ] {
            assert!(!host_allowed(no), "{no}");
        }
    }

    #[test]
    fn the_right_bytes_are_returned_and_anything_else_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let spec = spec_for(b"the model");
        assert!(!spec.present(dir.path()));
        std::fs::write(spec.path(dir.path()), b"the model").unwrap();
        assert!(spec.present(dir.path()));
        assert_eq!(read_verified(&spec, dir.path()).unwrap(), b"the model");
        assert_eq!(
            sha256_file(&spec.path(dir.path())).unwrap(),
            spec.sha256,
            "the block hash is the same hash"
        );

        // the same size, other bytes: refused and removed
        std::fs::write(spec.path(dir.path()), b"THE MODEL").unwrap();
        let e = read_verified(&spec, dir.path()).unwrap_err();
        assert!(matches!(e, Error::ModelMismatch(_)), "{e:?}");
        assert!(!spec.path(dir.path()).exists(), "a wrong file is deleted");

        // another size: not even "present"
        std::fs::write(spec.path(dir.path()), b"short").unwrap();
        assert!(!spec.present(dir.path()));
        assert!(matches!(
            read_verified(&spec, dir.path()),
            Err(Error::ModelMismatch(_))
        ));
        // nothing there
        assert!(matches!(
            read_verified(&spec, dir.path()),
            Err(Error::Failed(_))
        ));
    }
}
