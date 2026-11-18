//! Logging setup: `tracing` with JSON lines to a rotating file (or stderr), through a redactor.
//!
//! - Stdout is never used: it carries protocol frames only.
//! - Every line passes a [`Redactor`] before it is written. The rules come from `hx-pack`
//!   later; this crate only defines the trait.
//! - The file rotates at 10 MiB and keeps 5 files (`hx.log`, `hx.log.1` .. `hx.log.5`).
//! - Prompts, file contents and tool payloads are never logged above `trace`.

use std::borrow::Cow;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::MakeWriter;

/// Rewrites one log line, removing secrets. Implemented by `hx-pack`'s redactor.
pub trait Redactor: Send + Sync {
    /// Returns the line with secrets removed. The line has no trailing newline.
    fn redact<'a>(&self, line: &'a str) -> Cow<'a, str>;
}

/// A redactor with no rules. It exists so a binary can start before `hx-pack`'s rules are
/// wired in. It is safe only because `hx` logs paths and counts, never contents.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoRules;

impl Redactor for NoRules {
    fn redact<'a>(&self, line: &'a str) -> Cow<'a, str> {
        Cow::Borrowed(line)
    }
}

/// Where logs go.
#[derive(Debug, Clone)]
pub enum LogSink {
    /// A rotating file at this path (the directory is created).
    File(PathBuf),
    /// Standard error.
    Stderr,
}

/// Logging configuration.
#[derive(Clone)]
pub struct LogConfig {
    /// The destination.
    pub sink: LogSink,
    /// An `EnvFilter` directive such as `info` or `hx_txn=debug`.
    pub filter: String,
    /// Applied to every line before it is written.
    pub redactor: Arc<dyn Redactor>,
    /// Rotate when the file reaches this many bytes.
    pub max_bytes: u64,
    /// How many rotated files to keep.
    pub keep: usize,
}

impl LogConfig {
    /// Defaults: stderr, `info`, no rules, 10 MiB, 5 files.
    #[must_use]
    pub fn new(redactor: Arc<dyn Redactor>) -> Self {
        Self {
            sink: LogSink::Stderr,
            filter: "info".to_owned(),
            redactor,
            max_bytes: 10 * 1024 * 1024,
            keep: 5,
        }
    }
}

/// Installs the global subscriber.
///
/// # Errors
/// - the log file cannot be opened;
/// - the filter does not parse;
/// - a subscriber is already installed.
pub fn init(config: &LogConfig) -> io::Result<()> {
    let filter = EnvFilter::try_new(&config.filter)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
    let writer = RedactingMakeWriter::new(config)?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false)
        .try_init()
        .map_err(|e| io::Error::other(e.to_string()))
}

/// A `MakeWriter` that buffers one event, redacts it, and writes it to the sink.
#[derive(Clone)]
pub struct RedactingMakeWriter {
    sink: Arc<Sink>,
    redactor: Arc<dyn Redactor>,
}

enum Sink {
    Stderr,
    File(Mutex<RotatingFile>),
}

impl RedactingMakeWriter {
    /// Opens the sink described by `config`.
    ///
    /// # Errors
    /// The log file or its directory cannot be created.
    pub fn new(config: &LogConfig) -> io::Result<Self> {
        let sink = match &config.sink {
            LogSink::Stderr => Sink::Stderr,
            LogSink::File(path) => Sink::File(Mutex::new(RotatingFile::open(
                path,
                config.max_bytes,
                config.keep,
            )?)),
        };
        Ok(Self {
            sink: Arc::new(sink),
            redactor: Arc::clone(&config.redactor),
        })
    }
}

impl<'a> MakeWriter<'a> for RedactingMakeWriter {
    type Writer = LineWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LineWriter {
            target: self.clone(),
            buf: Vec::new(),
        }
    }
}

/// Collects bytes and, at each newline, redacts and writes the finished line.
pub struct LineWriter {
    target: RedactingMakeWriter,
    buf: Vec<u8>,
}

impl LineWriter {
    fn emit_complete_lines(&mut self) -> io::Result<()> {
        while let Some(pos) = self.buf.iter().position(|&b| b == b'\n') {
            let rest = self.buf.split_off(pos + 1);
            let mut line = std::mem::replace(&mut self.buf, rest);
            line.pop();
            let text = String::from_utf8_lossy(&line);
            let redacted = self.target.redactor.redact(&text);
            let mut out = redacted.into_owned().into_bytes();
            out.push(b'\n');
            match &*self.target.sink {
                Sink::Stderr => io::stderr().write_all(&out)?,
                Sink::File(file) => file
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .write_line(&out)?,
            }
        }
        Ok(())
    }
}

