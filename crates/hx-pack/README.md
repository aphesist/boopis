# hx-pack

The engine behind hypotaxis's `pack` tool. One call returns everything a model needs to read: search hits with surrounding code, whole files, line ranges, single symbols, outlines and git status. Output is byte-capped, secrets are redacted, and `.env` and key files are never returned.

It is a **pure library**: request and response types (`serde` + `schemars`), one `Error` enum whose variants map to `hx.pack.*` codes, and a `handle_*` function per method. The `hx` binary wires them to JSON-RPC (see `INTEGRATION.md`). Nothing here talks to a wire, a model or a terminal.

## API

| method | request | handler | what it returns |
|---|---|---|---|
| `pack.search` | `root, pattern, mode, case, globs, context_before, context_after, max_matches, max_bytes` | `handle_search` | blocks of numbered lines around matches, merged and in path order |
| `pack.read` | `root, path, ranges[]` | `handle_read` | a whole file or merged line ranges, numbered |
| `pack.symbol` | `root, name, path?, lang?` | `handle_symbol` | the full source of every definition with that name |
| `pack.outline` | `root, paths[]` | `handle_outline` | each symbol's kind, name, parent, signature and line range |
| `pack.status` | `root` | `handle_status` | branch, HEAD, upstream, changed paths and counts |
| `pack.bundle` | `root, requests[], max_bytes` | `handle_bundle` | any of the above in one call, sharing one byte budget |

Handlers block; call them from `spawn_blocking`. The `*_with` variants take a `Control` (cancel flag and deadline). `method_schemas()` returns the JSON Schema of every request and response for the OpenRPC contract. The full contract is in the rustdoc (`cargo doc -p hx-pack --open`).

