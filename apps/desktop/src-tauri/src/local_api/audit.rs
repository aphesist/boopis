//! The record of who answered what: one line per answer in `<app data>/audit/client-answers.jsonl`, append-only, mode
//! `0600`, kept to a bounded size (the old file is renamed to `.1` when it passes the cap). A line holds the time, the
//! bot, the session, the prompt, the choice, the outcome and the client's label and surface: never the command text, and
//! never a token. A failure to write is logged and never blocks an answer.

use std::io::Write as _;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// The most the file may hold before it is rotated.
pub const MAX_BYTES: u64 = 512 * 1024;

/// One answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Line {
    /// When, in milliseconds since the epoch.
    pub at: i64,
    /// The bot.
    pub profile: String,
    /// The session.
    pub session_id: String,
    /// The prompt.
    pub prompt_id: String,
    /// What was chosen.
    pub choice: String,
    /// `delivered`, `refused:<code>`, `failed` or `already_settled`.
    pub outcome: String,
    /// The client's label.
    pub client: String,
    /// `gui`, `endpoint` or `cli`.
    pub surface: String,
}

/// Where the lines go.
#[derive(Debug, Clone)]
pub struct Audit {
    path: PathBuf,
}

impl Audit {
    /// The record under `dir` (the app's data folder).
    #[must_use]
    pub fn under(dir: &Path) -> Self {
        Self {
            path: dir.join("audit").join("client-answers.jsonl"),
        }
    }

    /// The file's path.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append a line. Errors are logged, never returned: the answer has already happened.
    pub fn record(&self, line: &Line) {
        if let Err(e) = self.append(line) {
            tracing::warn!(error = %e, "could not record who answered an approval");
        }
    }

    fn append(&self, line: &Line) -> std::io::Result<()> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() >= MAX_BYTES) {
            let old = self.path.with_extension("jsonl.1");
            let _ = std::fs::remove_file(&old);
            std::fs::rename(&self.path, old)?;
        }
        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let mut file = options.open(&self.path)?;
        let mut text = serde_json::to_string(line).map_err(std::io::Error::other)?;
        text.push('\n');
        file.write_all(text.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: i64) -> Line {
        Line {
            at: n,
            profile: "kai".into(),
            session_id: "s1".into(),
            prompt_id: "p1".into(),
            choice: "once".into(),
            outcome: "delivered".into(),
            client: "panacea-island".into(),
            surface: "endpoint".into(),
        }
    }

    #[test]
    fn a_line_says_who_and_never_what_was_run() {
        let dir = tempfile::tempdir().unwrap();
        let audit = Audit::under(dir.path());
        audit.record(&line(1));
        audit.record(&line(2));
        let text = std::fs::read_to_string(audit.path()).unwrap();
        let rows: Vec<serde_json::Value> = text
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["client"], "panacea-island");
        assert_eq!(rows[0]["surface"], "endpoint");
        assert!(rows[0].get("command").is_none() && rows[0].get("description").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn the_record_is_private_to_its_owner() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let audit = Audit::under(dir.path());
        audit.record(&line(1));
        let mode = std::fs::metadata(audit.path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "mode {mode:o}");
    }

    #[test]
    fn a_full_file_is_rotated_not_grown() {
        let dir = tempfile::tempdir().unwrap();
        let audit = Audit::under(dir.path());
        std::fs::create_dir_all(audit.path().parent().unwrap()).unwrap();
        std::fs::write(
            audit.path(),
            vec![b'x'; usize::try_from(MAX_BYTES).unwrap()],
        )
        .unwrap();
        audit.record(&line(1));
        assert!(audit.path().with_extension("jsonl.1").exists());
        assert!(std::fs::metadata(audit.path()).unwrap().len() < 1024);
    }
}
