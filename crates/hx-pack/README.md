# hx-pack

The engine behind boopis's `pack` tool. One call returns everything a model needs to read: search hits with surrounding code, whole files, line ranges, single symbols, outlines and git status. Output is byte-capped, secrets are redacted, and `.env` and key files are never returned.

Request and response types (`serde` + `schemars`), one `Error` enum whose variants map to catalog codes, a `handle_*` function per method, and `PackHandler`, the `hx-proto` `Handler` that `hx` registers under the `pack` namespace (see `INTEGRATION.md`). Nothing here talks to a wire, a model or a terminal; `hx` does the I/O.

## API

| method | request | handler | what it returns |
|---|---|---|---|
| `pack.search` | `root, pattern, mode, case, globs, context_before, context_after, max_matches, max_bytes` | `handle_search` | blocks of numbered lines around matches, merged and in path order |
| `pack.read` | `root, path, ranges[]` | `handle_read` | a whole file or merged line ranges, numbered |
| `pack.symbol` | `root, name, path?, lang?` | `handle_symbol` | the full source of every definition with that name |
| `pack.outline` | `root, paths[]` | `handle_outline` | each symbol's kind, name, parent, signature and line range |
| `pack.status` | `root` | `handle_status` | branch, HEAD, upstream, changed paths and counts |
| `pack.bundle` | `root, requests[], max_bytes` | `handle_bundle` | any of the above in one call, sharing one byte budget |

Handlers block; `PackHandler` runs them on the blocking pool. The `*_with` variants take a `Control`: a cancellation token, a deadline and an optional `WalkCache`. `add_schema` adds the six methods to the `hx-v1` schema. The full contract is in the rustdoc (`cargo doc -p hx-pack --open`).

