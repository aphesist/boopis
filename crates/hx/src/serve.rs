//! The stdio server: newline-delimited JSON-RPC 2.0, concurrent and cancellable.
//!
//! - **Stdout carries protocol frames only.** Responses are written by a single task, one frame
//!   per line, so frames never interleave.
//! - **Bounded concurrency.** At most `max_concurrency` requests run at once; more wait in a
//!   queue capped at `max_pending`, beyond which a request is answered `hx.overloaded`.
//! - **Cancellation.** `$/cancelRequest {id}` cancels a request. A queued request is answered
//!   `hx.cancelled` without running. A running one is told through its token; handlers answer
//!   `hx.cancelled` only if they changed nothing (see `hx_proto::registry`).
//! - **Graceful shutdown.** On input EOF the server stops reading, lets every accepted request
//!   finish and answer, flushes, and returns. A shutdown token (SIGINT/SIGTERM) additionally
//!   cancels what is running and queued.
//! - A handler that panics is answered `hx.internal_error`; the server keeps serving.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use hx_proto::jsonrpc::parse_request;
use hx_proto::method::CANCEL_REQUEST;
use hx_proto::{AppError, Dispatcher, Id, Request, Response, codes};
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt,
};
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

/// Tuning for [`serve`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServeOptions {
    /// Requests that run at once.
    pub max_concurrency: usize,
    /// Requests accepted but not yet answered (running plus queued).
    pub max_pending: usize,
    /// The longest accepted frame, in bytes.
    pub max_frame_bytes: usize,
}

impl Default for ServeOptions {
    fn default() -> Self {
        let cpus = std::thread::available_parallelism().map_or(4, std::num::NonZero::get);
        Self {
            max_concurrency: cpus.clamp(2, 16),
            max_pending: 1024,
            max_frame_bytes: 64 * 1024 * 1024,
        }
    }
}

enum Frame {
    Line(Vec<u8>),
    TooLong,
}

/// Reads one frame without ever buffering more than `max` bytes. Returns `None` at EOF.
async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> io::Result<Option<Frame>> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let room = (max + 1).saturating_sub(buf.len()) as u64;
        let n = AsyncReadExt::take(&mut *reader, room)
            .read_until(b'\n', &mut buf)
            .await?;
        if n == 0 {
            return Ok((!buf.is_empty()).then_some(Frame::Line(buf)));
        }
        if buf.ends_with(b"\n") {
            buf.pop();
            return Ok(Some(Frame::Line(buf)));
        }
        if buf.len() > max {
            // Drop the rest of the oversized line so the next frame starts clean.
            loop {
                let chunk = reader.fill_buf().await?;
                if chunk.is_empty() {
                    break;
                }
                let newline = chunk.iter().position(|&b| b == b'\n');
                let len = chunk.len();
                reader.consume(newline.map_or(len, |i| i + 1));
                if newline.is_some() {
                    break;
                }
            }
            return Ok(Some(Frame::TooLong));
        }
    }
}

type InFlight = Arc<Mutex<HashMap<Id, CancellationToken>>>;

struct Shared {
    dispatcher: Arc<Dispatcher>,
    permits: Arc<Semaphore>,
    inflight: InFlight,
    pending: Arc<AtomicUsize>,
    out: mpsc::Sender<String>,
    shutdown: CancellationToken,
    opts: ServeOptions,
}

impl Shared {
    async fn send(&self, response: &Response) {
        match response.to_frame() {
            Ok(frame) => {
                // A closed channel means the writer failed and shutdown is under way.
                let _ = self.out.send(frame).await;
            }
            Err(e) => tracing::error!(error = %e, "response could not be serialised"),
        }
    }

    async fn handle_line(&self, bytes: Vec<u8>, tasks: &mut JoinSet<()>) {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return;
        }
        let parsed = match String::from_utf8(bytes) {
            Ok(text) => parse_request(&text),
            Err(_) => Err((
                None,
                AppError::new(codes::HX_PARSE_ERROR, "the frame is not valid UTF-8"),
            )),
        };
        match parsed {
            Err((id, err)) => self.send(&Response::err(id, &err)).await,
            Ok(req) if req.is_notification() => self.notification(&req),
            Ok(req) => self.request(req, tasks).await,
        }
    }

    fn notification(&self, req: &Request) {
        if req.method != CANCEL_REQUEST {
            tracing::debug!(method = %req.method, "ignoring notification");
            return;
        }
        let id = req
            .params
            .as_ref()
            .and_then(|p| p.get("id"))
            .and_then(|v| serde_json::from_value::<Id>(v.clone()).ok());
        let token = id.and_then(|id| {
            self.inflight
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(&id)
                .cloned()
        });
        if let Some(token) = token {
            token.cancel();
        }
    }

    async fn request(&self, req: Request, tasks: &mut JoinSet<()>) {
        let Some(id) = req.id.clone() else { return };
        if self.pending.fetch_add(1, Ordering::SeqCst) >= self.opts.max_pending {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            let err = AppError::new(codes::HX_OVERLOADED, "too many requests are pending");
            return self.send(&Response::err(Some(id), &err)).await;
        }
        let token = self.shutdown.child_token();
        let duplicate = {
            let mut map = self.inflight.lock().unwrap_or_else(PoisonError::into_inner);
            let duplicate = map.contains_key(&id);
            if !duplicate {
                map.insert(id.clone(), token.clone());
            }
            duplicate
        };
        if duplicate {
            self.pending.fetch_sub(1, Ordering::SeqCst);
            let err = AppError::new(
                codes::HX_INVALID_REQUEST,
                "a request with this id is already in flight",
            );
            return self.send(&Response::err(Some(id), &err)).await;
        }
        let ctx = Arc::new(Task {
            dispatcher: Arc::clone(&self.dispatcher),
            permits: Arc::clone(&self.permits),
            out: self.out.clone(),
        });
        let (inflight, pending) = (Arc::clone(&self.inflight), Arc::clone(&self.pending));
        tasks.spawn(async move {
            let response = ctx.run(req, &id, token).await;
            inflight
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            pending.fetch_sub(1, Ordering::SeqCst);
            if let Ok(frame) = response.to_frame() {
                let _ = ctx.out.send(frame).await;
            }
        });
    }
}

