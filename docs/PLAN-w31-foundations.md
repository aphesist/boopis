# Plan: the package's w28 "foundations" wave (proposed as w31 here)

Source: boopis-package (BOOPIS-MASTER.md, Parts B, C, E, G, H), owner decisions of 23 Nov 2026. Draft for the owner.

## Naming
The package's waves w28-w33 collide with branches that already exist (w28/launch-video, w29/*, w30/*). Proposal:
package w28 -> w31 foundations, w29 -> w32 BOOPIS bot, w30 -> w33 onboarding, w31 -> w34 routines and teach,
w32 -> w35 bot computer, w33 -> w36 voice, w28c -> w31c calm pass.

## What already exists (verified in the branches, not re-done)
- B27 plugin/hx refresh by content, automatic update when idle: w29/host-lifecycle (CI green, in w29/integrate).
- B28 single instance, token files removed only by their owner: w29/host-lifecycle.
- B30 one host-side room hold for UI, CLI and Local API, kept on disk: w29/rooms-api.
- B31 kanban workers in presence, B40-B46 Local API asks: w29/rooms-api, w30/local-api-0.2.
- S1/C1/T1/S2 enforcement machinery in the plugin (pre_tool_call gate, run cap, monthly budget, claims, bot-to-bot
  labels, part of B47): w30/governed-bots. Its per-bot Allow/Ask/Block tiers are superseded by the owner's single
  rules list (see question 2); the gate, labels, claims and budget code are kept as the base.
- macOS build: w30/macos (green).

## Order
1. Ship the w29 fixes: finish w29/integrate, CI, owner OK, develop + 0.1.10.
2. w30/integrate: w30/governed-bots + w30/local-api-0.2 + w30/macos (+ the host ownership follow-up) = the base for
   0.2.0 and for w31.
3. w31 branches off that base.

## Specs (docs/specs/, written first, owner questions answered before code)
1. specs/host-protections.md (B47 + no self-approval): deny reads of client-token, client-endpoint, gateway.sock and
   the secret sockets for every bot session; denied command heads (boopis connect --ticket, hermes gateway attach,
   approval/answer endpoints); the host refuses an endpoint answer whose TCP peer belongs to the gateway or its
   process tree (Linux /proc/net/tcp -> pid -> ancestry; macOS proc_pidinfo; Windows: endpoint answers refused from
   any process the host did not launch as the app); an approval raised by any bot can be answered only from an owner
   surface (app window, Local API client that is not a bot process); per-client tokens as the follow-up. Stated as
   defence in depth, not a sandbox.
2. specs/rules-engine.md: one global plain-language rules list in Settings, applied to every bot, optional per-bot
   extra rules; default dangerous-action rules pre-filled, editable, removable; anything uncovered runs.
   Check order: engine hardline (fixed) -> deterministic pre-filter for the default rules -> AI reviewer against every
   rule (trusted rules in the system prompt, the action as untrusted delimited input) -> on a match the bot pauses
   and the engine's approval card names the rule (Allow once / Always allow / Deny / Allow all this turn); reviewer
   failure or timeout holds the action (fail closed). "Always allow" drafts a narrow exception rule for the owner to
   edit before saving. Covers every tool (terminal, files, MCP and connector writes, messaging, browser), not only
   shell. Data: <root>/boopis/rules.json with provenance (default | owner | card | chat). The six old categories
   become default rules (migration from w30/governed-bots).
3. specs/team-ops.md: the team operations as host verbs and tools: team.plan (fragment -> plan + plan_hash over the
   actions and the base export hash), apply only by the owner's hold in the app by plan_hash, undo from the snapshot
   taken before apply; room.say/run/log/stop, bot.say/run, session.stop, jobs.get/put; idempotent, dry-run first;
   no approve verb and no apply verb on any bot-reachable channel; audit to house-ops.jsonl. Transport: a
   hx-host-ops-v1 channel on the existing secret channel (peer check + token), and read-only plan endpoints plus stop
   on the Local API. CLI parity: team plan / apply --hash / undo.
4. specs/approval-surfaces.md: the Local API inbox answers once / deny / session / always, the rule link on every
   card, edit-before-approve, the B40 argument summary.