Output text uses three numbered-line styles: `12:text` for a match, `12-text` for a context line (ripgrep's convention), `12|text` for plain source.

## Rules the code keeps

- **Paths cannot escape the root.** Absolute paths, `..`, drive prefixes and NUL are rejected lexically (`RelPath`). Every file is then opened through a `cap-std` directory handle, which refuses symlinks that leave the root even if one is swapped in after the check. Walks never follow symlinks. Globs may not name paths outside the root.
- **Never packed:** `.env*`, keys, certificates, credential files and similar, from `never_pack.json`. A file on the list is withheld even when a request names it, and the response says so (`withheld`, or `status: withheld` for `pack.read`). Withheld files are never opened.
- **Redaction:** patterns from `redact.rules.json` plus Shannon-entropy detection. Each hit becomes `[REDACTED:<rule>]` and is counted in `redactions`. A file is redacted **as a whole before it is sliced**, so a private key cut by a context window or a line range is still caught. Multi-line matches keep their newlines, so line numbers match the file on disk.
- **No probing.** `pack.search` finds candidate files on raw text, then redacts the file and searches again; only that second result is reported. A pattern cannot confirm a hidden secret one regex at a time. The price: the placeholder text itself is not searchable.
- **The budget is a hard cap.** Output is charged to a `Budget` before it is added; nothing is built and then cut. The cost of an item is its text plus 32 bytes plus its path. `bytes` in every response is the exact charge, and is at most `max_bytes`. A block that does not fit is cut at a line boundary, and `truncated` says why (`max_bytes`, `max_matches`, `max_items`, `line_clipped`).
- **Deterministic.** Results are the first N in path order whatever the thread timing: workers claim files in sorted order and the consumer reads a strictly ordered prefix, stopping once that prefix fills a limit.
- **Outcomes are not errors.** A withheld, binary or oversized file, a symbol with no match and a path that is not a repository are fields of a successful result. Errors are infrastructure failures with stable codes (`error_codes.json`).

## Redaction rules (`redact.rules.json`)

Shared with Python (`hypotaxis.util.redact`). Patterns use the subset common to Rust `regex` and Python `re`. A rule with a `(?P<secret>...)` group replaces only that group (`Bearer <token>`, `user:<password>@host`, `key = "<value>"`). `private_key_open` removes everything after a key header that has no footer. The file also carries `examples` (input and output pairs) that both implementations run as conformance tests.

The entropy pass looks at runs of `[A-Za-z0-9+/_-]` of 32 or more characters (`=` padding allowed) with at least 4.2 bits per character and all of upper case, lower case and digits. It leaves alone:
- files named like lockfiles (`Cargo.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, ...);
- lines that mention `integrity`, `checksum`, `sha512`, `sha256`, `digest`, `resolved` and the like;
- tokens that start with `sha512-`, `sha256-` and so on, and UUIDs;
- path-like tokens (two or more slashes, mostly lowercase words);
- pure hex tokens (hashes, git SHAs) unless the same line names a secret (`token`, `secret`, `password`, ...).

Tests run the entropy pass over this crate's source, the repository docs, the first-pass `pack.rs` and six generated lockfiles and require zero hits. Known limit: a hex secret on a line that does not name it is not caught, and an attacker who controls a file can put `integrity` on a line to opt it out. The goal is accidental leaks, not hostile content.

## Languages

`languages.json` maps extensions to a grammar and a query (`queries/*.scm`); the query marks definitions with `@definition.<kind>` and identifiers with `@name`. The registry also says which parent nodes belong to a definition (`export`, decorators) and which sibling nodes above it are part of it (doc comments, attributes), so `pack.symbol` returns a function with its docs.

Built in: Rust, TypeScript, TSX, JavaScript, Python, Go. To add one: add the grammar crate, a line in `languages::grammar`, a query file, and a JSON entry. Nothing in outline or symbol code names a language. Programs that embed the crate can also call `Registry::register` at run time.

Outlines skip definitions nested inside functions (locals), report a function inside a class, impl, trait or interface as a `method`, and set `parent` to the dotted chain of enclosing names (`Account.Meta`). Go methods take their receiver type as parent. A symbol request accepts `Type.method`, `Type::method` or a bare name.

Grammar cost: all five grammars plus the tree-sitter core add about 6 s of CPU to a clean debug build (the whole crate builds in about 30 s wall on 4 cores). TypeScript is the heavy one: its static library is 2.9 MB (it carries both the TS and TSX parsers), Rust 1.1 MB, Python 0.5 MB, JavaScript 0.4 MB, Go 0.2 MB.

## `pack.status` and `git`

It runs `git status --porcelain=v2 --branch -z` rather than linking `gix`. `git` is already required by the product (ship's checkpoint refs), its status is the reference output, and `gix`'s status support would add a large dependency tree and compile time for a call that takes a few milliseconds. The child gets an allowlisted environment (`PATH`, `HOME`, temp dirs, plus `LC_ALL=C`, no prompts, no optional locks), a timeout and an output cap, and `core.fsmonitor` is forced off (a test proves a repository's `fsmonitor` hook does not run). Not covered: clean and smudge filters named by an untrusted repository's own config. Call `pack.status` only on trusted workspaces.

## Performance

Measured on a 4-vCPU VM, release build, warm page cache, on a generated tree of 100,000 source files in 1,000 directories (plus 20,000 files under `node_modules` and `target` that the walk skips). Run it with:

```sh
cargo test -p hx-pack --release --test perf -- --ignored --nocapture
```

| call | p50 | p95 |
|---|---|---|
| rare literal, whole tree (reads all 100k files) | ~280 ms | 300 to 530 ms |
| common literal, `max_matches` 200 (stops early) | ~65 ms | ~75 ms |
| glob `src/mod_0420/**` (one directory) | ~3 ms | ~4 ms |
| rare literal, glob `*.go` | ~80 ms | ~100 ms |
| known file range | < 1 ms | < 1 ms |

The worst case (a rare pattern with no glob) must open every file. The walk costs about 57 ms; the rest is four syscalls per file (`openat2`, two `read`, `close`). It is as fast as `rg -l` on the same machine, so the floor is the kernel, not the code. The spread in p95 comes from the other jobs on that machine. Globs that name a directory start the walk there; globs filter names before any file is opened; a pattern with many hits stops as soon as the ordered prefix is full. Further wins need state kept between calls (a cached file list, a trigram index) and the invalidation rule that comes with it.

## Tests

```sh
cargo fmt --check
cargo clippy -p hx-pack --all-targets -- -D warnings
cargo test -p hx-pack
```

Unit tests sit beside the code. `tests/` holds integration tests per method, `insta` snapshots of outlines for every language (`tests/snapshots`), property tests (no path escapes; budgets never exceeded; redaction idempotent and line-preserving) and the ignored performance test. Fixtures are in `tests/fixtures`.

## Files

| file | role |
|---|---|
| `redact.rules.json` | redaction rules and entropy settings, shared with Python |
| `never_pack.json` | never-pack globs, shared with Python |
| `languages.json`, `queries/*.scm` | the language registry |
| `error_codes.json` | the `hx.pack.*` codes for `hx-proto/errors.json` |
| `INTEGRATION.md` | how to register the handlers |
