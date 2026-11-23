# Session launch: live switching, launch settings, one capability map, the permission scale

Status: draft for S0 (`w32/session-core`, package roadmap #1-3), proposed in ADR-0057. Sources: the T3 Code study (`T3CODE-MASTER.md`: walkthrough §16, feature logic §0, §3.1, §5.2-5.4, §11), `PLAN-session-waves.md` and the owner's decisions of 23 November 2026, which bind this spec:

- one 4-step permission scale (Supervised / Auto-accept edits / Auto / Full access) in the launch step;
- Full access removes the asks, never the journal: every write still goes through `ship`, and every turn can be rewound;
- mid-session, everything may change, as in T3; the caching invariant holds per **engine** session;
- S0 ships in 0.2.0, after the Session screen design pass for the launch step (the launch step's look is the lab's and the owner's; this spec says what it decides, not how it looks).

Engine claims were read in the scratchpad copy of the Hermes source the w31 specs used (the plugin pins `requires_hermes: ">=0.23.2"`, `plugins/boopis/plugin.yaml:8`). Each is cited `file:line`; **[verify]** marks what needs a live engine. Engine paths are relative to the Hermes source root; boopis paths to this repository.

## 1. What changes, in one table

| # | Today | After S0 |
|---|---|---|
| 1 | Selecting another session stops the running one (`apps/desktop/ui/src/modules/session/conversation.ts:374`: `if (VIEW.running) sessions().stop(VIEW.current)`) | Switching never stops a turn. Every bound session keeps streaming into its own conversation; the view shows whichever is selected (section 2) |
| 2 | `session.create {source: 'gui', toolsets?}` (`apps/desktop/ui/src/host/live-provider.ts:190`): no folder, model, effort or skills | `session.create` carries the launch step's folder, model, provider, effort, skills and toolsets; the plugin gets the permission step right after (section 3) |
| 3 | Controls probe on their own (`host/live/details.ts:242-246`) or read scattered flags | One `SessionCapabilities` map, built from `runtime.describe` and `plugin.boopis.describe`; every control reads it (section 4) |
| 4 | governed / ungoverned plus Hermes approvals, two axes | One "How careful" scale with four steps, mapped onto governed mode, the plugin's asks, the rules engine and the sandbox (section 5) |
| 5 | "The mode is fixed once the first message is sent" (`host/live/details.ts:284`) | Everything can change. The model switches in place; workspace, permissions across the governed line, skills and toolsets continue the same thread on a new engine session (section 6) |

## 2. Switching sessions never stops a running turn

### 2.1 What the engine already does

- **One connection holds many sessions.** The canonical gateway keeps a subscription per session the connection created or resumed (`gateway/session_controls.py:708-713`), and drops one only on an explicit `session.detach` (`gateway/session_controls.py:759-783`). boopis never calls `session.detach` (no call in `apps/desktop/ui/src` outside the generated contract). So every session the window has bound keeps sending its frames.
- **The provider already routes them.** `onEvent` maps each frame's `session_id` to its conversation and updates that conversation's turns whatever the view shows (`host/live-provider.ts:301-311`). A replay gap reloads only the session that lost events (`host/live-provider.ts:424-429`).

So the stop is a UI choice, not an engine limit. Background streaming needs no new engine call and no new socket.

### 2.2 What the UI changes

1. **Remove the stop on switch** (`conversation.ts:374`). Stop stays an explicit act: the Stop button and mod+. stop the session the person is looking at (`conversation.ts:425`).
2. **Per-session running state.** `VIEW.running` (one flag for the view, `conversation.ts:219`, `:245`) becomes a read of the selected conversation's running turn. The composer's running state, Stop and the "Working" header follow the selected session; the list row of every session shows its own (`patchSession(…, {running})`, already per session, `live-provider.ts:214-224`, `:230-246`).
3. **A running turn's snapshot is complete.** Today `startTurn` keeps the running steps and text beside the turn, not in it: `addStep` pushes to `r.steps` (`live-provider.ts:226-229`) and streamed text accumulates in `r.text` (`live-provider.ts:329`), while the turn object in `c.turns` keeps `steps: []` and no paragraphs. Switching back to a running session therefore redraws it empty until the next frame. After S0 the running turn in `c.turns` holds its steps and paragraphs as they arrive (one copy, not two), and its start time.
4. **Redrawing a running turn shows what it has.** `liveTurn` renders the turn's steps and paragraphs from the snapshot and starts its clock from the turn's start time, not from zero (`conversation.ts:210` counts from the redraw).
5. **Per-session feed subscriptions.** The view subscribes to the selected conversation only (`renderConversation`, `conversation.ts:254-273`, already unsubscribes the previous one). Background conversations are kept by the provider, not by DOM: no hidden columns. Selecting one renders its snapshot and subscribes; leaving it unsubscribes the view and nothing else.
6. **Attention from the background.** A background session that finishes, fails, opens an approval or a blank marks its list row (the existing `sessionNeedsYou`, `conversation.ts:252`, plus an approval check). Notifications follow T3's rule later (S3: only when the window is unfocused).
7. **The right panel follows the selected session** (`details.follow`, `host/live/details.ts:263-269`, unchanged). Panels of background sessions refresh when selected.

### 2.3 Limits

- No limit is set on how many sessions run at once; each runs in the engine's own admission (durable, per session: `session_admissions`, as already verified in the plan). How many turns the engine runs concurrently on one gateway is **[verify]** (a live test with three sessions running).
- Closing the window detaches nothing; the next start resumes each session with `session.resume`, which reports `running` (`gateway/session_controls.py:739`).

## 3. Launch settings carried by `session.create`

### 3.1 The engine's create parameters (verified)

The canonical gateway serves `session.create` (`gateway/session_controls.py:225`, handler `create` at `:470`) and publishes the accepted names in `runtime.describe.session_create.parameters` (`gateway/session_controls.py:560-572`): `CREATE_FIELDS` plus `title` (`gateway/session_policy.py:15-20`). An unknown name is refused, not ignored (`gateway/session_policy.py:442-445`).

boopis talks to the canonical gateway, not the legacy TUI server: the capability boopis checks, `plugin-rpc-v1`, is announced by `gateway/session_controls.py:564-567` (`host/live/details.ts:233-234`). So the names below are the canonical ones. The legacy TUI server's `methods_session_model_guard.create_overrides` reads `reasoning_effort` (`tui_gateway/methods_session_model_guard.py:42`); the canonical gateway reads **`reasoning`**, and refuses `reasoning_effort` as unknown.

| Launch setting | Param | Rule in the engine | boopis sends |
|---|---|---|---|
| Folder | `cwd` | absolute path to an existing directory, else refused (`gateway/session_policy.py:456-458`) | the project folder (S1: the session's worktree) |
| Folder is the person's pick | `cwd_explicit: true` | without it a named profile's `terminal.cwd` wins over the client's folder (`gateway/session_policy.py:462-463`), and the terminal backend may keep its own cwd (`:488-489`) | always `true` |
| Model | `model` | non-empty string (`gateway/session_policy.py:454-455`) | the launch pick (governed: the orchestrator's model, see 5.4) |
| Provider | `provider` | non-empty string; a provider pick drops the replaced provider's endpoint and key pins (`gateway/session_policy.py:603-627`); `auto` means no pick (`:536-540`) | the pick's provider, never `auto` when a model is named |
| Effort | `reasoning` | one of `minimal, low, medium, high, xhigh, max, ultra`, or `none`/`false`/`disabled` (`hermes_constants.py:1141`, `:1163-1168`); anything else refused (`gateway/session_policy.py:663-666`) | the launch pick; omitted means the profile's |
| Skills | `skills` | non-empty list of names, rendered once into the frozen policy at creation (`gateway/session_controls.py:521-529`, `gateway/session_policy.py:782-791`); refused with `safe_mode` | the launch pick; omitted when none |
| Toolsets | `toolsets` | validated list (`gateway/session_policy.py` `_resolve_toolsets`, `:669-680`) | always `["boopis"]` in the Session tab (5.5) |
| Engine checkpoints | `checkpoints` | turns on the engine's own file checkpoints (`gateway/session_policy.py:651-654`) | never: the engine's file tools are refused in the Session tab, and boopis's checkpoints are per ship |
| Approval bypass | `yolo` | bypasses this session's approvals, plugin cards included (`gateway/session_policy.py:320-324`, `tools/approval.py:1231-1232`) | never (5.6) |
| Client label | `client` | a self-declared label, read by nothing (`gateway/session_policy.py:466-469`) | `{name: "boopis", version}` |
| Title | `title` | **a titled create resumes an existing session with that title** (`gateway/session_controls.py:511`) | never at create; a title the person typed is set after with `session.title` |

The launch step sends only names present in `runtime.describe.session_create.parameters`. If `toolsets` or `cwd` is missing there, the Session tab refuses to create (fail closed: without `toolsets` the engine's own write tools would load). A missing `reasoning` or `skills` makes that control unavailable, with the reason.

The model × provider coherence check (`tui_gateway/methods_session_model_guard.py:14-29`) runs on the legacy server only (`tui_gateway/methods_session.py:332-333`); the canonical gateway does not call it (no use under `gateway/`). The launch step therefore offers only pairs from `model.options` and the ladder, never typed text.

### 3.2 The launch step

Lazy creation stays: the engine session is created at the first send (`ensureLive` → `createLive`, `live-provider.ts:174-210`). The launch step is what a new session shows before its first message, and it decides:

| Field | Values | Default |
|---|---|---|
| Project folder | a project; S1 adds "new worktree" and "existing worktree" | the selected project |
| How careful | Supervised, Auto-accept edits, Auto, Full access (section 5) | the owner's last pick, else Auto-accept edits |
| Model | `model.options` and the ladder, with "needs sign-in" or "needs a newer engine" states shown, never hidden | Smart, or the last pick |
| Effort | the efforts the engine accepts (3.1) that the model's provider offers | the profile's |
| Skills | the profile's skills | none |

Each field reads its availability from the capability map (section 4); an unavailable value shows the reason and cannot be picked. Nothing on the launch step is sent until the first message.

### 3.3 The create sequence

1. `dispatch.roster` (unchanged, `live-provider.ts:189`).
2. `session.create {source: "gui", client, cwd, cwd_explicit: true, model?, provider?, reasoning?, skills?, toolsets: ["boopis"]}`.
3. `plugin.boopis.mode.set {session_id, mode, careful, surface: "session", gate?}` (section 5.3; `careful` and `surface` are new params).
4. The yolo check (5.6).
5. If 3 or 4 fails, the session is detached with `end_reason: "launch_failed"` (`gateway/session_controls.py:759-783`) and never bound, as `createLive` does today for a failed `mode.set` (`live-provider.ts:191-201`). The message is not sent and the person sees why. (Today's fallback calls `session.close`, which the canonical gateway does not list among its handlers, `gateway/session_controls.py:225-245`; **[verify]** whether it is forwarded. `session.detach` is.)
6. `session.title` if the person typed a title.

### 3.4 Where the settings are recorded

- The engine freezes its part in the session's policy (`gateway/session_policy.py` `build_policy`, `:430-512`).
- The plugin records `careful` and `surface` on its session state and in `session.opened` as extra payload fields (`docs/LEDGER.md:22`: fields not listed are allowed). A later in-place change is a `mode.changed {from, to, scope: "careful"}`.

## 4. One `SessionCapabilities` map

### 4.1 Sources

| Source | What it gives |
|---|---|
| `runtime.describe` (held by the client after connect, `docs/ARCHITECTURE.md` section 4) | `capabilities` (`durable-admission-v1`, `plugin-rpc-v1`, …, `gateway/session_controls.py:564-567`) and `session_create.parameters` (`:569-570`) |
| Method probes, moved here from `host/live/details.ts:242-246` | `session.branch` (fork), `session.compress` (compact); probed once per connection with an id that matches nothing, "unknown method" being the only negative |
| `plugin.boopis.describe {}` and `{session_id}` (`plugins/boopis/rpc/__init__.py:104-131`) | plugin version and protocol; its RPC list (`CAPABILITIES`, `:21-…`); `kernel`; `config.mode`; `frontier`; per session `mode`, `locked`, `cwd` |
| New in `plugin.boopis.describe {cwd}` | for a folder before any session exists: `gate: {command: bool, trusted: bool}`, `sandbox: {ok, why?}` (the gate's sandbox check, `ship/run.py:94-97`), `hx: {ok, why?}` (`ship/run.py:79-81`) |
| New in `plugin.boopis.describe {session_id}` | `careful`, `surface`, `continued_from?` (section 6), `rewind: {ok, why?}` (`checkpoint-rewind.md`) |

### 4.2 Shape

```ts
type Avail = { ok: true } | { ok: false; why: string };   // why is shown to the person, never a code
interface SessionCapabilities {
  engine: { version: string; caps: ReadonlySet<string>; createParams: ReadonlySet<string> };
  plugin: { present: boolean; version: string | null; rpc: ReadonlySet<string> };
  launch: {
    create: Avail;                                   // cwd and toolsets accepted, plugin present
    folder: Avail; model: Avail; effort: Avail; skills: Avail;
    efforts: readonly string[];
    careful: Record<'supervised' | 'auto_edits' | 'auto' | 'full', Avail>;
  };
  session(id: string): {
    fork: Avail; compact: Avail; rewind: Avail;
    changeModel: Avail; changeEffort: Avail;
    changeCareful: Record<'supervised' | 'auto_edits' | 'auto' | 'full', Avail & { inPlace?: boolean }>;
    changeFolder: Avail; changeSkills: Avail;
  };
}
```

### 4.3 Rules

- **One builder, one owner.** The map is built in `host/live/details.ts` (it already holds the probes and the plugin's describe) and published as a watch; `modules/session/{list,right,composer}.ts` and the launch step read it. No control probes or reads a flag on its own. The `unavailable` record (`details.ts:100`) becomes a view of the map.
- **Unknown is not yes.** A source that was not read (plugin absent, describe failed) gives `ok: false` with the reason, never a default `ok: true` (invariant 5).
- **Refresh**: on connect and reconnect (`details.onLinkReady`), on a session's bind, after a settings change, and when the plugin emits a configuration change. It is never polled.

## 5. The permission scale

### 5.1 The four steps (owner decision)

| Step | Owner's words | Mode | The plugin asks before | The rules engine | The gate | Sandbox |
|---|---|---|---|---|---|---|
| **Supervised** | governed; every ship and every shell command asks | governed | every `ship` and every `exec` call; network tools (as today, `policy/__init__.py:126-129`) | runs; its asks are part of "everything asks" | as configured; none is allowed (the person approves each ship) | unchanged: exec cells and the gate in the `hx` sandbox, network off unless `exec.network` |
| **Auto-accept edits** | governed; ships apply when the gate passes, shell asks | governed | every `exec` call; network tools | runs | **required**: a trusted gate command | unchanged |
| **Auto** | governed; only the rules engine asks | governed | nothing of its own | the owner's rules ask: the global rules list (`rules-engine.md` step 4c) and the permission `ask` rules (step 5) | **required** | unchanged |
| **Full access** | no asks, every write still recorded through ship | ungoverned | nothing | does not ask | as configured; none means ships are journaled and unchecked | unchanged: the workspace stays read-only to exec, which is what keeps every write in `ship` |

What stays in every step, Full access included: host protections, denied reads, the owner's `deny` rules, protected paths (`policy/__init__.py:74-117`), the engine's hardline floor (`rules-engine.md` section 3), the cost cap, the journal and the checkpoint per kept ship. Full access removes asks, never blocks.

### 5.2 What "ship" and "shell" mean here

- **Ship** is the only write (invariant 2). In governed mode the orchestrator dispatches and workers ship (`docs/ARCHITECTURE.md` section 6); in Full access the session model ships directly.
- **Shell** is `exec`: governed mode has no `terminal` for any role, and commands run as `harness.sh` inside an exec cell, in the sandbox (`docs/ARCHITECTURE.md` section 6; `policy/governed.py:89-94`). A cell cannot ask in the middle: an `approve` decision inside exec becomes a block (`plugins/boopis/exec/calls.py:154-161`). So the ask is on the `exec` call itself, at `pre_tool_call`, before the cell runs. The card shows the cell's code and lists the `harness.sh` command lines it names when they parse; a cell whose commands do not parse says so.
- **Asks inside governed workers.** Workers are `delegate_task` children. The child runs in a copy of the parent's context (`tools/delegate_tool_child_run.py:1022`), so the approval session key is the parent's (`tools/approval_context.py:143-148`) and the gateway's notify path is taken before any thread callback (`tools/approval.py:1089-1106`); the children's auto-deny callback applies to the CLI fallback only (`tools/delegate_tool_config.py:51-55`). [inferred from code] A worker's card reaching the person in the app is **[verify]** (live test 11.10). If it does not, Supervised and Auto-accept edits are unavailable for governed sessions on that engine, with the reason (fail closed), and the owner is told; no silent fallback.

### 5.3 Where each step lives

- **Engine:** the mode's toolsets at create (5.5), `yolo` never set (5.6). `approvals.mode` stays as the owner has it (ADR-0051 decision 6); `off` makes every ask a silent approve (`tools/approval.py:1231-1232`), so with it the three governed steps are unavailable, with the reason "Approvals are off in Hermes's settings, so boopis cannot ask you". Reading `approvals.mode` for this from the plugin is **[verify]** (the plugin reads the profile's config through the public API only).
- **Plugin:** `mode.set` gains `careful: "supervised" | "auto_edits" | "auto" | "full"` and `surface: "session" | "bot" | "cli"` (default `cli`, today's behaviour). `SessionPolicy` (`policy/types.py:74-97`) gains `careful` and `surface`. `policy.check` gains one step after the governed check (`policy/__init__.py:111-117`):
  - `surface == "session"` and the tool is not one of the plugin's own, a read-only tool or a network tool: **block**, "In the Session tab every change goes through ship" (Full access included; governed already blocks these, `policy/governed.py:84-115`). This keeps the engine's direct-write tools refused even when an exec cell calls them through `dispatch_tool`.
  - `careful == "supervised"` and the tool is `ship` or `exec`: ask, rule `careful.supervised`.
  - `careful == "auto_edits"` and the tool is `exec`: ask, rule `careful.auto_edits`.
  - `careful == "auto"`: the governed network ask (`policy/__init__.py:126-129`) is skipped; the rules engine and the `ask` rules decide.
  - `careful == "full"`: every `_ask` outcome becomes allow; blocks are unchanged.
  - `surface == "session"` and `careful` unset: block everything but read-only tools (fail closed: a session-tab session whose step is unknown does not act).
- **Cards:** the engine's approval gate, answered `once`, `session` (no more asks of that rule this session) or `deny`; `always` is never sent for these cards (ADR-0051 decision 4). Session approvals expire at the engine's 300 s and become the shared ask card (owner default; `approval-surfaces.md`).
- **The rules engine in sessions.** `rules-engine.md` runs step 4c in bot sessions (its open question 2 proposed bots only). The owner's Auto step makes it run in Session tab sessions at **Auto**, and also at Supervised and Auto-accept edits, where it can only add asks. At Full access it does not ask. The per-bot rows (step 4b) never apply to a session.

### 5.4 Availability: when a step cannot be honoured

The launch step and every change read `careful.<step>` from the map. A step that cannot be honoured is unavailable, with its reason; boopis never runs a different step than the one shown, more careful or less.

| Step | Unavailable when |
|---|---|
| all | the plugin is absent or its describe failed; `toolsets` or `cwd` is not a create param; the yolo check fails (5.6) |
| Supervised, Auto-accept edits, Auto | the model (governed: every ladder tier) is not frontier (ADR-0037, `frontier` in describe); `approvals.mode` is `off`; worker asks do not reach the person (5.2, after the live check) |
| Auto-accept edits, Auto | no trusted gate command for the folder, or the gate's sandbox cannot run and `gate.allow_unsandboxed` is off (`ship/run.py:88-97`) |
| Full access | `hx` is missing (nothing can be shipped, `ship/run.py:79-81`) |

### 5.5 Toolsets

The Session tab sends `toolsets: ["boopis"]` for every step (governed already does, `live-provider.ts:51-52`; ungoverned today sends none and gets the profile's, `:190`). The engine toolsets that write directly are refused in the Session tab, kept as data in `plugins/boopis/policy/session_refused_toolsets.json`: `terminal`, `file`, `code_execution`, `computer_use`, `debugging`, `coding` and every `hermes-*` bundle (`toolsets.py:92-222`). A later "add a toolset" control reads this list and the map; a refused toolset is never offered.

### 5.6 The yolo check

Another client can switch a session's yolo on at any time (`config.set {key: "yolo"}`, `gateway/session_busy_controls.py:132-161`), and yolo approves plugin cards without a person (`tools/approval.py:1231`). The plugin cannot see it (the state is not on the public plugin API). So the client checks: after create and before each submit in a governed step, `config.get {session_id, key: "yolo"}` (`gateway/session_config.py:69-71`); `"1"` is switched back with `config.set {key: "yolo", value: "off"}`, and if that fails the message is not sent. Whether the engine emits an event when yolo changes is **[verify]**.

## 6. Mid-session changes

### 6.1 The rule

Everything can change (owner decision). Each change applies at the next turn boundary: while a turn runs, the change is held and the line says "Applies when this turn ends". No change stops or alters a running turn. Then:

| Change | How | Engine session | Cache |
|---|---|---|---|
| Model, Full access | the engine's model switch in place: `session.mutate {operation: "model"}` (6.2) | same | the next reply re-reads the context uncached (6.4) |
| Model, governed | `plugin.boopis.cascade.start_tier` (existing, `docs/PROTOCOL.md` section 3) | same | none for the orchestrator |
| Effort | `session.mutate {operation: "reasoning", payload: {effort}}` (`hermes_state_mutations.py:22-27`) | same | **[verify]** per provider: some drop cached messages when thinking settings change |
| Step among Supervised, Auto-accept edits, Auto | `plugin.boopis.careful.set` (new): a plugin policy field only, no toolset or prompt change | same | none |
| Step to or from Full access | governed ↔ ungoverned; `mode.set` is locked after the first prompt (`hx.mode.locked`, `crates/hx-proto/errors.json:12`) because the governed contract is in the cached system prompt | **new** (6.3) | full miss |
| Folder | new engine session (6.3). The engine has an in-place `workspace` mutation (`hermes_state_mutations.py:28-29`), not used: the plugin's folder, project settings, gate command, protected paths and checkpoint chain are bound when the session opens (`policy/types.py:75`) | **new** | full miss |
| Skills | rendered once into the frozen policy (`gateway/session_controls.py:521-529`) | **new** | full miss |
| Toolsets | fixed at create (invariant 4) | **new** | full miss |

Several changes made together go out as one: the strongest (a new engine session) carries the others.

### 6.2 The model switch in place (verified, and a correction)

- The plan names `tui_gateway/model_switch.py`. That is the legacy TUI server's switch. On the canonical gateway boopis talks to, the engine's model switch is `session.mutate {session_id, request_id, expected_revision, expected_generation, operation: "model", payload: {model, provider?, reasoning?, confirm?}}` (`gateway/session_mutations.py:20-23`, `:148-154`; `hermes_state_mutations.py:13-17`), resolved through the same `hermes_cli.model_switch` pipeline (`gateway/session_mutation_model.py:55`).
- **boopis's current switch is refused by this engine.** `config.set {key: "model"}` raises `use_session_mutation_model` before anything is read (`gateway/session_busy_controls.py:31-35`), and the canonical `config.set` routes `model` there (`gateway/session_tui_config.py:17`, `:185-191`). boopis sends it in four places: `host/live/details.ts:394`, `host/live/attribution.ts:161`, `:172`, `host/live/council.ts:311`. S0 moves all four to `session.mutate` (the `@model` once path and councils included); a live test confirms the refusal and the fix (11.8).
- **Running turn:** a model or effort pick on a busy session is stored and applied to the next turn (`gateway/session_mutations.py:133-142`, `gateway/session_deferred_pick.py:18-33`). boopis shows it as held.
- **Fences:** `expected_revision` and `expected_generation` come from the resume snapshot (`gateway/session_controls.py:742-743`); a stale fence is refused with the fresh fences attached, and boopis retries once (`:895-900`).
- **Confirmation:** the engine's selection guards (cost, data policy, large context) refuse a flagged target with `status: confirmation_required` and a `confirm` token bound to that target (`gateway/session_mutation_model.py:346-371`). boopis shows the guard's reason in the change sheet and resends with the token only after the person confirms. Today's `confirm_expensive_model: true` on every call (`details.ts:394`) is an automatic yes and goes (invariant 6).

### 6.3 Continuing on a new engine session

**What is carried: the history, cut to a budget; never a model-written summary.**
- *Why not a summary:* a summary is a model call that can drop or invent facts (invariant 5), costs money and time on every change, and the engine has no read-only summary to reuse (its compress `preview` reports counts, `gateway/session_mutation_compress.py:57-61`). T3 makes the same choice: a budgeted selection of the thread, not a summary (FEATURE-LOGIC §5.3).
- *What:* the visible user and assistant messages, newest first, until the budget is spent: 16,000 tokens by default, clamped 1,024-64,000 (T3's numbers), estimated at 4 characters per token. Tool rows are not carried; each kept ship becomes one line, "ship <id>: changed a.ts, b.ts", from the parent's ledger (`checkpoint.list`). What did not fit is counted, never invented: "12 earlier messages are not included; they stay in this thread above".
- *How it reaches the model:* the plugin adds a fixed `<boopis-continued v="1" from="<parent id>" because="…">` block to the **first user message** of the new session through `pre_llm_call`, as feedforward does (ADR-0055 decision 6: appended to the user message, persisted and replayed, never the system prompt). The carried text is the new session's own history from then on, so resume needs nothing more.

**Steps** (client and plugin):
1. The current turn ends (or the change waits for it).
2. The client reads the parent's messages with `session.transcript {session_id, order: "oldest"}` (as `childTranscript` does, `live-provider.ts:540-546`).
3. The client creates the new engine session with the new settings (section 3.3) and calls `plugin.boopis.continue.arm {session_id, parent_session_id, because: string[], rows: [{role, text}], budget?}`. The plugin renders the block (one implementation; the client never writes model-facing text) and arms it for the next turn.
4. The plugin writes the link: in the new session's `session.opened`, extra fields `parent_session_id`, `continued: {because, messages_carried, messages_omitted, tokens_est}`; in the parent's ledger, `session.closed {reason: "continued", next_session_id}`.
5. The client hides the parent from the list (`session.mutate {operation: "sidebar", payload: {hidden: true}}`, `hermes_state_mutations.py:50-51`) and detaches it with `end_reason: "continued"` (`gateway/session_controls.py:759-783`). The parent is not deleted: its transcript stays readable.
6. The visible thread now binds to the new engine session. Its title is the thread's (`session.title`).

**Failure.** If 3 fails (create, `mode.set`, the yolo check or `continue.arm`), the new session is detached with `end_reason: "launch_failed"`, the thread stays on the parent with its old settings, and the line says "Settings were not changed: <reason>". Nothing is half switched.

**One thread, a chain of engine sessions.**
- The UI's conversation keeps an ordered list of engine session ids; the last is live. On load, `plugin.boopis.continue.chain {session_id}` walks `parent_session_id` back through the ledgers and returns `[{session_id, opened_at, because}]`, oldest first; each part's transcript is rendered in order, with its line between them. (S1's session-metadata store will hold the chain too; the ledger stays the record.)
- **Checkpoints across the chain:** `checkpoint.list {session_id, chain: true}` returns the kept ships of every part, each with its `session_id`. A rewind to a ship of an earlier part is allowed only when that part's folder is the current folder (`checkpoint-rewind.md` section 4).

### 6.4 What the person sees

One line in the thread, at the boundary, quiet (the v7 system line):
- new engine session: **"Settings changed: continued with X"**, X naming the new values ("Full access", "~/code/app", "skills: pdf", joined with "and");
- in place: **"Model changed to X"**, **"Effort changed to X"**, **"Permissions changed to X"**.

Under a line whose change misses the cache, its cost: "The next reply reads about 18,000 tokens without the cache (about $0.05)". Tokens are the session's measured context (`session.info` usage) or the carried estimate; dollars are computed from the price table for the new model (input price minus cache-read price, plus cache write when the provider bills it), never stored (invariant 3). A model with no price shows "cost unknown" (invariant 5). The engine's own large-context guard fires from 100,000 tokens (`hermes_cli/model_selection_guards.py:84-133`); boopis shows the cost on every miss, not only above it.

## 7. Protocol changes

| Where | Change |
|---|---|
| `plugin.boopis.mode.set` | adds `careful`, `surface` (section 5.3) |
| `plugin.boopis.careful.set` (new) | `{session_id, careful}` → `{careful, applies: "now" \| "next_turn"}`. Only between Supervised, Auto-accept edits and Auto; to or from `full` it is `hx.mode.locked` with "continue in a new session". Writes `mode.changed {scope: "careful"}` |
| `plugin.boopis.continue.arm` (new) | section 6.3 step 3 → `{armed, messages_carried, messages_omitted, tokens_est}` |
| `plugin.boopis.continue.chain` (new) | section 6.3 → `{chain: [{session_id, opened_at, because}]}` |
| `plugin.boopis.describe` | adds `{cwd}` input and the fields of 4.1 |
| `plugin.boopis.checkpoint.list` | adds `chain?: boolean`; entries gain `session_id`, `kind`, `turn_id` (`checkpoint-rewind.md`) |
| `apps/shared/boopis-v1.openrpc.json`, `docs/PROTOCOL.md` section 3 | the above |
| UI ↔ engine | `session.create` params (3.1); `session.mutate` for model, effort and sidebar; `config.get`/`config.set` yolo; `session.detach` with `end_reason` |

No host change in S0 beyond what the UI already proxies. The Local API is unchanged.

## 8. Ledger

`session.opened` extra fields: `careful`, `surface`, `parent_session_id?`, `continued?`. `session.closed {reason: "continued", next_session_id}`. `mode.changed {from, to, scope: "careful"}`. All are fields of existing types (`docs/LEDGER.md:22-42`); no new type.

## 9. Fail closed, in one list

- No plugin, no `toolsets` or `cwd` create param: no Session tab session.
- `mode.set` or the yolo check fails: the new session is detached and never bound.
- Unknown `careful` on a session-surface session: only read-only tools run.
- A step that cannot be honoured is unavailable, never swapped.
- A settings change that fails leaves the old engine session and settings in place.
- An engine confirmation is never answered without the person.

## 10. Owner questions

1. **Changing between the three governed steps in place.** It touches no toolset and no prompt, so it costs no cache; the decision's text says permission changes continue on a new engine session. Proposed: in place for Supervised ↔ Auto-accept edits ↔ Auto; a new engine session only across the Full access line. (section 6.1)
2. **Auto and Auto-accept edits need a gate.** Without a trusted gate command for the folder they are unavailable (Supervised and Full access remain). Proposed: yes, since "ships apply when the gate passes" means nothing without a gate. (section 5.4)

## 11. Acceptance tests

Unit (UI, Vitest) unless marked e2e (a real engine, `tests/e2e/`) or plugin (pytest).

1. **No stop on switch:** with session A running, selecting B sends no `session.interrupt` (recorded frames); A's turn finishes; its list row goes from running to done. (e2e)
2. **Background turn redraw:** A streams 5 steps and text while B is shown; selecting A shows the 5 steps, the text so far and a clock that continues from the turn's start.
3. **Stop applies to the shown session only:** mod+. on B while A runs interrupts B only.
4. **Replay gap in the background** reloads only that session.
5. **Create params:** the first send of a launch with folder, model, provider, effort `high`, skills `["pdf"]` sends exactly `{source, client, cwd, cwd_explicit: true, model, provider, reasoning: "high", skills, toolsets: ["boopis"]}` and never `title`, `yolo` or `checkpoints`. (unit, frame assertion; e2e: `session.info` reports the folder and model)
6. **Param gating:** with `session_create.parameters` lacking `reasoning`, the effort control is unavailable with its reason; lacking `toolsets`, the Session tab refuses to create.
7. **Fail closed at create:** `mode.set` failing detaches the new session (`end_reason: "launch_failed"`), sends no `prompt.submit`, and shows the reason.
8. **Model switch:** in Full access a model pick sends `session.mutate {operation: "model"}`, never `config.set {key: "model"}`; on a running turn the pick is held and applied next turn; `confirmation_required` shows the reason and resends with the token only after the person confirms. (e2e: `config.set model` is refused with `use_session_mutation_model` on the pinned engine)
9. **Policy per step (plugin):** for each step, a table of calls (`ship`, `exec`, `web_extract`, `write_file` via `dispatch_tool`, a rule match) gives the decision of section 5.3; `write_file` is blocked at every step on the session surface; an unset `careful` allows only read-only tools.
10. **Worker asks (e2e, [verify]):** Supervised, governed: a worker's `ship` raises a card in the app; deny restores nothing (nothing was written) and the attempt sees the refusal.
11. **Availability:** no trusted gate command makes Auto-accept edits and Auto unavailable with the reason; a non-frontier model makes the three governed steps unavailable; `approvals.mode: off` makes them unavailable.
12. **Yolo check:** a session whose yolo another client turned on is switched back before the next submit; if that fails, nothing is sent.
13. **Careful in place:** Supervised → Auto mid-session writes `mode.changed {scope: "careful"}`, keeps the engine session id, and shows "Permissions changed to Auto"; during a running turn it applies after the turn.
14. **Continuation (e2e):** changing the folder after two turns creates a new engine session with the new `cwd`; its first user message carries the `<boopis-continued>` block with both turns; the parent is hidden and detached; `session.opened` has `parent_session_id`; the parent's ledger has `session.closed {reason: "continued"}`; the thread shows one line "Settings changed: continued with <folder>" and both parts in order after a restart.
15. **Continuation budget (plugin):** a history over budget carries the newest messages that fit and counts the rest; the block never exceeds the budget; ships appear as one line each.
16. **Continuation failure:** `continue.arm` failing leaves the thread on the parent with its settings and shows "Settings were not changed".
17. **Cost line:** a model switch with a priced model shows tokens and dollars computed from the price table; an unpriced model shows "cost unknown".
18. **Capability map:** every control in `list`, `right`, `composer` and the launch step reads the map (a guard test fails on a direct probe or a flag read outside `details.ts`); a failed plugin describe makes every plugin-backed capability `ok: false` with a reason.

## 12. Verification log

| Claim | Result |
|---|---|
| The canonical gateway's create params | verified: `CREATE_FIELDS` (`gateway/session_policy.py:15-20`), published with `title` (`gateway/session_controls.py:569-570`), unknown refused (`gateway/session_policy.py:442-445`) |
| `cwd`, `cwd_explicit` | verified (`gateway/session_policy.py:456-463`, `:488-489`); the legacy server's own resolution is `tui_gateway/session_workdir.py:25-58` |
| Effort is `reasoning`, with the engine's levels | verified (`gateway/session_policy.py:663-666`, `hermes_constants.py:1141-1168`); the legacy server reads `reasoning_effort` (`tui_gateway/methods_session_model_guard.py:42`) |
| Skills are rendered once at creation | verified (`gateway/session_controls.py:521-529`, `gateway/session_policy.py:782-791`) |
| A titled create resumes an existing session | verified (`gateway/session_controls.py:511`) |
| One connection streams every subscribed session | verified (`gateway/session_controls.py:708-713`, `:759-783`); boopis never detaches (no call in `apps/desktop/ui/src`) |
| The model switch is `session.mutate model`; `config.set model` is refused | verified in source (`gateway/session_busy_controls.py:31-35`, `gateway/session_tui_config.py:17`, `gateway/session_mutations.py:20-23`); **[verify]** on the pinned runtime |
| A pick on a busy session waits for the next turn | verified (`gateway/session_mutations.py:133-142`, `gateway/session_deferred_pick.py:18-33`) |
| A switch re-reads the context uncached; the engine's guard threshold | verified (`hermes_cli/model_selection_guards.py:84-133`) |
| yolo and `approvals.mode: off` approve plugin cards | verified (`tools/approval.py:1231-1232`); another client can switch yolo (`gateway/session_busy_controls.py:132-161`) |
| A cell cannot ask | verified (`plugins/boopis/exec/calls.py:154-161`) |
| Worker cards reach the person | [inferred] from `tools/delegate_tool_child_run.py:1022`, `tools/approval_context.py:143-148`, `tools/approval.py:1089-1106`; **[verify]** live |
| `session.close` on the canonical gateway | not in its handler table (`gateway/session_controls.py:225-245`); **[verify]** |
| Concurrency of running sessions; a yolo-change event; effort changes and caching | **[verify]** |
