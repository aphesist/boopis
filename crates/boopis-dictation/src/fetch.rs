//! The one-time fetch of a speech model: over HTTPS from the model repository to `<file>.part` in the app's speech folder,
//! then hashed, and only when the hash is the pinned one renamed to its name. Until then it is untrusted bytes that
//! nothing loads.
//!
//! - **It goes on from where it stopped.** A `.part` file left by a cut connection, or by an earlier run of the app, is
//!   continued with a `Range` request; a server that ignores the range starts it again from nothing.
//! - **Redirects are followed here, one hop at a time**, and each hop must be `https` to a host of the repository
//!   ([`crate::model::host_allowed`]); the transport itself follows none.
//! - **Never more than the model's size is written**, and a file of the right size with the wrong hash is deleted and
//!   reported ([`Error::ModelMismatch`]).
//!
//! The HTTPS itself is the host's ([`Transport`]): this crate opens no socket.

use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

use url::Url;

use crate::model::{self, ModelSpec};
use crate::{Error, Result};

/// One answer of the server, its body not yet read.
pub struct Reply {
    /// The HTTP status.
    pub status: u16,
    /// The `Location` header of a redirect.
    pub location: Option<String>,
    /// The `Content-Range` header of a partial answer (`bytes 100-999/1000`).
    pub content_range: Option<String>,
    /// The body. Reading it may fail part way: what was read is kept.
    pub body: Box<dyn Read + Send>,
}

/// How a GET leaves the computer. Blocking; called from the fetch's own thread.
pub trait Transport: Send + Sync + 'static {
    /// `GET url`, following no redirect, with `Range: bytes=<from>-` when `from` is not 0.
    ///
    /// # Errors
    /// What the network said, as text for the log.
    fn get(&self, url: &Url, from: u64) -> std::result::Result<Reply, String>;
}

/// The fetch's own numbers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    /// Redirects followed per request.
    pub max_redirects: u32,
    /// Tries in a row that bring no new byte before the fetch gives up. A try that brought some does not count.
    pub attempts: u32,
    /// The pause before another try.
    pub backoff: Duration,
    /// Progress is reported about every this many bytes.
    pub report_every: u64,
    /// Plain `http` to a loopback address is allowed. Only tests say so.
    pub loopback_http: bool,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            max_redirects: 5,
            attempts: 3,
            backoff: Duration::from_secs(1),
            report_every: 256 * 1024,
            loopback_http: false,
        }
    }
}

/// How one pass over the network ended.
enum Pass {
    /// Worth another try: the connection, a busy server.
    Again(String),
    /// Not worth one.
    Stop(Error),
}

/// Fetch `spec` into `dir` unless it is already there. `progress(done, total)` is called as bytes arrive, from this
/// thread.
///
/// # Errors
/// [`Error::ModelFetch`] when the network or the disk fails (what arrived stays in the `.part` file for the next try);
/// [`Error::ModelMismatch`] when what arrived is not the model (it is deleted).
pub fn fetch(
    spec: &ModelSpec,
    dir: &Path,
    transport: &dyn Transport,
    policy: &Policy,
    progress: &dyn Fn(u64, u64),
) -> Result<()> {
    if spec.present(dir) {
        return Ok(());
    }
    std::fs::create_dir_all(dir)
        .map_err(|e| Error::ModelFetch(format!("creating {}: {e}", dir.display())))?;
    let part = spec.part_path(dir);
    let mut stalls = 0;
    let mut last = String::from("nothing was tried");
    // a try that brings bytes does not count against `attempts`, and the model's size bounds how many of those there can be
    let most = policy.attempts.saturating_mul(64).max(1);
    for _ in 0..most {
        let have = part_len(&part, spec.size);
        if have == spec.size {
            return finish(spec, dir, &part);
        }
        progress(have, spec.size);
        match pass(spec, &part, have, transport, policy, progress) {
            Ok(()) => {}
            Err(Pass::Stop(e)) => return Err(e),
            Err(Pass::Again(detail)) => {
                tracing::info!(model = spec.id, %detail, "the speech model fetch stopped; it goes on from what arrived");
                last = detail;
                if part_len(&part, spec.size) > have {
                    stalls = 0;
                } else {
                    stalls += 1;
                    if stalls >= policy.attempts {
                        break;
                    }
                }
                if !policy.backoff.is_zero() {
                    std::thread::sleep(policy.backoff);
                }
            }
        }
    }
    if part_len(&part, spec.size) == spec.size {
        return finish(spec, dir, &part);
    }
    Err(Error::ModelFetch(last))
}

