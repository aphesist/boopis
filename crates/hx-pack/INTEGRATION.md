# Registering hx-pack in the dispatcher

`hx-pack` knows nothing about JSON-RPC. The `hx` binary (and `hx-proto`'s dispatcher) registers one handler per method.

## Methods and handlers

| method name | params type | handler | result type |
|---|---|---|---|
| `pack.search` | `hx_pack::SearchRequest` | `hx_pack::handle_search` | `SearchResponse` |
| `pack.read` | `hx_pack::ReadRequest` | `hx_pack::handle_read` | `ReadResponse` |
| `pack.symbol` | `hx_pack::SymbolRequest` | `hx_pack::handle_symbol` | `SymbolResponse` |
| `pack.outline` | `hx_pack::OutlineRequest` | `hx_pack::handle_outline` | `OutlineResponse` |
| `pack.status` | `hx_pack::StatusRequest` | `hx_pack::handle_status` | `StatusResponse` |
| `pack.bundle` | `hx_pack::BundleRequest` | `hx_pack::handle_bundle` | `BundleResponse` |

`hx_pack::METHODS` lists the names. Every request type is `Deserialize + JsonSchema` and every response is `Serialize + JsonSchema`. Requests ignore unknown fields (wire rule). `root` is a field of every request; the plugin sends the session's workspace root.

Handlers are synchronous and may take hundreds of milliseconds, so call them off the async executor:

```rust
// Shape only: adapt it to hx-proto's Handler trait.
async fn pack_search(params: Value, cancel: CancellationToken) -> Result<Value, RpcError> {
    let req: hx_pack::SearchRequest = serde_json::from_value(params).map_err(invalid_params)?;
    let flag = Arc::new(AtomicBool::new(false));
    let ctl = hx_pack::Control::none()
        .with_cancel(Arc::clone(&flag))
        .with_deadline(Instant::now() + Duration::from_secs(30));
    // Turn the async cancellation token into the flag the blocking code polls.
    let watcher = tokio::spawn({
        let flag = Arc::clone(&flag);
        async move {
            cancel.cancelled().await;
            flag.store(true, Ordering::Relaxed);
        }
    });
    let out = tokio::task::spawn_blocking(move || hx_pack::handle_search_with(&req, &ctl)).await;
    watcher.abort();
    Ok(serde_json::to_value(out??)?)
}
```

`handle_search_with`, `handle_symbol_with`, `handle_outline_with` and `handle_bundle_with` take the `Control`. `handle_read` and `handle_status` are short and have their own limits (`status` has `timeout_ms`).

## Errors

On failure, map `hx_pack::Error` to the wire error with the string code in `data.code`:

```rust
let body = err.to_body();            // { code: "hx.pack.path_escape", message: "..." }
// JSON-RPC: code -32000, message = body.message, data = { code: body.code }
```

`Error::code()` gives the code and `Error::ALL_CODES` lists them. The codes `crates/hx-proto/errors.json` needs are in `crates/hx-pack/error_codes.json` (same text below). Malformed JSON params are the dispatcher's own `-32602`, not a pack error.

| code | when |
|---|---|
| `hx.pack.invalid_request` | a parameter is out of range or malformed (empty pattern, zero budget, bad line range, bad glob, a directory given to `pack.read`) |
| `hx.pack.invalid_pattern` | the search pattern does not compile |
| `hx.pack.invalid_root` | `root` is not an existing directory |
| `hx.pack.path_escape` | a path is absolute, has `..`, or resolves through a symlink outside `root` |
| `hx.pack.not_found` | a named file or directory does not exist under `root` |
| `hx.pack.unsupported_language` | `lang` was given and no grammar is registered for it |
| `hx.pack.parse_failed` | tree-sitter produced no tree |
| `hx.pack.git_failed` | `git` is missing, failed, or printed unparseable output |
| `hx.pack.timeout` | the `Control` deadline passed, or `git` ran past `timeout_ms` |
| `hx.pack.cancelled` | the `Control` cancel flag was set |
| `hx.pack.config_invalid` | an embedded data file or query failed to load (fails closed) |
| `hx.pack.io` | an unexpected OS error while reading under `root` |

Tool outcomes are **not** errors: a withheld, binary or oversized file, a symbol with no match, a path outside a git repository and a truncated result all come back as a normal result. In a bundle, a failing item carries its own `{ok: false, error: {code, message}}` and does not fail the call; only `timeout` and `cancelled` abort the whole bundle.

## Capability and contract

- Advertise a capability string such as `pack.v1` in the describe call; gate features on it.
- Feed `hx_pack::method_schemas()` to the OpenRPC generator for the params and result schemas of the six methods.
- `pack.bundle` items are `{ "method": "pack.search", "params": { ... } }` with the same params as the standalone method minus `root`, which the bundle supplies.

## Data files the Python plugin should read

`redact.rules.json` and `never_pack.json` are the shared sources. The plugin should read them from this crate's directory in the repository (or a copy made at build time by one script, never retyped). Both carry `schema_version`. `redact.rules.json` has an `examples` array to run as conformance tests.

## Two local copies to fold in

`paths.rs` (safe relative paths and the cap-std root) and `proc.rs` (child process with allowlisted environment, timeout and output cap) are local stand-ins for `hx-txn::paths` and `hx-sandbox::process` from the shared-modules table (`docs/STANDARDS.md` section 9). When those crates exist, delete the copies and re-export; the public surface of `hx-pack` does not mention either.