Output text uses three numbered-line styles: `12:text` for a match, `12-text` for a context line (ripgrep's convention), `12|text` for plain source.

## Rules the code keeps

- **Paths cannot escape the root.** A requested path goes through `hx_txn::paths` (the shared safe-path module): absolute paths, `..`, drive prefixes and NUL are rejected, and symlinks are resolved inside the root and rejected if they leave it. Resolution returns the *canonical* path, so the never-pack check sees the real file even when a request names it through a link. Every file is then opened through a `cap-std` directory handle, which refuses to leave the root even if a link is swapped in after the check. Walks never follow symlinks. Globs may not name paths outside the root.
- **Never packed:** `.env*`, keys, certificates, credential files and similar, from `never_pack.json`. A file on the list is withheld even when a request names it, and the response says so (`withheld`, or `status: withheld` for `pack.read`). Withheld files are never opened. The one exception is a short allow list of templates, `.env.example`, `.env.sample` and `.env.template`, which are readable and still pass through redaction; every other `.env*` stays withheld.
- **Redaction:** patterns from `redact.rules.json` plus Shannon-entropy detection. Each hit becomes `[REDACTED:<rule>]` and is counted in `redactions`. A file is redacted **as a whole before it is sliced**, so a private key cut by a context window or a line range is still caught. Multi-line matches keep their newlines, so line numbers match the file on disk.
- **No probing.** `pack.search` finds candidate files on raw text, then redacts the file and searches again; only that second result is reported. A pattern cannot confirm a hidden secret one regex at a time. The price: the placeholder text itself is not searchable.
- **The budget is a hard cap.** Output is charged to a `Budget` before it is added; nothing is built and then cut. The cost of an item is its text plus 32 bytes plus its path. `bytes` in every response is the exact charge, and is at most `max_bytes`. A block that does not fit is cut at a line boundary, and `truncated` says why (`max_bytes`, `max_matches`, `max_items`, `line_clipped`).
- **Deterministic.** Results are the first N in path order whatever the thread timing: workers claim files in sorted order and the consumer reads a strictly ordered prefix, stopping once that prefix fills a limit.
- **Outcomes are not errors.** A withheld, binary or oversized file, a symbol with no match and a path that is not a repository are fields of a successful result. Errors are infrastructure failures with stable codes (`error_codes.json`).

## Redaction rules (`redact.rules.json`)

Shared with Python (`boopis.util.redact`). Patterns use the subset common to Rust `regex` and Python `re`. A rule with a `(?P<secret>...)` group replaces only that group (`Bearer <token>`, `user:<password>@host`, `key = "<value>"`). `private_key_open` removes everything after a key header that has no footer. The file also carries `examples` (input and output pairs) that both implementations run as conformance tests.

The entropy pass looks at runs of `[A-Za-z0-9+/_-]` of 32 or more characters (`=` padding allowed) with at least 4.2 bits per character and all of upper case, lower case and digits. It leaves alone:
- files named like lockfiles (`Cargo.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, ...);
- lines that mention `integrity`, `checksum`, `sha512`, `sha256`, `digest`, `resolved` and the like;
- tokens that start with `sha512-`, `sha256-` and so on, and UUIDs;
- path-like tokens (two or more slashes, mostly lowercase words);
- pure hex tokens (hashes, git SHAs) unless the same line names a secret (`token`, `secret`, `password`, ...).

`LogRedactor` applies the same rules to every `hx` log line. Tests run the entropy pass over this crate's source, the repository docs, the first-pass `pack.rs` and six generated lockfiles and require zero hits. Known limit: a hex secret on a line that does not name it is not caught, and an attacker who controls a file can put `integrity` on a line to opt it out. The goal is accidental leaks, not hostile content.

## Languages

`languages.json` maps extensions to a grammar and a query (`queries/*.scm`); the query marks definitions with `@definition.<kind>` and identifiers with `@name`. The registry also says which parent nodes belong to a definition (`export`, decorators) and which sibling nodes above it are part of it (doc comments, attributes), so `pack.symbol` returns a function with its docs.

Built in: Rust, TypeScript, TSX, JavaScript, Python, Go. To add one: add the grammar crate, a line in `languages::grammar`, a query file, and a JSON entry. Nothing in outline or symbol code names a language. Programs that embed the crate can also call `Registry::register` at run time.

Outlines skip definitions nested inside functions (locals), report a function inside a class, impl, trait or interface as a `method`, and set `parent` to the dotted chain of enclosing names (`Account.Meta`). Go methods take their receiver type as parent. A symbol request accepts `Type.method`, `Type::method` or a bare name.

Grammar cost: all five grammars plus the tree-sitter core add about 6 s of CPU to a clean debug build (the whole crate builds in about 30 s wall on 4 cores). TypeScript is the heavy one: its static library is 2.9 MB (it carries both the TS and TSX parsers), Rust 1.1 MB, Python 0.5 MB, JavaScript 0.4 MB, Go 0.2 MB.

## `pack.status` and `git`

It runs `git status --porcelain=v2 --branch -z` rather than linking `gix`. `git` is already required by the product (ship's checkpoint refs), its status is the reference output, and `gix`'s status support would add a large dependency tree and compile time for a call that takes a few milliseconds.

A repository's own configuration must not run a program through this call, so each call:
- lists the configured filter drivers (`git config --name-only --get-regexp '^filter\.'`) and switches each one off with `-c filter.<name>.clean= -c filter.<name>.smudge= -c filter.<name>.process= -c filter.<name>.required=false` (`status` runs clean filters to compare contents); a driver whose name cannot be passed that way fails the call;
- passes `-c core.fsmonitor=false` and `-c core.hooksPath=<fresh empty directory>`, `--no-optional-locks`, and sets `GIT_CONFIG_NOSYSTEM=1`;
- runs with an allowlisted environment, a timeout and an output cap (the stand-in `proc.rs`, which `hx-sandbox::process` will replace).

Tests use a repository whose filter and whose `fsmonitor` hook would write a marker file: a control proves plain `git status` writes it, and `pack.status` leaves no marker.

## The walk cache

`hx serve` keeps one `WalkCache` per process (`pack.walk_cache` capability). A whole-tree search, outline or symbol lookup (no directory-anchored glob) takes its file list from the cache when it is still valid. File contents are never cached.

An entry is valid only if all of these hold (the rule is also in `src/cache.rs`):
1. **No mutation:** `hx` clears the cache after every `txn.apply`, `txn.restore`, `txn.recover` and `txn.discard`, successful or not.
2. **Directory times:** the walk records the modification time of every directory and every `.gitignore`/`.ignore`/`.rgignore` (and `.git/info/exclude`); each is stat-ed again on access and any difference rejects the entry. About a millisecond per thousand directories.
3. **TTL:** 60 seconds.

A walk of a tree changed in the last two seconds is not stored, so a change in the same clock tick cannot hide. At most four roots are kept. The cache serves the same answer as a fresh walk; a test compares them for many globs.

## Performance

Measured on a 4-vCPU shared VM, release build, warm page cache, on a generated tree of 100,000 source files in 1,000 directories (plus 20,000 files under `node_modules` and `target` that the walk skips). Run it with:

```sh
cargo test -p hx-pack --release --test perf -- --ignored --nocapture
```

The machine was loaded by other jobs during every run (load average 3 to 5 on 4 cores), so the spread is wide. Figures are p50 / p95 over 20 runs after a warm-up:

| call | p50 | p95 |
|---|---|---|
| rare literal, whole tree, no cache (reads all 100k files) | 280 to 480 ms | 300 to 690 ms |
| rare literal, whole tree, warm walk cache | 260 to 355 ms | 335 to 505 ms |
| common literal, `max_matches` 200 (stops early) | ~65 to 75 ms | ~75 to 95 ms |
| glob `src/mod_0420/**` (one directory) | ~3 ms | ~4 ms |
| rare literal, glob `*.go` | ~80 to 100 ms | ~100 to 130 ms |
| known file range | < 1 ms | < 1 ms |

A whole-tree search with a rare pattern must open every file. The cache removes the walk (about 55 ms), but the rest is four syscalls per file (`openat2`, two `read`, `close`); on a 20k-file tree this code was faster than `rg -l`, so the floor is the kernel, not the code. Under load the 300 ms p95 budget is not met for that case. Meeting it reliably needs an index of file contents (for example trigrams) with its own invalidation rule; that is not built.

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
| `INTEGRATION.md` | how `hx` registers the handlers |
