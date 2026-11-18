# How hx uses hx-pack

`hx` registers `hx_pack::PackHandler` (an `hx-proto` `Handler`, namespace `pack`) in `hx::build_dispatcher`:

```rust
let cache = Arc::new(WalkCache::default());
dispatcher.register(Arc::new(InvalidatingHandler::new(TxnHandler::new(), cache.clone())))?;
dispatcher.register(Arc::new(PackHandler::new(cache)))?;
```

`InvalidatingHandler` (in `hx`) clears the cache after every `txn.apply`, `txn.restore`, `txn.recover` and `txn.discard`. `hx describe` and `hx.describe` list the methods (`methods`) and the capabilities (`pack.search` ... `pack.bundle`, `pack.redact`, `pack.never_pack`, `pack.walk_cache`, `pack.lang.<id>`). `hx pack <method> --json <file|->` runs one method from a shell.

## Methods

| method | params | result |
|---|---|---|
| `pack.search` | `hx_pack::SearchRequest` | `SearchResponse` |
| `pack.read` | `ReadRequest` | `ReadResponse` |
| `pack.symbol` | `SymbolRequest` | `SymbolResponse` |
| `pack.outline` | `OutlineRequest` | `OutlineResponse` |
| `pack.status` | `StatusRequest` | `StatusResponse` |
| `pack.bundle` | `BundleRequest` | `BundleResponse` |

Requests carry `root`; unknown fields are ignored. A `pack.bundle` item is `{ "method": "pack.search", "params": { ... } }` with the same params as the method, minus `root`. The schemas are in `hx-proto/schema/hx-v1.schema.json`, built by `hx::schema` from `hx_pack::add_schema`; after changing a pack type run `cargo test -p hx -- --ignored bless_schema`.

## Errors

`hx_pack::Error` converts to `hx_proto::AppError` with the catalog code (`Error::code`), so the wire error is `{code: -32000, data: {code: "hx.pack.path_escape"}}`. The codes are in `crates/hx-proto/errors.json`: `hx.pack.invalid_request`, `invalid_pattern`, `invalid_root`, `path_escape`, `not_found`, `unsupported_language`, `parse_failed`, `git_failed`, `timeout`, `config_invalid`, `io`. A cancelled call answers the shared `hx.cancelled`; pack changes nothing, so that is always true. A test checks that the crate's list and the catalog agree.

Tool outcomes are **not** errors: a withheld, binary or oversized file, a symbol with no match, a path outside a git repository and a truncated result are normal results. In a bundle a failing item carries its own `{ok: false, error}`; only `hx.pack.timeout` and `hx.cancelled` abort the call.

## Logging

`hx_pack::LogRedactor` implements `hx_proto::log::Redactor` with the embedded rules, and `hx` passes it to the logger instead of `NoRules`. `hx` refuses to start logging if the rules do not load.

## Data files shared with Python

`redact.rules.json` and `never_pack.json` are read by the plugin from this crate's directory (or one build-time copy, never retyped). Both carry `schema_version`. `redact.rules.json` has an `examples` array to run as conformance tests.
