# hx-proto

The wire contract between the hypotaxis plugin (Python) and `hx` (Rust). Pure types and plumbing: no file access, no business logic.

## Public API

| Module | What |
|---|---|
| `jsonrpc` | JSON-RPC 2.0 framing, newline-delimited over stdio: `Request`, `Response`, `Notification`, `RpcError`, `Id`, `parse_request` |
| `error` | `AppError`, the catalog reader, and `codes::*` constants generated at build time from `errors.json` |
| `describe` | `hx.describe` result: `{version, protocol: "hx-v1", capabilities}` |
| `txn` | request and response types for `txn.validate`, `txn.apply`, `txn.restore`, `txn.discard`, `txn.recover` |
| `schema` | builds `schema/hx-v1.schema.json` from the types above |
| `registry` | the `Handler` trait and the `Dispatcher`; each crate registers its handlers |
| `method` | method names and the `Namespace` enum (`hx`, `txn`, `pack`, `sandbox`) |
| `log` | `tracing` JSON logging to a rotating file or stderr, through a `Redactor` |
| `time` | RFC 3339 UTC timestamps with milliseconds |

## Invariants

- **Stdout carries frames only.** Logging never writes to stdout.
- **Application errors are `-32000`** with the stable string code in `data.code`. Protocol errors keep the spec's numbers and also carry `data.code`.
- **The code list is one data file.** `errors.json` is the source; Rust constants are generated from it, Python reads the same file. Adding a code means editing that file only.
- **The schema is generated, never edited.** `schema/hx-v1.schema.json` comes from the Rust types. A test fails if it is stale. Update it with `cargo test -p hx-proto -- --ignored bless_schema`.
- **Wire types ignore unknown fields** on read. New fields are optional and additive; removing or renaming one is a new method name.
- **The dispatcher never drops a running handler.** Handlers poll `CallContext::cancel` at safe points and return `hx.cancelled` only when they have changed nothing, so a response always tells the truth.
- **Every log line passes the `Redactor`** before it is written. The rules come from `hx-pack`; this crate defines only the trait (and `NoRules`, for startup before the rules exist).

## Adding a method

1. Add the request and result types to a module here, deriving `Serialize`, `Deserialize` and `JsonSchema`.
2. Add the method to `schema::schema_document` and bless the schema.
3. Implement `Handler` in the owning crate and register it in the binary.
4. Add any new error codes to `errors.json`.

`pack.*` and `sandbox.*` are reserved namespaces. A handler can register only methods inside its declared namespace, and `hx.*` belongs to the dispatcher.
