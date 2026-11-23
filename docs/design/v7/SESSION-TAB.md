# The Session tab in v7: a walkthrough

Status: design for the owner's pick, 23 November 2026. No kit implementation yet.

**The idea.** Session is the hands-on harness; Bots is the team that works on its own. The person picks the model, effort, permissions and workspace, then steers, reviews, commits and rewinds. T3 Code's study (`t3code-package/01-LIVE-WALKTHROUGH.md`, `02-FEATURE-LOGIC.md`) sets what the tab contains: its features, flows, states and content. It sets nothing about the look. The look is the v7 kit the Bots tab uses (`DESIGN-SYSTEM.md`): the same sidebar, title pill, bubbles, activity line, tool rows, AskCard, the mark, cards, details pane, composer and dock. Session adds only what Bots does not need, as new v7 components listed at the end for approval. The logic comes from the binding plan (`notes/docs/PLAN-session-waves.md`) and its owner decisions.

Screens are in the boards folder `ds-v7/session/` (dark and light), with contact sheets `ds-v7/session-sheet-1.jpg` and `-2.jpg`.

---

## 1. The empty Session tab and adding a project (S10)

What the person sees: the Sessions / Bots switch at the top of the sidebar, an empty inbox, and one line in the middle, "Add a folder to start", with Add a project, Import sessions and the composer.
- A project is a folder. Adding it is a folder picker; nothing is copied.
- **Import** lists the person's existing Claude Code and Codex sessions found on this computer, by project, and brings the chosen ones in as sessions (read-only history, continued on a new engine session).
- *Differs from T3:* no onboarding wizard of its own; boopis's first run already covers models and sign-in. The empty state is one line (R-calm-4).

## 2. The launch step (S1)

What the person sees: a "New session" card in the column: Project, Workspace (New worktree or This checkout), Model, Effort, and "How careful": **one 4-step scale** (Supervised / Auto-accept edits / Auto / Full access) with one line that explains the chosen step. The first message starts the session.
- **One scale, one choice** (owner decision). It maps to governance: Supervised asks before every ship and every command; Auto-accept edits applies ships when the gate passes and asks for commands; Auto asks only where the approval rules say; Full access asks nothing.
- **Full access still records every write** (owner decision): every change still goes through `ship`, so every turn is rewindable. Full access removes the asks, never the journal.
- **Worktrees live outside the repo**, in a managed root; the branch takes a temporary name and is renamed from the first message.
- The settings are passed to the engine at `session.create` (cwd, model, provider, effort, skills) and fixed for that engine session.
- Two options are rendered: the scale as one segmented track (A, recommended) or as four rows (B).
- *Differs from T3:* T3's default is Full access and its permissions sit under the composer as an icon row; boopis starts Supervised (a setting) and the scale lives in the launch step and the composer's line.

## 3. A running turn, Supervised (S2)

What the person sees: their message, the agent's short acknowledgement, a collapsed "Read 6 files, searched 2 patterns" line, and a **tool row** for the change, waiting inline: Hold to allow once, Always allow this session, Decline. The status line is the answering **model's logo** (owner pick P4), still while it waits. The composer's placeholder reads "Send feedback to decline this request".
- **Decline with feedback:** typing in the composer while a change waits declines it and sends the reason as the next message.
- **Feedforward** marks what boopis will act on as the person types (the mark, `DESIGN-SYSTEM.md` 17); a reading is opened with alt+Down and chosen inline before sending.
- A Supervised approval keeps the engine's 300 s expiry; an expired one becomes the AskCard (plan decision F).
- The sidebar row gets an amber "Approval" badge, and the session moves to Needs you.

## 4. Steer or queue while it runs (S3)

What the person sees: Enter steers the running turn (an inline "Steer" line in the thread); ctrl Enter queues. Queued messages wait above the composer, numbered, with edit, cancel and Send now. A hint under the composer names both keys.
- **The engine's own queue** (plan fact): queued prompts are rows in Hermes's store; Send now promotes one (`prompt.steer_queued`), edit replaces it (`prompt.replace_queued`). No plugin queue.
- The default (steer or queue) is a setting; the one-key opposite is ctrl Enter.
- Queued messages run in order when the turn ends, each as its own turn.

## 5. A blank, waiting then lapsed (S9, S4)

