# hx-txn

The capability-safe file transaction behind `ship`. It validates every edit in memory, journals the originals durably, applies each write atomically, and can put everything back exactly. Hermes never writes the workspace except through this crate.

## Public API

| Item | What |
|---|---|
| `Engine` | `validate`, `apply`, `restore`, `discard`, `recover`. Blocking; synchronous. `Engine::with_limits(Limits)` for custom caps |
| `TxnHandler` | the `txn.*` methods as an `hx_proto::Handler`, run on the blocking pool |
| `paths` | **the shared safe-path module**: `RelPath::parse`, `resolve(root, path, follow_final)` |
| `edit` | in-memory matching: `replace`, `diff`, `closest` |
| `scope::Scope` | `allowed` and `protected` globs; `default_protected()` reads `protected.default.json` |
| `journal`, `restore` | the on-disk journal and its state machine |
| `Error` | one `#[non_exhaustive]` enum, mapped to the error catalog in `hx-proto` |
| `Faults` | fault injection for tests; a zero-sized no-op unless the `dev-fixtures` feature is on |

Wire types (`ApplyParams`, `Edit`, `EditFailure`, ...) live in `hx-proto`.

## What a call does

`txn.apply {root, journal_dir, edits, allowed?, protected?}`:

1. Open `root` as a `cap_std::fs::Dir`. Take the per-workspace lock.
2. **Resolve every path** (`paths::resolve`): no absolute paths, no `..`, symlinks followed one component at a time and rejected if they leave the root. Two spellings of one file become one canonical path. A path to write, delete or restore also may not hold a Windows alias, on any platform (`RelPath::parse_for_write`): a trailing dot or space, an 8.3 short name (`~` and a digit) or a device name (`NUL`, `COM1`..., with any extension).
3. **Scope and protected checks**, on the requested and the real path, *before* any content is read or journaled. A violation returns `hx.txn.scope_violation` or `hx.txn.protected_path` with `data.paths`.
4. **Validate every edit in memory**, in order, each seeing the result of the earlier ones. Any failure returns `hx.txn.aborted_before_write` with `data.failures`: every failed edit, with the closest region and its line numbers. Nothing is written.
5. **Journal** the byte-exact original of every file that will change, with its mode bits, mtime, whether it existed, and whether it was a symlink. Everything is fsync'd.
6. **Apply** each write atomically: a temp file in the same directory, fsync, rename. The directory is opened once, component by component with `O_NOFOLLOW` (`held`), and held until the rename, so a symlink swapped in after the check is refused, never followed; a file is opened without blocking and must be regular (a FIFO swapped in cannot hang the read). The mode is preserved, minus setuid, setgid and sticky, which an edited file never carries; the temp file starts 0600 and takes that mode before the first byte goes in. New directories are created and recorded.
7. Return `{journal_id, files: [{path, sha256_before|null, sha256_after|null, created, deleted}]}`.

Any error after the first write restores from the journal *before* the error is returned (`hx.txn.apply_failed`, `data.restored: true`). If the restore itself fails, the journal is kept and the error is `hx.txn.restore_failed`; `txn.recover` finishes the job.

`txn.restore {journal_dir, journal_id, root}` puts back bytes and metadata exactly, deletes files the transaction created (and directories it created, if empty), and removes the journal. The caller names the `root` it expects and a journal that recorded another is refused; every entry is resolved again and checked against the protected globs the transaction ran under, and a parent that has become a symlink is refused, all before the first write. `txn.discard` keeps the changes and removes the journal. `txn.recover {journal_dir, root?}` restores every interrupted transaction after a crash; with `root`, another workspace's journal is left alone.

## Edits

| Op | Matching |
|---|---|
| `replace` | 1. exact, once (or every occurrence with `replace_all`); 2. CRLF-tolerant lines, keeping the file's line endings; 3. uniform indent shift, re-indenting the replacement |
| `create` | whole file; `overwrite` must be set to replace an existing file |
| `delete` | removes a file; a symlink is removed itself, never its target |
| `diff` | unified-diff hunks, one or several files, `/dev/null` for create and delete. Hunk counts are ignored, the start line is a hint, context must match exactly |

The whitespace-normalised fuzzy tier is **report-only**: when the only difference is whitespace, the failure says so (`closest.whitespace_only`) and nothing is applied. It could otherwise rewrite Python, YAML or string literals.