/// The bytes of the `.part` file. One that is larger than the model is not a part of it: it is removed.
fn part_len(part: &Path, size: u64) -> u64 {
    match std::fs::metadata(part) {
        Ok(m) if m.is_file() && m.len() <= size => m.len(),
        Ok(_) => {
            let _ = std::fs::remove_file(part);
            0
        }
        Err(_) => 0,
    }
}

/// The whole file is here: hash it, and give it its name only when it is the model.
fn finish(spec: &ModelSpec, dir: &Path, part: &Path) -> Result<()> {
    let found = model::sha256_file(part)
        .map_err(|e| Error::ModelFetch(format!("reading {}: {e}", part.display())))?;
    if found != spec.sha256 {
        let _ = std::fs::remove_file(part);
        return Err(Error::ModelMismatch(format!(
            "{} arrived with sha256 {found}, expected {}",
            spec.file, spec.sha256
        )));
    }
    // on disk before it has its name, so a crash never leaves a half-written file under the model's name
    std::fs::File::open(part)
        .and_then(|f| f.sync_all())
        .and_then(|()| std::fs::rename(part, spec.path(dir)))
        .map_err(|e| Error::ModelFetch(format!("placing {}: {e}", spec.file)))
}

/// Whether `url` may be asked: `https` to a host of the repository, with no credentials in it.
fn check(url: &Url, policy: &Policy) -> std::result::Result<(), Pass> {
    let refuse = |what: &str| {
        Err(Pass::Stop(Error::ModelFetch(format!(
            "refused {what}: {}",
            url.host_str().unwrap_or("no host")
        ))))
    };
    if !url.username().is_empty() || url.password().is_some() {
        return refuse("an address with a user name or password");
    }
    let host = url.host_str().unwrap_or_default();
    match url.scheme() {
        "https" if model::host_allowed(host) => Ok(()),
        "https" => refuse("a host that is not the model repository's"),
        "http" if policy.loopback_http && matches!(host, "127.0.0.1" | "localhost") => Ok(()),
        _ => refuse("an address that is not https"),
    }
}

/// One request (through its redirects) and the reading of its body into the `.part` file.
fn pass(
    spec: &ModelSpec,
    part: &Path,
    have: u64,
    transport: &dyn Transport,
    policy: &Policy,
    progress: &dyn Fn(u64, u64),
) -> std::result::Result<(), Pass> {
    let mut url = Url::parse(spec.url)
        .map_err(|e| Pass::Stop(Error::ModelFetch(format!("the model's address: {e}"))))?;
    for _ in 0..=policy.max_redirects {
        check(&url, policy)?;
        let reply = transport
            .get(&url, have)
            .map_err(|e| Pass::Again(format!("{}: {e}", url.host_str().unwrap_or(""))))?;
        match reply.status {
            301 | 302 | 303 | 307 | 308 => {
                let Some(location) = reply.location else {
                    return Err(Pass::Again("a redirect with no address".into()));
                };
                url = url
                    .join(&location)
                    .map_err(|e| Pass::Again(format!("a redirect that does not parse: {e}")))?;
            }
            // the whole file from its first byte, whatever was asked
            200 => return receive(spec, part, 0, reply.body, policy, progress),
            206 if starts_at(reply.content_range.as_deref(), have) => {
                return receive(spec, part, have, reply.body, policy, progress);
            }
            // a range the server will not serve as asked: what is held cannot be continued
            206 | 416 => {
                let _ = std::fs::remove_file(part);
                return Err(Pass::Again(format!(
                    "the server would not continue at byte {have}"
                )));
            }
            status @ (401 | 403 | 404 | 410 | 451) => {
                return Err(Pass::Stop(Error::ModelFetch(format!(
                    "{} answered {status}",
                    url.host_str().unwrap_or("")
                ))));
            }
            status => {
                return Err(Pass::Again(format!(
                    "{} answered {status}",
                    url.host_str().unwrap_or("")
                )));
            }
        }
    }
    Err(Pass::Stop(Error::ModelFetch(
        "the address redirects too many times".into(),
    )))
}

