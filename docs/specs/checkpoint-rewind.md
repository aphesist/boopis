# Checkpoint rewind: a journaled ship, behind an isolation guard

Status: draft for S0 (`w32/rewind`, package roadmap #4), proposed in ADR-0058. Depends on `session-launch.md` (the session's folder at create, the continuation chain). Owner defaults of 23 November 2026, kept with no objection: a rewind is **journaled and undoable, not gated**; rewind requires a worktree, not a shared checkout (T3's rule), here "a worktree, or nothing else changed in the folder".

Sources: T3 Code study (FEATURE-LOGIC §4.2, roadmap §11 #4, open question 3); `docs/PROTOCOL.md` section 3; the plugin's ship and checkpoint code. Engine claims cite the scratchpad Hermes source; **[verify]** needs a live engine.

## 1. What exists, what is missing

- Every passing ship commits to `refs/boopis/checkpoints/<session>`; a failed ship restores byte- and metadata-exact and leaves no ref (`plugins/boopis/ship/finish.py:181-228`, `ship/checkpoint.py:96-142`).
- The checkpoint's tree is the previous checkpoint's tree (or `HEAD`'s, for the first) with only that ship's files updated, built in a temporary index; the repository's index, working tree, branches and hooks are never touched (`ship/checkpoint.py:1-8`, `:110-141`). So the diff between two checkpoints is exactly the ships between them.
- `checkpoint.list` and `checkpoint.diff` are registered (`plugins/boopis/rpc/checkpoints.py`, `plugins/boopis/__init__.py:41-42`).
- **`checkpoint.rewind` is documented** — `{session_id, ship_id}` → `{ok}`, "itself a journaled ship, so it's reversible" (`docs/PROTOCOL.md:140`) — **but not in `RPC_METHODS`** (`plugins/boopis/__init__.py:27-74`) nor in the plugin's `CAPABILITIES` (`plugins/boopis/rpc/__init__.py:21-…`).
- hx's edits are text only: `create` takes "the full UTF-8 content" and no file mode (`crates/hx-proto/schema/hx-v1.schema.json:932-958`); the model-facing `ship` accepts `replace`, `create`, `delete`, `diff` (`ship/edits.py:16`). A rewind must restore exact bytes and modes, including a file a ship deleted that was not UTF-8.

## 2. What a rewind is

**Rewind to ship S** puts every file that the session's ships changed after S back to how it was right after S. **Rewind to the base** (`ship_id: null`) puts back every file the session's ships changed to how it was before the first kept ship (the first checkpoint's parent, `ship/checkpoint.py:157-161`).

- Only files the session's ships touched are written. Nothing else in the folder is read for content, and nothing outside the folder is touched.
- **Files only, in S0.** The conversation is not cut. The model is told on its next turn (section 6). Cutting the conversation is "edit from here" (S2, section 9).
- **It is a ship.** It goes through the hx file transaction (validate, journal, apply), writes `ship.applied`, and on success commits a checkpoint. So it appears in `checkpoint.list`, can be diffed, and **can itself be rewound**: that is its undo (section 7).
- **It is not gated** (owner default; ADR-0058). A failing gate must never trap the person in a bad state, and the state rewound to already passed the gate once, or predates the session. No `gate.decided` is written for it: no gate ran, and none is pretended.
- **It is the person's act, not the agent's.** It is a plugin RPC answered from an owner surface, never a tool. It is not on the host-ops verb list (ADR-0052 decision 2), so no bot reaches it. The careful scale (`session-launch.md` section 5) does not ask about it: the confirmation is the person's own, in the rewind sheet (`dry_run`, section 3).

## 3. `checkpoint.rewind`

```
plugin.boopis.checkpoint.rewind {
  session_id: string,
  ship_id: string | null,        // null: the base, before the session's first kept ship
  dry_run?: boolean,             // default false: plan and check only, write nothing
  expect_head?: string,          // the head checkpoint the client showed; refused if it moved
  conversation?: false           // reserved for S2 ("edit from here"); true is hx.invalid_params in S0
}
→ {
  status: "rewound" | "planned" | "nothing_to_do" | "refused",
  isolation: "own_worktree" | "shared_unchanged" | "refused",
  why?: string,                  // with refused: shown to the person as is
  from_commit: string,           // the head before
  to_commit: string,             // the tree restored
  files: [{ path, action: "restore" | "delete" | "recreate" }],
  rewind_ship_id?: string,       // with rewound: this rewind's own ship id
  undo?: { ship_id: string }     // with rewound: call checkpoint.rewind with this to undo it
}
```

Steps:

1. **Refuse while working.** A running turn of the session (the plugin's turn tracking, `plugins/boopis/turns.py:93-120`) or an open cascade attempt refuses: "Rewind when this turn has finished." The client also disables the action meanwhile.
2. **Resolve.** `head` = the last kept checkpoint of the session's chain in this folder (`checkpoint.list {chain: true}`, `session-launch.md` 6.3). The target is S's commit, or the first checkpoint's parent for the base. A ship of a chain part whose folder is not the current folder is refused: "That change was made in another folder." `expect_head` that does not match `head` is refused: "This session changed since you looked; look again."
3. **Plan.** `P` = `git diff --name-only -z --no-renames <target> <head>` in the folder, run with the checkpoint module's hardened git (`ship/checkpoint.py:54-82`). Empty `P` is `nothing_to_do`.
4. **Isolation guard** (section 4). `refused` stops here; nothing is written.
5. **Dry run** returns `planned` with `files` and `isolation`.
6. **Edits.** For each path in `P`: present in the target → `put {path, content_b64, mode, expect_sha256}` with the target blob's bytes and mode; absent → `delete {path, expect_sha256}`. `expect_sha256` is the head checkpoint's bytes for that path (or "absent").
7. **Ship.** `run_ship` with `kind: "rewind"`: `txn.validate`, `txn.apply` (journaled), then no gate. Protected paths and scope are enforced by hx as for every ship (`ship/run.py:99-113`); a refusal writes nothing and names the paths.
8. **Record and keep.** `ship.applied` with extra fields `kind: "rewind"`, `rewind_to` (S's id or `"base"`), `from_commit`, `to_commit`, `decided_by: "user"`, `surface`; then `commit_checkpoint` over `P` and `checkpoint.committed` (with the folder digest, section 4). **If the ledger write or the checkpoint commit fails, the journal is restored** (`txn.recover`, as `ship/run.py:153-157`) and the result is `refused` with the reason: a rewind with no checkpoint could not be undone, so it does not stand. (A normal ship keeps its write when only the checkpoint fails, `ship/finish.py:207-208`; a rewind does not.)
9. **Announce.** `plugin.boopis.checkpoint.rewound` to the session's clients (`ctx.emit_to_session`), carrying the result; arm the model notice (section 6).

## 4. The isolation guard

A rewind writes files back; it must never overwrite work that is not this session's. It runs only when one of these holds:

**A. The folder is this session's own worktree.** A linked git worktree that S1's worktree records (`w33/worktrees`, `session-meta.md`) name as owned by this session's thread. Then `isolation: "own_worktree"`, and only check C applies. In S0 no such record exists yet, so every folder goes through B; the hook is a single function, `owned_worktree(session_id, folder) -> bool`, returning false until S1.

**B. Nothing else changed in the folder since this session's last change** (`isolation: "shared_unchanged"`), meaning all of:
1. **The folder digest matches.** At every kept ship (rewinds included) the plugin records `folder_digest` on `checkpoint.committed` (an extra field, allowed by `docs/LEDGER.md:22`): SHA-256 over the `HEAD` commit id and the sorted list of `(path, mode, sha256 of bytes)` for every tracked-changed and untracked, non-ignored file (`git status --porcelain=v2 -z --untracked-files=all`, then hashing the listed files). Before a rewind it is computed again; a difference refuses. This catches an editor save, another tool, another session, a checkout or a commit made since.
2. **No other live session works in this folder:** no other session the plugin tracks with the same folder has a turn running or an attempt open.
3. A head checkpoint without `folder_digest` (made before this change) refuses: the guard cannot prove it.

**C. Every path is as this session left it** (both A and B): enforced inside hx, under its workspace lock, by each edit's `expect_sha256`. A path changed between the check and the write fails the whole transaction before anything is written. This closes the gap between B's check and the apply.

**Refusal words** (T3's rule, boopis's words): "Rewinding files needs this session's own worktree, or no other changes in this folder. Changed since this session's last change: `src/a.ts`, `notes.md`." (at most 5 paths, then "and N more"). Other running session: "Another session is working in this folder." Nothing is written on any refusal.

Gitignored files are outside both the digest and the rewind (a ship's files are what it writes; the gate runs on a copy, `docs/ARCHITECTURE.md` section 6).

## 5. hx: a byte-exact restore edit

New hx-v1 edit operations, internal to the plugin (not in `ship/edits.py`'s `OPS`, so the model cannot send them):

| op | fields | rule |
|---|---|---|
| `put` | `path`, `content_b64`, `mode` (`"100644"` or `"100755"`), `expect_sha256` (hex, or `"absent"`) | writes exactly these bytes with this mode, creating parents; fails before any write when the current file's hash is not `expect_sha256` |
| `delete` | adds optional `expect_sha256` | as above |

Same journal, same atomic apply and restore, same scope and protected-path checks, same limits (`crates/hx-txn/src/limits.rs`); a file over the limit refuses the rewind. Error: `hx.txn.changed_since` with the paths. Schema in `crates/hx-proto/schema/hx-v1.schema.json`, code in `crates/hx-txn/src/edit/`, error in `crates/hx-proto/errors.json`.

## 6. Telling the model

The files changed under the model. On the session's next turn the plugin adds, through `pre_llm_call`, a fixed block after the person's text (as feedforward does, ADR-0055 decision 6: user message, persisted, never the system prompt):

`<boopis-rewound v="1" to="<ship id | base>">Files were put back to how they were after <ship id | before this session's changes>. Undone: a.ts, b.ts (and N more). Read them again before editing.</boopis-rewound>`

Several rewinds before the next turn give one block naming the final state. An undo of a rewind before any turn cancels the block. Cache-safe: no tool, skill or system-prompt change (invariant 4).

## 7. Undo, and the redo it gives

- A rewind returns `undo: {ship_id}`: the ship that was `head` before it. Undo is `checkpoint.rewind {ship_id: <that>}` — itself a journaled, ungated ship with its own undo. So undo and redo are the same operation, as far back as the checkpoint chain goes. T3 has no undo of a rewind (FEATURE-LOGIC §4.2); boopis gets it from "only ship writes".
- Undo goes through the same isolation guard: if something else changed the folder after the rewind, undo refuses with the same words.
- The undo is offered on the rewind's line in the thread, and in the palette while it is the last change.

## 8. The `checkpoint` turn item

A new item kind in the thread (`apps/desktop/ui/src/data/types.ts` `Turn` union):

```ts
interface CheckpointItem {
  role: 'checkpoint'; id: string; at: string;
  action: 'rewound' | 'undone';
  to: { shipId: string | null; turnId: string | null };   // null shipId: the base
  files: number;
  rewindShipId: string;
  undoShipId: string | null;                                // null once a later change makes undo meaningless to offer
  by: 'you';
}
```

- **Where its data comes from:** `checkpoint.list` entries gain `kind: "ship" | "rewind"`, `turn_id` (the turn whose tool call shipped it; the plugin records `turn_id` on `ship.applied`, as `pre_tool_call` receives it, ADR-0051 context), `rewind_to`, and `session_id` (chain). A resume rebuilds the items from that list in timestamp order between turns; the live path adds one on `checkpoint.rewound`.
- **What it shows:** one quiet line, "Files rewound to after turn 3 · 4 files · Undo" or "Rewind undone · 4 files"; expanding it shows the files and opens the diff (`checkpoint.diff {ship_id: rewindShipId}`).
- **The affordance on turns:** an agent turn with at least one kept ship gets "Rewind files to here" (the turn's last kept ship); the first turn's offers "Rewind to before this session". The action reads `rewind` availability from the capability map (`session-launch.md` section 4) and opens the dry-run sheet: the files, the isolation verdict, Rewind or Cancel.

## 9. Hooks left for S2

- **Edit from here:** `conversation: true` in the same RPC. The conversation side is the engine's own `session.mutate {operation: "rewind", payload: {target_message_id}}` (`hermes_state_mutations.py:44-48`; one implementation, `hermes_state_rewind.py:1-4`). The file rewind runs first; if the conversation rewind fails, the file rewind is undone (all or nothing).
- **Fork from here:** the engine's `session.mutate {operation: "branch", payload: {through_message_id}}` (`hermes_state_mutations.py:57-68`) plus an S1 worktree created at `to_commit`.
- Both need, and already get from S0: the target's `to_commit`, its `turn_id`, and the turn's stored row ids (`turns.models`, `docs/PROTOCOL.md` section 3).

## 10. Protocol and ledger changes

- `RPC_METHODS` and `CAPABILITIES` gain `checkpoint.rewind`; `docs/PROTOCOL.md:140` gets section 3's shape; `apps/shared/boopis-v1.openrpc.json` too.
- New event `plugin.boopis.checkpoint.rewound`.
- `checkpoint.list` entries: `kind`, `turn_id`, `rewind_to`, `session_id`; param `chain`.
- Ledger, extra fields only: `ship.applied` `kind`, `rewind_to`, `from_commit`, `to_commit`, `decided_by`, `turn_id`; `checkpoint.committed` `folder_digest`. No new type.
- hx-v1: `put`, `expect_sha256`, `hx.txn.changed_since`.

## 11. Fail closed

Refused, with nothing written: a running turn; a moved head; another folder's ship; a folder digest that differs or is missing; another live session in the folder; a path changed before the write; a protected or out-of-scope path; a file over hx's limits; a ledger or checkpoint failure after the write (restored from the journal).

## 12. Acceptance tests

Plugin (pytest, a real git repository in a temp dir, the real hx binary) unless marked.

1. **Registered:** `checkpoint.rewind` is in `RPC_METHODS` and `describe.capabilities`.
2. **Round trip:** `b.bin` (non-UTF-8 bytes) and `run.sh` (mode 100755) exist before the session; ship 1 changes `a.txt`, ship 2 deletes `b.bin`, ship 3 edits `run.sh` and `a.txt`. Rewind to ship 1 restores `a.txt`'s bytes, recreates `b.bin` byte-exact and keeps `run.sh` at mode 100755 with its pre-ship-3 bytes; `git status` shows only those paths.
3. **Base:** `ship_id: null` restores every touched file to before the first ship.
4. **Journaled and undoable:** the rewind writes `ship.applied {kind: "rewind"}` and a checkpoint; `undo.ship_id` rewinds back to the exact pre-rewind bytes; undo of the undo works too.
5. **Not gated:** with a gate command that always fails, the rewind is kept and no `gate.decided` is written for it.
6. **Dry run** writes nothing (folder digest and ledger unchanged) and lists the files.
7. **Isolation, editor change:** a file outside `P` edited after the last ship refuses with that path named; nothing written.
8. **Isolation, path change race:** a path in `P` modified between the check and the apply (hx test hook) fails with `hx.txn.changed_since`; nothing written.
9. **Isolation, other session:** another tracked session in the same folder with a turn running refuses.
10. **Isolation, no digest:** a head checkpoint without `folder_digest` refuses.
11. **Running turn** refuses; `expect_head` mismatch refuses; `conversation: true` is `hx.invalid_params`.
12. **Checkpoint failure after apply** (fault injection: `update-ref` fails) restores the journal; the folder is byte-identical to before; no `ship.applied` stands without its `ship.restored`.
13. **Model notice:** the next turn's user message carries one `<boopis-rewound>` block; an undo before that turn removes it.
14. **Chain:** after a continuation (same folder), a rewind to a ship of the first part works; after a folder change it refuses "made in another folder".
15. **Turn item (UI, Vitest):** a `checkpoint.rewound` event adds one line with Undo; a resume rebuilds it from `checkpoint.list` in order; Undo calls `checkpoint.rewind` with `undoShipId`.
16. **Not a tool, not a bot verb:** the toolset has no rewind tool; the host-ops verb list test (ADR-0052) still pins its list without it. (e2e: a bot session cannot reach it)

## 13. Verification log

| Claim | Result |
|---|---|
| `checkpoint.rewind` documented, not registered | verified (`docs/PROTOCOL.md:140`; `plugins/boopis/__init__.py:27-74`) |
| A checkpoint tree = previous tree + the ship's files | verified (`ship/checkpoint.py:96-142`) |
| hx edits are UTF-8 only, with no mode | verified (`crates/hx-proto/schema/hx-v1.schema.json:932-958`) |
| A ledger failure restores a ship | verified (docstring `ship/run.py:13`) |
| Extra ledger payload fields are allowed | verified (`docs/LEDGER.md:22`) |
| The engine's conversation rewind and branch exist | verified (`hermes_state_mutations.py:44-48`, `:57-68`) |
| The plugin knows when a turn runs | verified (`plugins/boopis/turns.py:93-120`) |
| `pre_tool_call` receives the turn id | as ADR-0051's context records (`hermes_cli/plugins_dispatch.py`); **[verify]** it reaches workers' ships |
| Folder digest cost on a large repository | **[verify]** (budget: under 1 s for 100,000 tracked files with 50 changed; git's 30 s timeout applies, `ship/checkpoint.py:28`) |