struct Task {
    dispatcher: Arc<Dispatcher>,
    permits: Arc<Semaphore>,
    out: mpsc::Sender<String>,
}

impl Task {
    async fn run(&self, req: Request, id: &Id, token: CancellationToken) -> Response {
        let permit = tokio::select! {
            biased;
            () = token.cancelled() => return Response::err(Some(id.clone()), &AppError::cancelled()),
            permit = Arc::clone(&self.permits).acquire_owned() => permit,
        };
        let Ok(_permit) = permit else {
            return Response::err(
                Some(id.clone()),
                &AppError::internal("the server is shutting down"),
            );
        };
        // Run the handler as its own task so that a panic becomes an error response.
        let dispatcher = Arc::clone(&self.dispatcher);
        let handle = tokio::spawn(async move { dispatcher.handle(req, token).await });
        match handle.await {
            Ok(response) => response,
            Err(e) => {
                tracing::error!(error = %e, "a handler panicked");
                Response::err(
                    Some(id.clone()),
                    &AppError::internal("the handler failed unexpectedly"),
                )
            }
        }
    }
}

async fn write_loop<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut rx: mpsc::Receiver<String>,
    shutdown: CancellationToken,
) -> io::Result<()> {
    while let Some(frame) = rx.recv().await {
        let result = async {
            writer.write_all(frame.as_bytes()).await?;
            writer.write_all(b"\n").await?;
            writer.flush().await
        }
        .await;
        if let Err(e) = result {
            // The reader of our output is gone: nobody can hear answers any more.
            shutdown.cancel();
            return Err(e);
        }
    }
    writer.flush().await
}

/// Serves requests from `reader`, answering on `writer`, until EOF or `shutdown`.
///
/// # Errors
/// Reading the input or writing the output fails.
pub async fn serve<R, W>(
    reader: R,
    writer: W,
    dispatcher: Arc<Dispatcher>,
    opts: ServeOptions,
    shutdown: CancellationToken,
) -> io::Result<()>
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (out, rx) = mpsc::channel::<String>(256);
    let writer_task = tokio::spawn(write_loop(writer, rx, shutdown.clone()));

    // Frames are read on their own task so that shutdown never interrupts a half-read frame.
    let (frames_tx, mut frames) = mpsc::channel::<io::Result<Frame>>(64);
    let max_frame = opts.max_frame_bytes;
    let reader_task = tokio::spawn(async move {
        let mut reader = tokio::io::BufReader::new(reader);
        loop {
            match read_frame(&mut reader, max_frame).await {
                Ok(Some(frame)) => {
                    if frames_tx.send(Ok(frame)).await.is_err() {
                        return;
                    }
                }
                Ok(None) => return,
                Err(e) => {
                    let _ = frames_tx.send(Err(e)).await;
                    return;
                }
            }
        }
    });

    let shared = Shared {
        dispatcher,
        permits: Arc::new(Semaphore::new(opts.max_concurrency.max(1))),
        inflight: Arc::default(),
        pending: Arc::default(),
        out: out.clone(),
        shutdown: shutdown.clone(),
        opts,
    };
    let mut tasks = JoinSet::new();
    let mut read_error = None;
    loop {
        tokio::select! {
            () = shutdown.cancelled() => break,
            frame = frames.recv() => match frame {
                None => break, // EOF
                Some(Ok(Frame::Line(bytes))) => shared.handle_line(bytes, &mut tasks).await,
                Some(Ok(Frame::TooLong)) => {
                    let err = AppError::new(codes::HX_FRAME_TOO_LARGE, "the request frame exceeds the maximum size");
                    shared.send(&Response::err(None, &err)).await;
                }
                Some(Err(e)) => {
                    read_error = Some(e);
                    break;
                }
            },
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
    reader_task.abort();

    // Graceful: every accepted request still gets its answer.
    while tasks.join_next().await.is_some() {}
    drop(shared);
    drop(out);
    let written = writer_task
        .await
        .unwrap_or_else(|e| Err(io::Error::other(e)));
    match read_error {
        Some(e) => Err(e),
        None => written,
    }
}