What the person sees: inside the agent's reply, a dashed gap in amber with a countdown and "waiting for you"; the agent is paused. Answered in time, the gap turns into the person's words in a solid accent line and the reply goes on. Unanswered, the agent goes on with its guess ("(my guess)") and the question stays as an **AskCard** under the reply; a late answer is sent as a correction.
- Blanks are for sessions only; bots ask through approval cards (the same AskCard, approval variant).
- The wait is a setting (30 s, 60 s by default, 2 min).

## 6. The finished turn (S4)

What the person sees: one line, "Worked for 59s: changed 2 files, ran 1 command" (the work log, collapsed); the answer; the **changed-files card** with per-file counts and Open diff; the **checkpoint** row with Undo, Edit from here and Fork, and the model, time and cost.
- **Rewind is a journaled ship, not gated** (owner default): it can be undone, and a failing gate can never trap the person in a bad state. It needs a worktree, not a shared checkout.
- Fork makes a new session from that checkpoint, on its own branch and worktree.
- How much of the work log shows is a setting: Show all, Hide successful, or Answers only. Approvals, questions and errors always show.

## 7. The right panel: one panel, tabs (S5, S13, S14, S15)

What the person sees: the details button opens one panel on the right, with tabs **Diff, Files, Terminal, PR** (and Side chat when one is open).
- **Diff** (S5): scopes This turn, This session, Uncommitted, Branch against its base; stacked or split. A comment on a line becomes a **reference chip** in the composer, so the next message carries it.
- **Files** (S13): the session's worktree as a searchable tree; a file opens read-only; "Mention" puts it in the composer as an @ chip.
- **Terminal** (S14): a real shell in the session's worktree, with its path and branch; a selection attaches to the composer as a chip.
- **PR** (S15): the session's pull request: title, checks, review state, Open in the browser, and Update from the session.
- *Differs from T3:* no built-in browser or device simulators (out of scope); the panel follows the details pane's rules (pushes the work, overlays under 900).

## 8. The commit dialog (S6)

What the person sees: the branch, the files (check glyphs, no square boxes), a message written from the changes (editable), and one stacked action: Commit, Commit and push, Commit, push and open a PR, Commit on a new branch.
- The host commits with the repo's own author; **no agent credits** are added, and they are removed when merging (owner rule).
- The message comes from one auxiliary call, charged to the person and logged on the ledger.
- GitHub first (`gh` and REST).

## 9. The session list as an inbox (S7)

What the person sees: the Sessions side of the sidebar sorted into **Needs you, Working, Pinned, Recent, Settled** (folded). A row shows the session's title, its branch, the provider mark and a badge. Hovering a row offers Snooze (an hour, this evening, tomorrow, when usage resets, pick a time) and Settle.
- **Settle rules** (owner defaults): a session settles when its branch is merged or after 7 idle days; settling never deletes a worktree with local changes; a clean worktree is removed only if the person turns that on.
- Switching sessions never stops a running one.
- Two options are rendered: sections in the list (A, recommended) or filter chips over one list (B).

## 10. The command palette in the composer (S11)

