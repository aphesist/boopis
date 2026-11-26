# Team operations: plans, runs and stops for the BOOPIS bot and clients

Status: draft for w31 (the package's w28), proposed in ADR-0061. Source: Part C sections 2.3 (tiers T0-T3, gaps G1-G3), 2.5 (no self-approval) and 4.1-4.4. The BOOPIS bot's own tools (`house_*`) are package w29, here w32; this spec builds what they call.

## 1. Rules that hold for every operation

1. **Plan, never apply, on anything a bot can reach.** A team change is a plan (`team.plan`). It is applied only by the owner's hold in the boopis window, by `plan_hash` (section 3). There is no `apply`, `undo`, `approve` or answer verb on the host-ops channel, in a plugin tool, or on the Local API.
2. **Idempotent.** Every operation that changes something takes an `idempotency_key` (at most 200 characters; the house bot's form is `house/<job>/<step>`). The same key twice returns the first result and changes nothing.
3. **Dry run first.** Every changing verb accepts `dry_run: true` and answers what it would do without doing it. Structural changes are only ever dry runs on bot-reachable channels (that is what a plan is).
4. **Never the owner's voice.** A message a bot sends through these verbs is labelled as the bot's (`bot.say`, `room.say`), never shown as the owner's, unlike the Local API's `say` (ADR-0045 decision 6).
5. **Audited**, and **fail closed** (section 9).

## 2. The operations

| Operation | What | Built on (exists) | New |
|---|---|---|---|
| `team.plan` | A team-file fragment, merged over the current export, checked and planned; returns the plan, `plan_hash`, `base_export_hash` | `team::spec` (`Team::parse`, `check`), `team::plan::plan`, `team::export::export` (`apps/desktop/src-tauri/src/team/`); `boopis team apply --dry-run` prints the same plan today | merge of a fragment, the hash, the stored plan file |
| apply (owner only) | Applies a stored plan after checks, with a snapshot first | `team::apply::apply` | `team::apply_held`, snapshot, report |
| undo (owner only) | Plans the way back to the snapshot, then applies it by the same hold | `team::plan` with `prune` | `team::undo` |
| `room.say` | One note into a room, through the room hold | `rooms::hold::submit` (`room-holds.json`, ADR-0046 on w29/integrate) | the label, the key |
| `room.run` | A task through a room to its end, with a cap | `rooms::run` (`boopis run --group`) | the run table |
| `room.log` | A room's lines after a sequence | `local_api::room_log` (w30/local-api-0.2) | — |
| `room.stop` | Stop a room's running and queued work | `groups.stop` (`POST /v1/rooms/<id>/stop`, w30/local-api-0.2) | — |
| `bot.say` | Give one bot a message in a **new** session (never the owner's open thread) | the bot's own link, `session.create` + `prompt.submit` (as the Local API's `say`) | the label, the key |
| `bot.run` | A multi-turn goal for one bot | `boopis run --bot` (`session.automation`, the bot's `max_turns`) | the run table |
| `session.stop` | Interrupt a session this job started | `session.interrupt` (`POST /v1/bots/<name>/stop`) | job ownership check |
| `jobs.get` / `jobs.put` | Read a job, append a line to it | — | `house/jobs.jsonl` |
| `grant.redeem` | Redeem a one-time owner grant (for plugin RPCs that loosen rules, `host-protections.md` H5) | — | new |

`team.plan` is pure (it changes no bot, room, board or job) and only writes the plan file.

## 3. Plans: `team.plan`, the hold, apply and undo

### 3.1 Making a plan

Input: `{fragment: <team-file YAML, at most 64 KiB>, reason: <one line, at most 200 characters>, prune: false, job_id?}`. `prune` from a bot channel is refused (`hx.team.prune_owner_only`): only the owner's own `boopis team apply --prune` removes things.

1. Read the current state (`team::apply::Backend`, as `team apply` does) and export it (`team::export`). `base_export_hash` = SHA-256 over the export's canonical JSON (contraprova `canonical_json` rules: sorted keys, no spaces).
2. Merge the fragment over the export: maps by key (bots by name, rooms by name, boards by slug, jobs by bot and name), a fragment field replaces the export's field, nothing is removed.
3. `Team::parse` and `check` the merged file; refuse with the problems if it fails.
4. `team::plan(merged, now, prune: false)`: actions (`+`, `~`, `-`), problems, notes.
5. `plan_hash` = SHA-256 over the canonical JSON of `{"actions": [each Action's op], "base_export_hash": …}`. Two plans with the same actions against the same team have the same hash.
6. Write `<app data>/house/plans/<plan_hash>.json` (section 7) with `state: "proposed"` and `expires_at` = now + 24 h, unless it exists (idempotent by hash).
7. Answer `{plan_hash, base_export_hash, plan: {actions: [{mark, target, what}], problems, notes}, state, expires_at}`; emit `plans.changed`.

An empty plan is answered with `state: "nothing_to_do"` and is not stored. Gate lints, cost estimates and model reachability (Part C L1-L13, G8) are package w29 (here w32); the file keeps room for them (`lints`, `estimate`).

### 3.2 Applying: only the owner's hold, by hash

Tauri command `team_plan_apply {plan_hash}`, called only from the plan card's hold-to-approve control in the window (R-comp-6: hold to approve). The host:

1. Loads `house/plans/<plan_hash>.json`; refuses a plan that is not `proposed`, has expired (`hx.team.plan_expired`), or has problems.
2. Recomputes the export hash; if it differs from `base_export_hash`, refuses with `hx.team.plan_stale`, "The team changed since this plan was made." The plan becomes `expired`; a new one must be made.
3. Recomputes `plan_hash` from the stored actions and the base; a mismatch (the file was edited) is `hx.team.plan_tampered`, and the plan becomes `failed`.
4. Writes the snapshot: the current export as YAML, `<app data>/house/snapshots/<at>-<plan_hash>.yaml`.
5. Sets `state: "held"`, then runs `team::apply::apply` on the stored actions.
6. Writes the report (`team::apply::Report`: done, failed, skipped) into the plan file, `state: "applied"` (all done) or `"failed"` (some failed; what failed and what was skipped is listed, as `team apply` does), `answered_by: {surface: "gui", at}`; appends `audit/client-answers.jsonl` `{choice: "apply", plan_hash, outcome, surface: "gui"}`; emits `plans.changed`.

The owner can also reject (`team_plan_reject {plan_hash, words?}`): `state: "rejected"`, the words kept for the bot to read with `jobs.get`.

### 3.3 Undo

Tauri command `team_plan_undo {plan_hash}`: plans the snapshot over the current state with `prune: true`, keeping only actions whose target the applied plan touched (others are notes: "mira changed after this plan; left as it is"). The result is a new plan (`reason: "Undo <plan title>"`, `undoes: <plan_hash>`), shown as a plan card and applied by the same hold. Archiving a bot the plan made is reversible; disbanding a room the plan made is permanent and the card says so.

### 3.4 CLI parity

```
boopis team plan <file|-> [--json]          # the plan and its plan_hash; stores the proposal (no --prune)
boopis team apply --hash <plan_hash> [--json]
boopis team undo <plan_hash> [--json]
boopis team apply <file> [--dry-run] [--prune] [--json]   # unchanged
```

`apply --hash` and `undo` run the same checks as 3.2 and 3.3 and record `surface: "cli"`. Every `apply` form and `undo` refuse a bot caller (`host-protections.md` H5): a process whose ancestry holds the recorded gateway, or whose environment holds `BOOPIS_ENGINE_LAUNCH`, gets exit 2. `docs/CLI.md` gains the three lines.

## 4. The host-ops channel: `hx-host-ops-v1`

### 4.1 Transport (the secret channel's, read in `apps/desktop/src-tauri/src/secrets/channel.rs` and `peer.rs`)

- A Unix socket `host-ops.sock` in the same `0700` folder as `host.sock` (`$XDG_RUNTIME_DIR/boopis/`, else `<data local dir>/boopis/run`), mode `0600`. One JSON line in, one out, then close; 8 KiB request line for every verb but `team.plan` (64 KiB plus the envelope); 2 s for the secret channel, 10 s here (a plan reads the team); 8 connections at once.
- **Peer check:** `SO_PEERCRED` uid must be the folder's owner, and `PeerPolicy::admit` must pass: the recorded gateway itself (rule A: pid, start time, executable), never a child of it, which is what any tool a bot runs is. The verdict is taken before the request is read and a refused peer gets the same answer as a wrong token (`hx.host.unauthorized`), so neither factor can be probed apart.
- **Token:** its own 256-bit per-launch token, `BOOPIS_HOST_OPS_TOKEN`, with the socket's path in `BOOPIS_HOST_OPS_SOCKET`, handed to the gateway only in the launch environment, beside the secret channel's. The plugin reads both at load and removes the token from its environment (as `plugins/boopis/hostsecrets` does). A separate token keeps the secrets channel's token useless here and the other way round.
- **One implementation:** the listener, peer check, line framing, caps and timeouts move out of `secrets/channel.rs` into a shared module (`host_channel`), and both protocols are handlers on it (STANDARDS rule 1).
- **Platforms:** Linux and macOS (w30/macos implements the process questions). Windows has no named-pipe server yet (`channel.rs` `start` returns `Unavailable`), so host-ops is unavailable there and the house tools' `check_fn` is false.
- **Which processes reach it:** only the gateway process. A kanban worker or a cron worker that runs in its own process (`gateway/session_kanban.py`; restart-safe cron workers, `cron/scheduler.py`) is not the gateway and is refused. House tools run in the BOOPIS bot's chat and room turns, which run in the gateway; a house tool in another process gets "not available here" (said in w32's spec).

### 4.2 Requests and answers

```json
{"v": 1, "token": "…", "op": "room.say", "id": "house/j_0193…/3", "dry_run": false, "params": {…}}
{"v": 1, "protocol": "hx-host-ops-v1", "ok": true, "result": {…}}
{"v": 1, "protocol": "hx-host-ops-v1", "ok": false, "code": "hx.rooms.busy", "message": "…"}
```

`id` is the idempotency key, required for every changing verb. Errors are `hx.*` codes with a sentence that says what to do and never echoes input.

### 4.3 Verbs (the whole list)

| Verb | Params | Result | Changes |
|---|---|---|---|
| `team.plan` | `{fragment, reason, job_id?}` | as 3.1 | the plan file only |
| `room.say` | `{room_id, text ≤ 16 KiB, job_id?}` | `{status: "sent"\|"held", event_id, held}` | yes |
| `room.run` | `{room_id, task ≤ 16 KiB, max_rounds?, to_board?, job_id?}` | `{run_id, status: "started"\|"held"}` | yes |
| `room.log` | `{room_id, after?, limit ≤ 200}` | `RoomLog` (w30/local-api-0.2 shape, with `turn.cancelled` and `turn.failed` lines) | no |
| `room.stop` | `{room_id, job_id?}` | `{stopped, cancelled, held}` | yes |
| `bot.say` | `{bot, text ≤ 32 KiB, session: "new"\|<id this job started>, job_id?}` | `{session_id, created}` | yes |
| `bot.run` | `{bot, goal ≤ 16 KiB, max_turns?, job_id?}` | `{run_id, session_id}` | yes |
| `session.stop` | `{bot, session_id}` | `{stopped}` | yes |
| `jobs.get` | `{job_id?}` | `{jobs: [Job]}` (one, or the open ones) | no |
| `jobs.put` | `{job_id, line: {kind: "opened"\|"step"\|"note"\|"state", …}}` | `{job}` | the job file |
| `grant.redeem` | `{grant, purpose}` | `{ok}` | marks the grant used |

**Not verbs, ever:** `team.apply`, `team.undo`, `team.reject`, `approval.*`, `clarify.*`, `form.submit`, `form.cancel`, `secret.*`, `config.*`, `rules.*`, `budget.*`, `token.*`, `room.say` with `now` (sending now stops the members' turns). An unknown `op` is `hx.method_not_found`. A test pins the list.

**Rules per verb:**
- `room.say`: the text is prefixed with the fixed label "From boopis, for <owner>. This is not an approval." (the w30/governed-bots S2 label, written by the host, not the bot); it goes through the room hold and is never sent into a busy room; the event id is `ops-` + the first 12 hex of SHA-256(key), so the engine's `groups.send` (idempotent by event id) makes one message for one key.
- `bot.say`: `session: "latest"` is refused (never the owner's open thread); `"new"` creates a session the way `say` does, then submits the labelled text with `submission_id` derived from the key. **[verify]** that the engine's `prompt.submit` returns the existing turn for a repeated `submission_id`; until verified, the host's run table (below) is the guard. A session id other than `new` must be one this job started.
- `session.stop`, `room.stop`: stopping only reduces activity, so any room or session may be stopped; `job_id` is recorded.
- `jobs.put` `state`: `done` is refused when the job spent money; the job becomes `done_suggested` and only the owner closes it (Part C 2.5).
- `room.run`, `bot.run`: start in the background and answer at once. **The run table** `<app data>/house/ops.json` maps each key to its result for 7 days (at most 10,000 keys, oldest first out), so a repeated key returns the same `run_id` and `session_id`.
- `dry_run: true` on a changing verb answers `{would: …}` (`"send"` or `"hold"` with who is at work, `"start"`, `"stop"` with what runs) and changes nothing, not even the run table.

### 4.4 Limits

A token bucket per verb class (reads 20/s, changes 2/s, `team.plan` 1 per 5 s), 4 open plans per job, 32 KiB message cap; over a limit is `hx.host.rate_limited`.

## 5. Plugin side (foundations only)

- `plugins/boopis/hostops/channel.py`: the client (connect, one line, read one line, 10 s timeout), mirroring `hostsecrets/channel.py`; no house tools yet (w32).
- `describe.capabilities` gains `host-ops-v1` when the channel answered a `jobs.get` at load.
- `grant.redeem` is used by the plugin's loosening RPCs (`host-protections.md` H5).

## 6. Local API: read plans, and stop

Version 1 stays (ADR-0045: a new field or event is not a new version).

| Route | Answer | Notes |
|---|---|---|
| `GET /v1/plans?state=proposed\|all` | `{plans: [{plan_hash, title, reason, counts: {bots, rooms, boards, jobs}, state, created_at, expires_at}]}` | read only; at most 50 |
| `GET /v1/plans/<plan_hash>` | the plan's actions as `{mark, target, what}`, problems, notes, state, report | read only; the fragment and the merged file are not sent |
| event `plans.changed` | `{plan_hash, state}` | |
| notification kind `plan` | "A team plan waits for you" | opens the app |
| `GET /v1/jobs`, event `jobs.changed` | `{jobs: [{id, title, state, steps: [{bot, state}], spend: {usd_est, turns}, at}]}` | the house bot's jobs (w32 fills them) |
| `POST /v1/jobs/<id>/stop` | `{stopped: [...]}` | stops every room turn, run and session the job started |
| `POST /v1/house/stop-all` | `{stopped: [...]}` | the kill switch; Part C 2.5's list for open jobs |

There is no route to apply, undo or reject a plan. Stops are allowed from any Local API client (they only reduce activity), and audited.

## 7. Data files (Part C 4.1, reconciled)

All under `<app data>` (`docs/LOCAL-API.md` names it per platform). Written atomically (temp file, fsync, rename), versioned, unknown keys kept, mode `0600`. Bot sessions may not write any of them (`host-protections.md` H2).

| File | Holds | Writer | Status |
|---|---|---|---|
| `room-holds.json` | held room messages | host (`rooms::hold`) | **exists** (w29/rooms-api, ADR-0046 on w29/integrate). Part C called it `rooms-queue.json` |
| `house/plans/<plan_hash>.json` | `{schema_version, plan_hash, base_export_hash, job_id?, reason, title, fragment (YAML), merged (YAML), plan: {actions, problems, notes}, lints: [], estimate: null, state: proposed\|nothing_to_do\|held\|applied\|failed\|rejected\|expired, created_at, expires_at, answered_by?: {surface, at}, words?, snapshot?, report?, undoes?}` | host | new |
| `house/snapshots/<at>-<plan_hash>.yaml` | the export just before an apply | host | new |
| `house/jobs.jsonl` | one line per change: `{schema_version, job_id, at, kind, …}` as Part C 4.1 | host (`jobs.put`) | new; the plugin writes only through `jobs.put` |
| `house/ops.json` | the run table (section 4.3) | host | new |
| `house/house.json`, `house/team-notes.jsonl` | the house bot's settings and notes | host | package w29 (here w32) |
| `audit/house-ops.jsonl` | every host-ops call | host | new |
| `audit/client-answers.jsonl` | answers, applies, rejects, undos, stops | host | exists (ADR-0045) |

Plans older than 30 days that were not applied are deleted at start; applied plans and their snapshots are kept until the owner clears them (Settings, later).

## 8. Audit

`audit/house-ops.jsonl`, mode `0600`, rotated by size like `client-answers.jsonl`: `{at, op, target, job_id?, key_digest (first 12 hex of SHA-256 of the key), dry_run, outcome: ok|refused|failed, code?}`. Never message text, a fragment, a task or a token. Refused peers are logged by the host (`warn`, with the pid), never answered with a reason.

## 9. Failure behaviour

| Failure | Result |
|---|---|
| Peer not the gateway, wrong token, wrong `v` | `hx.host.unauthorized`, nothing read further |
| Missing key on a changing verb | `hx.invalid_params` |
| The team cannot be read for a plan | `hx.team.unreadable`; no plan file |
| Export hash or plan hash differs at apply | refused (3.2); never a partial apply |
| An apply action fails | reported, what depends on it skipped, the rest done (as `team apply`); `state: failed`; undo stays available |
| The run table cannot be written | the changing verb is refused (`hx.host.store_failed`): without it a retry could act twice |
| A room is busy | `room.say` holds; `room.run` answers `held` |

## 10. Protocol and OpenRPC changes

- `docs/PROTOCOL.md`: a new seam row "Plugin and host (ops) | `hx-host-ops-v1` | Unix socket"; section 1 (Tauri) gains `team_plan_apply`, `team_plan_reject`, `team_plan_undo`, `owner_grant`; section 6 gains `hx.team.plan_expired`, `plan_stale`, `plan_tampered`, `prune_owner_only`, `unreadable`, `hx.host.rate_limited`, `hx.host.store_failed`.
- `docs/LOCAL-API.md`: section 6's routes and events.
- `docs/CLI.md`: section 3.4.
- The OpenRPC file `PROTOCOL.md` names as the source of truth (`apps/shared/boopis-v1.openrpc.json`) is not in the tree on w29/integrate; the tables in `PROTOCOL.md` are the contract until it exists.

## 11. Acceptance tests

Host (Rust):
1. `team.plan` on a fragment adding one bot: one `+` action, a `plan_hash`, a file in `house/plans/`; the same fragment again: the same hash, no second file.
2. A fragment that fails `check`: refused with every problem; no file.
3. `prune: true` from host-ops: `hx.team.prune_owner_only`.
4. Apply by hold: snapshot written before any action; report stored; `answered_by.surface` is `gui`; an audit line.
5. The team changed after planning (a bot renamed through the CLI): `hx.team.plan_stale`, nothing applied, plan `expired`.
6. A plan file edited on disk: `hx.team.plan_tampered`.
7. Undo of an applied plan that made a bot and a room: a new plan archiving the bot and disbanding the room, with the permanent-disband note; applying it restores the export hash of the snapshot.
8. `room.say` into a busy room: `held`; the same key again: the same event id, one message in the room log after it is sent; the message starts with the label.
9. `bot.say` with `session: "latest"`: refused; with `new`: a new session, the label first.
10. `room.run` with a key twice: one run.
11. Every changing verb with `dry_run: true` changes nothing, including the run table.
12. A peer that is a child of the recorded gateway, with the right token: `hx.host.unauthorized`.
13. Each forbidden verb name (`team.apply`, `approval.respond`, …): `hx.method_not_found`; the verb list is pinned by a test.
14. `jobs.put {state: done}` on a job with spend: `done_suggested`.
15. `house-ops.jsonl` lines never contain the text, fragment or key.

CLI:
16. `boopis team plan` prints the hash; `apply --hash` applies it; a bot caller (environment variable set) gets exit 2.

Local API:
17. `GET /v1/plans` lists the proposal; there is no `POST` on plans (`405`); `POST /v1/jobs/<id>/stop` stops a run the job started and writes an audit line.

Plugin:
18. `hostops/channel.py` against a fake server: one line each way, 10 s timeout, the token removed from the process environment after load.

## 12. Open questions

None for the owner. Package w32 decides the house tools' wording and the plan card's look (lab, owner's pick).

## 13. Verification log

| Claim | Result |
|---|---|
| `team::plan` and `team apply --dry-run` exist | verified: `apps/desktop/src-tauri/src/team/plan.rs` `plan`, `cli/team.rs` (`dry-run` switch) |
| The room hold queue lives in the UI (G2, B30) | superseded: host-side `rooms/hold.rs`, file `room-holds.json` (w29/rooms-api; ADR-0046 on w29/integrate) |
| No Local API room log or stop (B26) | superseded: `GET /v1/rooms/<id>/log`, `POST /v1/rooms/<id>/stop`, `POST /v1/bots/<name>/stop` on w30/local-api-0.2 |
| The secret channel's transport: `0600` socket, per-launch token, kernel peer check that the caller is the gateway | verified: `secrets/channel.rs`, `secrets/peer.rs`; macOS process questions on w30/macos; Windows not implemented |
| `session.create {client_env: {BOOPIS_JOB}}` tags a session | partly: `client_env` exists but is an allowlisted, secret-filtered map (`gateway/session_policy.py:157-165`, `agent/session_client_env.py`); whether `BOOPIS_JOB` passes is [verify]. Not needed here: the host records the sessions it creates in the job file |
| `prompt.submit` is idempotent by `submission_id` | [verify] |
