# hx

The binary the hypotaxis Hermes plugin drives. One warm `hx serve` child per Hermes process speaks JSON-RPC 2.0 over stdio; the same methods are available as one-shot subcommands for debugging and tests.

```sh
hx serve [--max-concurrency N] [--log-file PATH] [--log-level FILTER]
hx describe
hx schema                                  # the hx-v1 JSON Schema
hx txn validate|apply|restore|discard|recover --json <file|->
```

One-shot commands print one JSON-RPC response on stdout and exit 0 for a result, 1 for an error.

## Public API (library)

| Item | What |
|---|---|
| `build_dispatcher()` | registers every handler crate (`hx-txn` now; `hx-pack` and `hx-sandbox` register here) |
| `serve::serve(reader, writer, dispatcher, opts, shutdown)` | the stdio server over any async reader and writer |
| `serve::ServeOptions` | `max_concurrency`, `max_pending`, `max_frame_bytes` |
| `oneshot::run(...)` | runs one method through the same dispatcher |

## Invariants

- **Stdout carries protocol frames only.** Logs go to `--log-file` (JSON lines, rotated at 10 MiB, 5 kept) or to stderr.
- **Bounded concurrency.** At most `max_concurrency` requests run at once; the rest queue (up to `max_pending`, then `hx.overloaded`).
- **Cancellation.** `$/cancelRequest {id}` cancels a request. A queued request is answered `hx.cancelled` without running. A running one is told through its token, and its handler answers `hx.cancelled` only if it changed nothing. The server never drops a running handler, so a response always tells the truth.
- **Graceful shutdown.** On stdin EOF the server stops reading, lets accepted requests finish and answer, flushes, and exits 0. SIGINT and SIGTERM also cancel what is running.
- **A panicking handler** becomes `hx.internal_error`; the server keeps serving.
- Frames are capped (64 MiB by default); an oversized frame is answered `hx.frame_too_large` and the stream resynchronises.
- Batches are not supported (`hx.invalid_request`).

## Testing

`tests/serve.rs` drives the server over in-memory pipes with a gated test handler (concurrency, cancel, queueing, EOF, panics, oversized frames). `tests/cli.rs` runs the real binary.
