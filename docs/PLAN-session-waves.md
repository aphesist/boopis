# Session tab waves (from the T3 Code package), plan for the owner

Written 23 November 2026. Sources:
- the T3 Code package (`T3CODE-MASTER.md`: walkthrough §16, feature logic §0, §11, §12);
- boopis `AGENTS.md` invariants;
- a first check of the Hermes source (the scratchpad copy the w31 specs used).

**The principle.**
- **Session is the hands-on harness:** the person picks the model, effort, permissions and workspace, and steers, reviews, commits and rewinds. Autonomy stays in Bots.
- **T3 Code sets the features, organisation and logic. It does not set the look:** the Session tab uses design system v7 (the Bots tab's Grok-based language) and the calm rules.

## Facts already checked in Hermes (no longer [inferred])

- **`session.create` takes a working folder and model:** it reads `cwd` (`tui_gateway/session_workdir.py`) and `model`/`provider` (`methods_profiles.py`, `methods_session_model_guard.py`).
  - boopis's live create sends neither (`host/live-provider.ts:190`).
  - So launch settings are a boopis gap, not an engine one.
- **Hermes has a durable queue.** Queued prompts are rows in its SQLite (`session_admissions`, FIFO per session, `hermes_state_runtime.py`, `gateway/session_automation.py`). `prompt.steer_queued` and `prompt.replace_queued` move or replace a queued prompt.
  - This contradicts `PLAN.md` B16 ("the engine has no queue") and package question 4.
  - Consequence: steer/queue uses the engine's queue and **no plugin queue is built** (one layer per mechanism).
  - Still to check on a live engine: that a queued prompt survives a gateway restart.
- **The engine can switch models mid-session:** `tui_gateway/model_switch.py`. Section C below covers what that means for the caching invariant.

## Waves

Order: 0.1.10 (w29) → 0.2.0 (the w30 base merge, macOS and the notch) → w31 foundations, which are already specced. The Session waves start in parallel with w31's implementers wherever the areas don't overlap.

### S0: the three small fixes (in 0.2.0 if the owner agrees)

One writer in the UI and host session area, one in the plugin.

| Branch | Work | Package roadmap # |
|---|---|---|
| `w32/session-core` | Switching sessions never stops a running turn: per-session feeds, the running one stays live. `session.create` carries `cwd`, model, provider, effort and skills, from a launch step. One `SessionCapabilities` map, from `runtime.describe` plus `plugin.boopis.describe`, that every control reads. | 1, 2, 3 |
| `w32/rewind` | Register `checkpoint.rewind` as a journaled ship, so it can be undone, behind an isolation guard; add a `checkpoint` item to the turn. | 4 |

Specs: `session-launch.md` (launch step, capabilities, the permission scale) and `checkpoint-rewind.md`.
ADRs: 0057 (the permission scale and launch settings) and 0058 (rewind: journaled, its gate rule, its isolation rule).
The launch step's UI goes to the lab for the owner's pick first.

### S1: workspaces and follow-ups

| Branch | Area | Work | # |
|---|---|---|---|
| `w33/session-meta` | plugin | A session-metadata store (project, worktree, parent, pin, settled, PR) in the profile home, with `session_meta.*` RPCs and search (titles, branch and PR first, then text through an FTS5 index) | 5, 18 |
| `w33/worktrees` | host | Project records and a worktree per session: a managed root, a temporary branch renamed from the first message, staged create and remove, cleanup that never deletes local changes | 6, 14 |
| `w33/followups` | UI | Steer / Queue / Stop and send on the engine's queue: a default plus a one-key opposite, a visible queue with Send now, edit, cancel and promote | 7 |
| `w33/session-inbox` | UI | The session list as a work queue: Needs you, Working, Pinned, Recent, Settled, Archived; snooze and settle with undo | 8 |

Specs: `session-meta.md`, `worktrees.md`, `followups.md`, `session-inbox.md`.
ADRs: 0059 (where worktrees live) and 0060 (where the metadata store lives).

### S2: review and ship

| Branch | Area | Work | # |
|---|---|---|---|
| `w34/git-flows` | host | Commit, push and PR from the ship card: host git, message from a one-shot auxiliary call, classified errors (stderr never shown), gate-aware, no agent trailers | 9 |
| `w34/diff-review` | UI | The finished turn (a collapsed work log with a one-line summary, the changed-files card), diff scopes (turn, session, uncommitted, branch vs base), review comments as composer chips, Show all / Hide successful / Zen | 13 |
| `w34/terminal` | host and UI | A terminal per session in its worktree: host PTY, acked Channel, scrollback, attach a selection as a chip. The right panel becomes one panel with tabs. | 12 |
| `w34/plan-turn` | plugin | Plan turn: a per-turn veto of `ship`, `dispatch` and writes; "Run this plan" | 11 |
| `w34/fork-side` | UI and plugin | Fork from any turn (branch plus worktree at that checkpoint); side chat (`/side`, `/btw`) as a hidden child | 15 |

Specs: `git-flows.md`, `diff-review.md`, `terminal.md`, `plan-turn.md`, `fork-side-chat.md`.
ADRs: 0061 (forge scope) and 0062 (terminal renderer, after a measured comparison on the owner's Hyprland machine).

### S3: polish and guards

- Notifications by T3's rule: only when the window is unfocused.
- Usage limits as data: quota, reset time, fallback model.
- Context tick.
- A data-driven keymap, with the palette covering every action.
- The settings cascade: device → project → project file.
- History paging and windowing, with a wire-budget e2e test.
- A context-budget CI check and evals for model-facing text.
- A replay dev profile.

Package #: 10, 16, 17, 19, 20, 21.

**Skipped:** T3 Connect, guest links and remote pairing until boopis has its relay; Effect; telemetry (stays off).

### The Session screen's design (before any S0 UI)

The owner said the normal-session screen discussion comes next. A lab pass renders the Session tab in v7:
- the launch step;
- the thread with inline approvals and decline-with-feedback;
- feedforward and blanks;
- the finished turn;
- the right panel's tabs;
- the inbox list;
- the commit dialog;
- the status with the model logo's shimmer (owner pick P4).
The owner picks; then S0's UI is built.

## Team (per the previous package's configuration)

- **Specs and ADRs:** one spec writer, on `w32/session-specs`.
- **Design:** one lab agent, rendering Session previews for the owner.
- **Build:** one implementer per branch and area, in its own worktree. Frontier models for host and plugin, mid-tier for UI once the spec is fixed.
- **Review:** a reviewer in a fresh context.
- **QA:** a QA pass against a real engine.
- **Integration:** the lead integrates on `w<N>/integrate`. Gates run on the merged code.

## Where T3's model and boopis's governance conflict (the owner decides)

**A. Permission modes.** T3 has four ranked modes (Supervised / Auto-accept edits / Auto / Full access). boopis has governed vs ungoverned plus approvals. Proposed: one "How careful" scale in the launch step, mapped as follows (one choice, as the calm rules prefer):

| Mode | What it maps to |
|---|---|
| Supervised | governed; every ship and every shell command asks |
| Auto-accept edits | governed; ships apply when the gate passes; shell asks |
| Auto | governed; only the rules engine asks |
| Full access | ungoverned |

**B. Writes outside `ship`.** In ungoverned (Full access), Hermes's own tools write directly, which breaks "only `ship` writes" for those sessions. The choices:
- (1) Refuse those toolsets in the Session tab, so the invariant stays absolute and Full access only removes the asks.
- (2) Allow them, snapshot the worktree before and after each turn, and label the result "unjournaled".

Recommended: (1). It keeps every change journaled and rewindable.

**C. Fixed at `session.create` vs T3 changing things mid-thread.** Caching fixes the launch settings. Proposed:
- the model may change for the next turn, since the engine supports it (a cache miss for that turn, shown in the cost);
- the workspace, permissions and toolsets never change mid-session; changing them offers "Continue in a new session", which forks with a summary.

**D. Checkpoints.** T3 snapshots the whole worktree every turn; boopis checkpoints only ships. With (B1) every change is a ship, so rewinding any turn works. With (B2) only snapshots could restore. Rewind requires a worktree, not a shared checkout (T3's rule).

**E. Is a rewind gated?** It is a ship. Proposed: it is journaled and undoable but **not gated**, so a failing gate can never trap the person in a bad state.

**F. Session approvals and blanks.** Bots' approvals never expire, and session blanks wait 30 s, 60 s or 2 min. Session *approvals* (Supervised mode) keep the engine's 300 s expiry. Proposed: keep 300 s, and an expired approval becomes the shared ask card.

**G. One layer per mechanism.**
- Queue: the engine's queue (fact above), not a plugin queue.
- Metadata: one small store in the profile home, never a second orchestrator database.
- Git: the host's own.
- PR text and commit messages: an auxiliary call charged to the person and logged on the ledger.

**H. Forge scope.** GitHub first, through `gh` plus REST. GitLab and Forgejo later?

**I. Settlement defaults.**
- A session is settled when its branch is merged, or after 7 idle days.
- Settling never deletes a worktree with local changes.
- A clean worktree is removed on settle only if the owner turns that on (T3 has it off).