## ADRs
- Where the rules engine runs (the boopis plugin's pre_tool_call for every tool, reviewer through the engine's
  public plugin LLM access; engine approvals.mode stays manual so the engine's own guard never denies on its own).
- The host-ops channel and its verb list (no approve, no apply).
- B47 host protections and the owner-surface rule.
- Wave renumbering.

## Branches (one writer per area, each in its own worktree)
| Branch | Area | Writer |
|---|---|---|
| w31/host-protections | src-tauri local_api + secrets, plugin policy denied paths | host implementer |
| w31/rules-engine | plugins/boopis policy + reviewer, rules.json, migration | plugin implementer |
| w31/team-ops | src-tauri team/, host_ops/, cli | host implementer 2 |
| w31/rules-ui | Settings > Approvals and the approval card (after the owner picks a lab option) | UI implementer |
| w31/integrate | merges, gates on merged code | lead |
Reviewer (fresh context) per branch, max 3 rounds. QA: CI e2e with the fake provider plus the owner's playtest
(this container has no live engine; noted as a gap). Lab: Settings > Approvals and the approval card rendered in
dark and light for the owner's pick before w31/rules-ui is built (Part H rules apply).

## Owner answers (23 Nov 2026)
- Default limits: none for every bot. Budgets and caps are optional and off by default; usage is still shown. The
  $5 default per-run cap is dropped (existing bots' untouched default caps are removed once).
- Per-bot tiers: keep both. One global plain-language rules list for every bot, plus the per-bot Allow/Ask/Block rows
  on top (w30/governed-bots). The rules-engine spec defines the precedence.
- Reviewer model: the cheapest/fastest model among what the owner connected, changeable in Settings > Approvals.
- Calm pass (Part H, w31c): runs in parallel with w31, one UI writer on the library and copy, no overlap with the
  host/plugin writers.
- Wave renumbering: package w28 -> w31 (not objected).
- Spec questions (23 Nov): a global rule beats a per-bot Allow (exceptions are the way to let one bot skip);
  rules apply to bots only, not the owner's own sessions; answering approvals from the island and other clients
  stays on, with "Always allow" from a client saved only as a draft confirmed in the app.

## Owner's design-system v7 picks (23 Nov)

- 01 Geist. 02 radii B default, C as a theme option (coordinator's reading of "B and C look good").
- 03 light shadows A, customizable per theme. 04 cut-out eyes.
- 05 floating pills; search always reachable and toggleable; B (search pill) as a Settings option; more placements to preview.
- 06 rail 54/88 standard; 44/64 as an option, automatic at small desktop sizes.
- 07 mode line under the composer (C), with toggles for what shows (cost, etc.).
- 08 status: bot = live orb + shimmer; normal session = same shimmer with an animated model logo (normal-session screen discussion next). Danger hybrid. Info C only with a hover reveal (preview first, else A). Long text: focused view.
- 09 accent indigo, editable per theme (owner picks a hex from Iris #5b5bd6, Indigo #4f46e5, Ultramarine #3e4fd8, Violet-indigo #5e4ad9, Soft indigo #6366f1). Attention A amber: reverses red for "you", needs-you and the notch edge; red stays for failed and destructive.

## Feedforward and blanks (owner, 23 Nov): must be real in boopis

Based on Liu Xingyu's demo (x.com/liu_xingyu/status/2121015724374397183).
- Blanks: real today. A cell opens one (exec/blanks.py), the answer goes back through ctx.inject_message as a queued
  message (rpc/blanks.py); states opened / filled / lapsed (lapsed = end-of-turn question).
- Feedforward: NOT real today. In the live app it is off by default (readFlag('feedforward')) and when on uses the
  mock's fixed pattern catalog (host/live-provider.ts:577), so the agent does not actually read the draft.
- To do: a w31 spec + branch `w31/feedforward-live`: the plugin reads the draft (debounced, cheap model through
  ctx.llm.complete_structured, fail quiet), returns the gaps and assumptions, the composer fills them inline before
  sending, the answers travel with the message; on by default once it works.
- Visual: one shared dashed-mark primitive (design system v7) for feedforward, blanks and info labels.

### Owner decisions (23 Nov, later)
- Feedforward: ON by default. Onboarding shows a live demonstration (real reading when a model is connected, a
  labelled recording otherwise) and asks to keep it on or turn it off.
- Blanks: must wait for the person and deliver the answer INSIDE the bot's same reply (no injected turn, no double
  output). Direction: the blank lives in a plugin-owned tool call that blocks until answered; the answer is the tool
  result. Spec: docs/specs/blanks-inline.md on w31/specs (in progress, with docs/specs/feedforward.md).

### Owner decisions (23 Nov, final round)
- Blanks wait inline for a limited time, never forever; with no answer the bot keeps going on its guess and asks later
  (a card / end-of-turn question; a late answer is a correction). Waiting ON by default in sessions, OFF by default for
  bots (bots work alone). Both settable.
- v7: accent Iris (#5b5bd6 / #8b8dff / #4546c8). Search default S5: keyboard-first with a clickable hint; button and
  pill as Settings options. The mark (P3) approved, info labels included. Status (P4) approved.
- CORRECTION (owner): blanks are SESSIONS ONLY. Bots never have blanks; they ask only through approvals the owner
  defined beforehand (rules engine + tiers), shown as the Grok-Bot approval cards, with NO time limit. Sessions keep
  the timed wait (30 s / 60 s default / 2 min), lapse to "(my guess)" + a card, late answer = correction.
- Owner: the blank's card design (the card under the reply) is kept and reused for bots' approval asks (no countdown, no guess, no time limit): one card component, two uses (v7 §17.1).
- Owner: the whole bot session (chat, room, cards, activity, approvals, pane, header, empty state) follows Grok-Bot's recordings, with picks 1-9 on top; deviations only for the keep list.