## Journal state machine

```
(no manifest) --manifest renamed into place--> prepared --> applying --> applied
                                                  |            |           |
                                                  |            +-----+-----+
                                                  |                  v
                                                  |              restoring --> restored --> (removed)
                                                  |                                ^
                                                  +--------------------------------+
```

| State | What it means | `txn.recover` does |
|---|---|---|
| no manifest | crashed while the journal was being written; the workspace was never touched | deletes it |
| `prepared` | journal durable, workspace untouched | deletes it |
| `applying` | workspace writes started | restores, then deletes |
| `applied` | all writes done and synced; waiting for the caller's verdict | **leaves it** and reports it as `pending` |
| `restoring` | a restore started | finishes it (restore is idempotent) |
| `restored` | restore finished; only the deletion is left | deletes it |

- The state file is an append-only log read up to its last complete line, so a torn write cannot change a state.
- A live transaction holds an exclusive lock (`flock`) on its journal's `lock` file. Recovery skips locked journals (`busy`), so a second process never rolls back work in progress.
- Restore reads and verifies (SHA-256) every saved file *before* its first workspace change, so a corrupt journal changes nothing (`hx.txn.journal_corrupt`).
- A journal being deleted is renamed to `.trash-<id>` first; `recover` finishes half-done deletions.
- Layout: `<journal_dir>/<uuidv7>/{lock, data.bin, manifest.json, manifest.mac, state}`; directories 0700, files 0600.
- **A journal is opened only if its tag verifies** (`mac`): `manifest.mac` is an HMAC-SHA256 over the journal's id and manifest, keyed by a 32-byte 0600 file, `.hx-journal-key`, in the *parent* of the journal directory, so it is per profile (the plugin gives each session its own directory under one `journals/`). A planted journal, an edited manifest, a journal from another profile or from before tags is never replayed: it is reported in `failed` and kept. Only `txn.apply` creates the key. This binds the root, every path, every hash and the protected list; a record of ids would only say an id was seen once. Whoever can read the key (a same-user process) can forge a tag, so the plugin's policy denies agent tools reading it. The `state` file is not covered by the tag.

## Invariants

- Only edits that all validated are ever written. A rejected transaction leaves the tree byte-identical.
- No path outside the root is ever read or written: every access goes through a `cap_std` `Dir`, and `resolve` rejects escapes before that.
- A symlink cannot launder a protected or out-of-scope path: both the requested and the resolved path are checked.
- After any failure or crash, apply-then-restore is the identity on bytes, mode bits and file mtimes.
- No error path leaves a half-applied tree.
- No fabricated numbers: the result carries hashes and booleans only.

## Known limits

- **Hard links are out of scope.** An atomic rename gives the edited path a new inode; other links to the old inode keep the old content.
- Ownership (uid/gid), extended attributes and ACLs are not preserved. Directory mtimes and symlink mtimes are not restored.
- Mode bits and file mtimes are Unix/POSIX-complete; on Windows only mtime is restored, and symlinks are not recreated.
- On case-insensitive file systems two spellings differing in case are treated as two files by the planner. Protected globs match case-insensitively to stay fail-closed.
- Text edits need UTF-8; other files can be deleted and restored but not edited.
- A concurrent edit by another program between planning and writing is detected (size and mtime) and reported as `hx.txn.conflict`, but the check is not atomic with the write.
- `put` (bytes as base64, a git mode, an expected hash) and `delete`'s `expect_sha256` are the plugin's rewind (docs/specs/checkpoint-rewind.md section 5), never offered to a model: each path's hash is checked under the workspace lock while the transaction is planned, and a path that is not as expected fails the whole transaction with `hx.txn.changed_since` before anything is written.

## Testing

```sh
cargo test -p hx-txn                       # unit, integration, property, crash tests
cargo test -p hx-txn --release --test perf -- --ignored --nocapture   # the 10-file budget
```

- `tests/properties.rs`: `proptest` over random trees and random edits, including escape attempts. Apply-then-restore is the identity; nothing outside the root changes; a failure or a crash injected at the k-th step leaves the tree identical (after recovery).
- `tests/recovery.rs`: failure and crash at *every* step of one transaction, failed restores, busy and corrupt journals.
- The `dev-fixtures` feature turns on `Faults`; it is enabled for this crate's own tests and never for the binary.