/// Whether a `Content-Range` says the body starts at byte `at` (`bytes <at>-...`).
fn starts_at(content_range: Option<&str>, at: u64) -> bool {
    content_range
        .and_then(|v| v.trim().strip_prefix("bytes"))
        .map(str::trim_start)
        .and_then(|v| v.split('-').next())
        .and_then(|n| n.trim().parse::<u64>().ok())
        == Some(at)
}

/// Append `body` to the `.part` file from byte `from` (0 starts it again). Never writes past the model's size.
fn receive(
    spec: &ModelSpec,
    part: &Path,
    from: u64,
    mut body: Box<dyn Read + Send>,
    policy: &Policy,
    progress: &dyn Fn(u64, u64),
) -> std::result::Result<(), Pass> {
    let disk = |e: std::io::Error| {
        Pass::Stop(Error::ModelFetch(format!(
            "writing {}: {e}",
            part.display()
        )))
    };
    let mut options = std::fs::OpenOptions::new();
    if from == 0 {
        options.write(true).create(true).truncate(true);
    } else {
        options.append(true);
    }
    let mut file = options.open(part).map_err(disk)?;
    let mut done = from;
    let mut reported = from;
    let mut block = vec![0_u8; 1 << 16];
    loop {
        let n = match body.read(&mut block) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = file.flush();
                return Err(Pass::Again(format!(
                    "the connection stopped at byte {done}: {e}"
                )));
            }
        };
        if done + n as u64 > spec.size {
            drop(file);
            let _ = std::fs::remove_file(part);
            return Err(Pass::Stop(Error::ModelMismatch(format!(
                "{} is larger than its {} bytes",
                spec.file, spec.size
            ))));
        }
        file.write_all(&block[..n]).map_err(disk)?;
        done += n as u64;
        if done - reported >= policy.report_every || done == spec.size {
            reported = done;
            progress(done, spec.size);
        }
    }
    file.flush().map_err(disk)?;
    if done < spec.size {
        return Err(Pass::Again(format!(
            "the connection closed at byte {done} of {}",
            spec.size
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod testing {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    /// What a scripted server does with one request.
    pub(crate) type Step = Box<dyn Fn(&Url, u64) -> std::result::Result<Reply, String> + Send>;

    /// A server that answers from a script and remembers what it was asked.
    #[derive(Default)]
    pub(crate) struct Scripted {
        steps: Mutex<VecDeque<Step>>,
        pub(crate) asked: Mutex<Vec<(String, u64)>>,
    }

    impl Scripted {
        pub(crate) fn new(steps: Vec<Step>) -> Self {
            Self {
                steps: Mutex::new(steps.into()),
                asked: Mutex::default(),
            }
        }

        pub(crate) fn asked(&self) -> Vec<(String, u64)> {
            self.asked.lock().unwrap().clone()
        }
    }

    impl Transport for Scripted {
        fn get(&self, url: &Url, from: u64) -> std::result::Result<Reply, String> {
            self.asked.lock().unwrap().push((url.to_string(), from));
            let step = self.steps.lock().unwrap().pop_front();
            match step {
                Some(step) => step(url, from),
                None => Err("the script is over".into()),
            }
        }
    }

    /// A body that gives `bytes` and then fails like a cut connection.
    struct Cut(std::io::Cursor<Vec<u8>>);

    impl Read for Cut {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            match self.0.read(buf)? {
                0 => Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionReset,
                    "connection reset by peer",
                )),
                n => Ok(n),
            }
        }
    }

    fn reply(status: u16, body: Vec<u8>) -> Reply {
        Reply {
            status,
            location: None,
            content_range: None,
            body: Box::new(std::io::Cursor::new(body)),
        }
    }

    /// The whole of `content`, or its rest from the asked byte as a 206: a server that honours ranges.
    pub(crate) fn serve(content: &[u8]) -> Step {
        let content = content.to_vec();
        Box::new(move |_, from| {
            #[allow(clippy::cast_possible_truncation)]
            let at = from as usize;
            if from == 0 {
                Ok(reply(200, content.clone()))
            } else {
                Ok(Reply {
                    content_range: Some(format!(
                        "bytes {from}-{}/{}",
                        content.len() - 1,
                        content.len()
                    )),
                    ..reply(206, content[at..].to_vec())
                })
            }
        })
    }

    /// Like [`serve`], but the connection is cut after `keep` bytes of the body.
    pub(crate) fn serve_then_cut(content: &[u8], keep: usize) -> Step {
        let content = content.to_vec();
        Box::new(move |_, from| {
            #[allow(clippy::cast_possible_truncation)]
            let at = from as usize;
            let end = (at + keep).min(content.len());
            Ok(Reply {
                status: if from == 0 { 200 } else { 206 },
                location: None,
                content_range: (from > 0)
                    .then(|| format!("bytes {from}-{}/{}", content.len() - 1, content.len())),
                body: Box::new(Cut(std::io::Cursor::new(content[at..end].to_vec()))),
            })
        })
    }

    pub(crate) fn status(code: u16) -> Step {
        Box::new(move |_, _| Ok(reply(code, Vec::new())))
    }

    pub(crate) fn redirect(to: &str) -> Step {
        let to = to.to_owned();
        Box::new(move |_, _| {
            Ok(Reply {
                location: Some(to.clone()),
                ..reply(302, Vec::new())
            })
        })
    }

    pub(crate) fn unreachable() -> Step {
        Box::new(|_, _| Err("no route to host".into()))
    }

    /// A policy for tests: no pause between tries, progress on every block.
    pub(crate) fn quick() -> Policy {
        Policy {
            backoff: Duration::ZERO,
            report_every: 1,
            ..Policy::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::testing::*;
    use super::*;
    use crate::model::testing::spec_for;

    /// A model of 300 000 bytes that is not all one value.
    fn content() -> Vec<u8> {
        #[allow(clippy::cast_possible_truncation)]
        (0..300_000_u32).map(|i| (i * 31 % 251) as u8).collect()
    }

    fn run(spec: &ModelSpec, dir: &Path, server: &Scripted) -> (Result<()>, Vec<(u64, u64)>) {
        let seen = Mutex::new(Vec::new());
        let result = fetch(spec, dir, server, &quick(), &|done, total| {
            seen.lock().unwrap().push((done, total));
        });
        (result, seen.into_inner().unwrap())
    }

    #[test]
    fn a_whole_fetch_is_hashed_and_only_then_given_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        let server = Scripted::new(vec![serve(&bytes)]);
        let (result, progress) = run(&spec, &dir.path().join("speech"), &server);
        result.unwrap();
        let dir = dir.path().join("speech");
        assert_eq!(std::fs::read(spec.path(&dir)).unwrap(), bytes);
        assert!(!spec.part_path(&dir).exists(), "the part became the model");
        assert_eq!(server.asked(), vec![(spec.url.to_owned(), 0)]);
        // progress only grows, and ends at the whole
        assert!(
            progress.windows(2).all(|w| w[0].0 <= w[1].0),
            "{progress:?}"
        );
        assert_eq!(progress.last(), Some(&(spec.size, spec.size)));
        assert_eq!(progress.first(), Some(&(0, spec.size)));

        // already there: nothing is asked
        let idle = Scripted::new(vec![]);
        let (again, _) = run(&spec, &dir, &idle);
        again.unwrap();
        assert!(idle.asked().is_empty());
    }

    #[test]
    fn a_cut_connection_goes_on_from_the_byte_it_stopped_at() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        let server = Scripted::new(vec![
            serve_then_cut(&bytes, 100_000),
            serve_then_cut(&bytes, 50_000),
            serve(&bytes),
        ]);
        let (result, progress) = run(&spec, dir.path(), &server);
        result.unwrap();
        assert_eq!(std::fs::read(spec.path(dir.path())).unwrap(), bytes);
        let from: Vec<u64> = server.asked().iter().map(|(_, f)| *f).collect();
        assert_eq!(
            from,
            vec![0, 100_000, 150_000],
            "each try asks for the rest only"
        );
        assert!(
            progress.windows(2).all(|w| w[0].0 <= w[1].0),
            "progress never goes back"
        );
    }

    #[test]
    fn what_arrived_survives_a_failed_fetch_and_the_next_one_finishes_it() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        // one cut, then the network is gone for good
        let server = Scripted::new(vec![
            serve_then_cut(&bytes, 120_000),
            unreachable(),
            unreachable(),
            unreachable(),
        ]);
        let (result, _) = run(&spec, dir.path(), &server);
        let e = result.unwrap_err();
        assert!(matches!(e, Error::ModelFetch(_)), "{e:?}");
        assert_eq!(e.reason().as_str(), "model-download-failed");
        assert_eq!(
            server.asked().len(),
            4,
            "three tries in a row brought nothing"
        );
        assert!(
            !spec.path(dir.path()).exists(),
            "no model until the hash matches"
        );
        assert_eq!(
            std::fs::metadata(spec.part_path(dir.path())).unwrap().len(),
            120_000
        );

        // later (another press, another run of the app): only the rest is asked
        let later = Scripted::new(vec![serve(&bytes)]);
        let (result, progress) = run(&spec, dir.path(), &later);
        result.unwrap();
        assert_eq!(later.asked(), vec![(spec.url.to_owned(), 120_000)]);
        assert_eq!(progress.first(), Some(&(120_000, spec.size)));
        assert_eq!(std::fs::read(spec.path(dir.path())).unwrap(), bytes);
    }

    #[test]
    fn the_wrong_bytes_are_deleted_and_never_get_the_models_name() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        let mut wrong = bytes.clone();
        wrong[1234] ^= 1;
        let server = Scripted::new(vec![serve(&wrong)]);
        let (result, _) = run(&spec, dir.path(), &server);
        let e = result.unwrap_err();
        assert!(matches!(e, Error::ModelMismatch(_)), "{e:?}");
        assert_eq!(e.reason().as_str(), "model-download-failed");
        assert!(!spec.path(dir.path()).exists());
        assert!(
            !spec.part_path(dir.path()).exists(),
            "the wrong file is deleted"
        );
        assert_eq!(
            server.asked().len(),
            1,
            "a wrong hash is not tried again by itself"
        );
    }

    #[test]
    fn more_bytes_than_the_model_has_are_never_written() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        let mut long = bytes.clone();
        long.extend(std::iter::repeat_n(7, 100_000));
        let server = Scripted::new(vec![serve(&long)]);
        let (result, _) = run(&spec, dir.path(), &server);
        assert!(matches!(result, Err(Error::ModelMismatch(_))), "{result:?}");
        assert!(!spec.part_path(dir.path()).exists());
        assert!(!spec.path(dir.path()).exists());
    }

    #[test]
    fn a_server_that_ignores_the_range_starts_the_file_again() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        let whole = bytes.clone();
        let server = Scripted::new(vec![
            serve_then_cut(&bytes, 90_000),
            // asked for byte 90 000 on, it sends everything with a 200
            Box::new(move |_, _| {
                Ok(Reply {
                    status: 200,
                    location: None,
                    content_range: None,
                    body: Box::new(std::io::Cursor::new(whole.clone())),
                })
            }),
        ]);
        let (result, _) = run(&spec, dir.path(), &server);
        result.unwrap();
        assert_eq!(
            std::fs::read(spec.path(dir.path())).unwrap(),
            bytes,
            "not 90 000 bytes twice"
        );
    }

    #[test]
    fn a_part_that_cannot_be_continued_is_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = content();
        let spec = spec_for(&bytes);
        // a part from some other file, longer than the model: not a part of it
        std::fs::write(spec.part_path(dir.path()), vec![1_u8; 400_000]).unwrap();
        let server = Scripted::new(vec![serve(&bytes)]);
        run(&spec, dir.path(), &server).0.unwrap();
        assert_eq!(server.asked()[0].1, 0);

        // a 416 to a range: start again
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(spec.part_path(dir.path()), &bytes[..1000]).unwrap();
        let server = Scripted::new(vec![status(416), serve(&bytes)]);
        run(&spec, dir.path(), &server).0.unwrap();
        let from: Vec<u64> = server.asked().iter().map(|(_, f)| *f).collect();
        assert_eq!(from, vec![1000, 0]);

        // a stale part of the right length and the wrong content is caught by the hash
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(spec.part_path(dir.path()), vec![9_u8; bytes.len()]).unwrap();
        let server = Scripted::new(vec![]);
        let (result, _) = run(&spec, dir.path(), &server);
        assert!(matches!(result, Err(Error::ModelMismatch(_))));
        assert!(!spec.part_path(dir.path()).exists());
    }

    #[test]
    fn redirects_are_followed_only_to_the_repositorys_hosts() {
        let bytes = content();
        let spec = spec_for(&bytes);

        // the repository's own content host: followed, the range carried along
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(spec.part_path(dir.path()), &bytes[..10]).unwrap();
        let server = Scripted::new(vec![
            redirect("https://us.aws.cdn.hf.co/xet/abc?sig=1"),
            serve(&bytes),
        ]);
        run(&spec, dir.path(), &server).0.unwrap();
        assert_eq!(
            server.asked(),
            vec![
                (spec.url.to_owned(), 10),
                ("https://us.aws.cdn.hf.co/xet/abc?sig=1".to_owned(), 10)
            ]
        );

        // anywhere else, plain http, or credentials in the address: refused before a request is made
        for bad in [
            "https://example.com/ggml-test.bin",
            "http://huggingface.co/ggml-test.bin",
            "https://user:pw@huggingface.co/ggml-test.bin",
            "http://127.0.0.1:9/ggml-test.bin",
            "file:///etc/passwd",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let server = Scripted::new(vec![redirect(bad), serve(&bytes)]);
            let (result, _) = run(&spec, dir.path(), &server);
            assert!(
                matches!(result, Err(Error::ModelFetch(_))),
                "{bad}: {result:?}"
            );
            assert_eq!(server.asked().len(), 1, "{bad} was asked");
            assert!(!spec.path(dir.path()).exists());
        }

        // a loop of redirects ends
        let dir = tempfile::tempdir().unwrap();
        let server = Scripted::new((0..10).map(|_| redirect(spec.url)).collect());
        let (result, _) = run(&spec, dir.path(), &server);
        assert!(matches!(result, Err(Error::ModelFetch(_))));
        assert_eq!(
            server.asked().len(),
            6,
            "the first request and five redirects"
        );
    }

    #[test]
    fn a_file_that_is_not_there_fails_at_once_and_a_busy_server_is_tried_again() {
        let bytes = content();
        let spec = spec_for(&bytes);
        let dir = tempfile::tempdir().unwrap();
        let server = Scripted::new(vec![status(404), serve(&bytes)]);
        let (result, _) = run(&spec, dir.path(), &server);
        assert!(matches!(result, Err(Error::ModelFetch(_))));
        assert_eq!(server.asked().len(), 1);

        let server = Scripted::new(vec![status(503), status(429), serve(&bytes)]);
        run(&spec, dir.path(), &server).0.unwrap();
        assert_eq!(server.asked().len(), 3);
    }

    #[test]
    fn a_content_range_is_read_by_its_first_byte() {
        assert!(starts_at(Some("bytes 100-999/1000"), 100));
        assert!(starts_at(Some("bytes  100-999/*"), 100));
        assert!(!starts_at(Some("bytes 0-999/1000"), 100));
        assert!(!starts_at(Some("items 100-999/1000"), 100));
        assert!(!starts_at(None, 100));
    }
}