What the person sees: typing **/** lists commands (`/model`, `/side`, `/btw`, `/clear`, `/compact`, then the skills and plugin commands of the session); **@** lists files of the worktree; **$** lists skills. Each list is the kit's menu, anchored above the composer.
- ctrl K is the app's palette for everything else (new session in a project, find in the session, go to file, restart the agent session, settings).

## 11. Side chat (S12)

What the person sees: `/side` (or `/btw`) opens a side chat as a tab of the right panel: its own short thread and composer, "Context from Fix the dock's half paint", and Add to chat to bring an answer into the main thread.
- It runs as a hidden child that never touches the main session's context; the main turn keeps running.

## 12. Mid-session changes (S8)

What the person sees: changing a setting from the composer's line or the session's details continues the thread with one line: "Settings changed: continued with Auto-accept edits", and the extra cost of the cache miss.
- **Everything can change mid-session** (owner decision). The model switches in place (the engine's `model_switch`); a change to permissions, workspace or tools continues the same visible thread on a new engine session, with the history or a summary. The caching invariant holds per engine session; no Hermes patch.

## 13. Usage limits and the context tick (S16)

What the person sees: the composer's line carries a **context tick** (used against the window, as dots, then "76k / 200k" on hover); when a subscription limit is near, the line shows it, and when it is reached a one-line notice says "Limited until 14:00" with Switch to the fallback model and Wait and resume.
- Limits come from the provider's own quota (reset time), never estimated.
- Auto-resume at the reset and the fallback model are settings.

## 14. After a restart (S17)

What the person sees: a session that was running when the app closed shows one line, "Continued after a restart", and goes on; a queued message is still queued.
- Sessions continue after restarts (a setting, on by default); the queue survives in the engine's store.

## 15. Errors (S18)

What the person sees: one line where the trouble is, with one way out, never a stack trace.
- The engine is not running: "boopis's engine stopped. Start it again" (Restart).
- No model for this session: "No model is signed in for this session" (Choose a model).
- The gate failed: the turn's card says "failed" in red with the failing check and Fix and retry.

## 16. The session's details (S20)

What the person sees: the title pill opens the details pane, the same as a bot's: the session's title, its project, branch and worktree, the model, effort and permissions (each changeable, which makes the S8 line), context and cost against the cap, and the PR if there is one; then Pin, Fork and Settle in the overflow.

## 17. Session settings (S19)

What the person sees: Settings > Sessions, with a scope picker (This device or This project) at the top of the page:
- New sessions: default project folder, workspace (worktree or checkout), model, fallback model, effort, how careful.
- While it runs: Enter steers or queues; Wait for my answer (30 s, 60 s, 2 min); work log shows (all, failures, answers only).
- Worktrees: where they live; remove clean worktrees when settled (off).
- Inbox: settle merged sessions; settle after 7 idle days; snooze until usage resets; resume after limits; continue after restarts; keep the computer awake while a session works.
- Git: remove agent credits when merging; GitHub account.
- Two options are rendered for the scope picker: a segmented control in the page head (A, recommended) or a select beside the title (B).

---

## Where boopis differs from T3 on purpose

| T3 Code | boopis | Why |
|---|---|---|
| Its own look, sidebar and settings structure | the v7 kit, the Bots tab's components and Settings | one app, not two (the owner) |
| Full access by default; writes go straight to disk | Supervised by default; every write goes through `ship` on every step | journal and rewind for every turn (owner decision) |
| Checkpoints are snapshot commits of the whole worktree | rewind is a journaled ship, undoable, not gated | boopis's ship and journal (plan decisions D, E) |
| A thread's settings change freely | the model in place; anything else continues on a new engine session, shown as one line | prompt caching per engine session (invariant 4) |
| A queue in the app | the engine's own queue | one layer per mechanism |
| Questions wait in a separate card | blanks inline in the reply, with a countdown, then the AskCard | boopis's blanks (owner decision) |
| Browser and device surfaces, T3 Connect, guest links, telemetry | not in the Session tab | out of scope until boopis has a relay; telemetry stays off |
| Settings cascade device → environment → project → file | device → project → project file | no remote environments yet |

## New v7 components this tab needs (for approval)

| Component | What it is, in v7's language |
|---|---|
| **LaunchCard** | the New session card: a settings card of rows plus the "How careful" card |
| **PermissionScale** | the 4-step segmented track (a pill track at `--fill-2`, the chosen step the segmented thumb) with one explaining line; also the composer line's item and its menu |
| **ToolRow, approval state** | the bot screens' tool row with an inline approval: an amber "Waiting for you" badge and the answers as chips |
| **WorkLog** | one collapsed line with a chevron ("Worked for 59s: ..."), expanding to tool rows |
| **ChangedFilesCard** | an elevated card (radius 18): the count and totals, file rows in mono with +/− counts, Open diff |
| **CheckpointBar** | ghost buttons Undo, Edit from here, Fork under a turn, with the model, time and cost |
| **QueueStrip** | an elevated card above the composer: numbered queued messages with edit, cancel and Send now |
| **SteerLine** | an inline "Steer" line with the steering message as a small bubble |
| **RightPanel** | the details pane's surface with a segmented tab bar (Diff, Files, Terminal, PR, Side chat) |
| **DiffView** | file cards with mono hunks on add/del washes, a scope select, stacked or split; an inline comment card |
| **ReferenceChip** | a mono capsule in the composer (`dock.css:42`), R-inline-1 |
| **Terminal** | a mono well filling the panel, the path and branch in its head |
| **CommitDialog** | a form dialog: file rows with checks, the message field, a split primary pill with its menu |
| **InboxSections** | section heads with counts in the session list, row badges, hover Snooze and Settle |
| **SettingsLine** | the system line ("Settings changed: ...") with the cost |
| **LimitNotice** | a one-line notice above the composer with two actions; the composer line's context tick |
| **ScopePicker** | a segmented control at the head of a settings page: This device, This project |