impl Write for LineWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        self.emit_complete_lines()?;
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for LineWriter {
    fn drop(&mut self) {
        // An event that ended without a newline is still a line.
        if !self.buf.is_empty() {
            self.buf.push(b'\n');
            let _ = self.emit_complete_lines();
        }
    }
}

/// An append-only log file that rotates by size.
#[derive(Debug)]
pub struct RotatingFile {
    path: PathBuf,
    file: File,
    written: u64,
    max_bytes: u64,
    keep: usize,
}

impl RotatingFile {
    /// Opens (creating directories and the file, mode 0600 on Unix).
    ///
    /// # Errors
    /// The directory or file cannot be created.
    pub fn open(path: &Path, max_bytes: u64, keep: usize) -> io::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = open_log(path)?;
        let written = file.metadata()?.len();
        Ok(Self {
            path: path.to_owned(),
            file,
            written,
            max_bytes,
            keep,
        })
    }

    /// Writes one complete line, rotating first if it would pass the size limit.
    ///
    /// # Errors
    /// Rotation or the write fails.
    pub fn write_line(&mut self, line: &[u8]) -> io::Result<()> {
        if self.written > 0 && self.written + line.len() as u64 > self.max_bytes {
            self.rotate()?;
        }
        self.file.write_all(line)?;
        self.written += line.len() as u64;
        Ok(())
    }

    fn rotated(&self, n: usize) -> PathBuf {
        let mut name = self.path.as_os_str().to_owned();
        name.push(format!(".{n}"));
        PathBuf::from(name)
    }

    fn rotate(&mut self) -> io::Result<()> {
        if self.keep == 0 {
            self.file.set_len(0)?;
            self.written = 0;
            return Ok(());
        }
        let _ = std::fs::remove_file(self.rotated(self.keep));
        for n in (1..self.keep).rev() {
            let from = self.rotated(n);
            if from.exists() {
                std::fs::rename(from, self.rotated(n + 1))?;
            }
        }
        std::fs::rename(&self.path, self.rotated(1))?;
        self.file = open_log(&self.path)?;
        self.written = 0;
        Ok(())
    }
}

fn open_log(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Mask;
    impl Redactor for Mask {
        fn redact<'a>(&self, line: &'a str) -> Cow<'a, str> {
            Cow::Owned(line.replace("sk-secret", "[redacted]"))
        }
    }

    fn config(path: PathBuf, max_bytes: u64, keep: usize) -> LogConfig {
        let mut c = LogConfig::new(Arc::new(Mask));
        c.sink = LogSink::File(path);
        c.max_bytes = max_bytes;
        c.keep = keep;
        c
    }

    #[test]
    fn lines_pass_through_the_redactor() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs/hx.log");
        let writer = RedactingMakeWriter::new(&config(path.clone(), 1 << 20, 2)).unwrap();
        let mut w = writer.make_writer();
        w.write_all(b"{\"msg\":\"key sk-secret\"}\n{\"msg\":\"b\"}\n")
            .unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text, "{\"msg\":\"key [redacted]\"}\n{\"msg\":\"b\"}\n");
    }

    #[test]
    fn a_line_split_across_writes_is_redacted_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hx.log");
        let writer = RedactingMakeWriter::new(&config(path.clone(), 1 << 20, 2)).unwrap();
        let mut w = writer.make_writer();
        w.write_all(b"token sk-").unwrap();
        w.write_all(b"secret end\n").unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "token [redacted] end\n"
        );
    }

    #[test]
    fn rotation_keeps_the_newest_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hx.log");
        let mut f = RotatingFile::open(&path, 10, 2).unwrap();
        for i in 0..6 {
            f.write_line(format!("line-{i}\n").as_bytes()).unwrap();
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "line-5\n");
        assert_eq!(
            std::fs::read_to_string(dir.path().join("hx.log.1")).unwrap(),
            "line-4\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("hx.log.2")).unwrap(),
            "line-3\n"
        );
        assert!(!dir.path().join("hx.log.3").exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_log_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hx.log");
        RotatingFile::open(&path, 10, 1).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
