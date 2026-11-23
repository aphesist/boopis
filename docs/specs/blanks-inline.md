# Blanks wait inline: the answer reaches the bot inside its own reply

Status: draft for w31, proposed in ADR-0056. The owner (23 November 2026): "Should probably wait for your confirmation before continuing / find a way to make your answer reach the bot inside their own reply. That's the entire thing, so you don't trigger a double output from the bot. boopis needs to function this way."

Engine claims were checked in the Hermes source the other w31 specs use (v0.23.2). Each is marked: verified with the file, or **[verify]** when it needs a live engine. Nothing here patches Hermes.

## 1. Why today's blanks make a double output

Today (`plugins/boopis/exec/blanks.py`, `rpc/blanks.py`, `docs/PROTOCOL.md` `blank.fill`):
1. A cell calls `harness.leave_blank(question, options)`. The plugin writes `blank.opened`, emits it, and **the cell goes on** ("asks the owner without stopping", `tools/schemas.json`).
2. The model finishes its turn and its reply, without the answer.
3. The person answers; `blank.fill` writes `blank.filled` and hands the answer to `ctx.inject_message`, which queues a **new user-role turn**.
4. The model answers that turn: a **second reply**.

Step 3 is the double output. It has to go.

## 2. The decision: a blank is the engine's own `clarify`, drawn inline

The engine already has a tool that does exactly what the owner asks, and a plugin tool cannot do it as well:

| | Engine `clarify`, called by the model | A plugin tool that blocks (`ask_inline`, or a blocking `harness.leave_blank`) |
|---|---|---|
| The answer comes back as | the tool result, in the same turn (verified: `tools/clarify_tool.py`; the TUI/desktop bridge `tui_gateway/server.py` `_clarify_block` returns `{answers, outcome}` to the tool) | the tool result, in the same turn |
| How long it can wait | `agent.clarify_timeout`; **0 or less is unlimited** (verified: `tools/clarify_gateway.py` `resolve_clarify_timeout`, "`<= 0` is kept verbatim (unlimited)"; `tui_gateway/server.py` `_clarify_timeout_seconds`, "`<= 0` = unlimited → None (never auto-skip)") | at most the engine's generic tool deadline, 420 s by default (verified: `agent/tool_executor.py` `_DEFAULT_CONCURRENT_TOOL_TIMEOUT_S = 420.0`, applied to every sequential call at 936-937). A built-in tool can raise its own deadline (`tools/registry.py` `deadline_floor`, `execution_timeout`), but **`ctx.register_tool` has no such parameter** (verified: `hermes_cli/plugins_context.py` 272-298), and the registry itself is not on the public plugin API. The only way to lift it is the operator setting `timeouts.tools.sequential_call`, which lifts it for every tool and is not acceptable |
| The generic deadline | none: `clarify` is in `_NEVER_PARALLEL_TOOLS` and runs inline "before any deadline is armed" (verified: `agent/tool_executor.py` 926-947; `agent/tool_dispatch_helpers.py:31`) | 420 s, then `tool_timeout` |
| Stop | the wait is cancelled with `request.cancel {reason: interrupted}` and the turn ends (verified: `tui_gateway/server_requests.py` `send`) | the executor abandons the worker after 3 s |
| A client that is not there | the request stays open and is **replayed to every reconnecting client** (verified: `tui_gateway/server_requests.py` `send`, comment on `_open`) | the plugin would have to build this |
| Several questions | up to 5 in one call, each answered on its own through `clarify.lock`, and the call returns when all are settled (verified: `tools/clarify_tool.py` `MAX_QUESTIONS = 5`; `tui_gateway/methods_prompt.py` `clarify.lock`) | the plugin would have to build this |
| The UI already answers it | yes: `clarify.request` is adapted and answered through `clarify.respond` (`apps/desktop/ui/src/host/forms.ts`, `host/live/forms.ts`), today drawn as a `question` form card | no |

So:
- **A blank in a session or a bot chat is a `clarify` call.** The model calls it; the engine blocks the turn with no deadline; boopis draws the question **inline in the reply that is being written**, not as a form card; the person's answer goes back through `clarify.respond` / `clarify.lock`; the engine returns it as the tool result; the model continues **the same turn**. One reply, no injected turn.
- **No plugin `ask_inline` tool.** It would be the same thing with a 420 s ceiling. The engine's tool is the one implementation (invariant 7).
- **`harness.leave_blank` in an exec cell** cannot reach `clarify` (the cell is inside the plugin's `exec` tool, under the 420 s deadline and the cell's own limit, `exec.max_timeout_ms` 300 s by default). It becomes a blocking question bounded by the cell (section 7), and the model is told to use `clarify` for anything that can wait longer.
- **The `ctx.inject_message` path for blanks is removed** (section 9).

## 3. What the person sees

- **Streaming.** The text the bot streamed before the question stays on screen. The blank appears **in the same message bubble, right after it**, as the v7 dashed mark (the shared primitive being specified on `w31/design-system-v7`, also used by feedforward; this spec does not design it). When the person answers, the blank turns solid with the answer in place, and the reply **resumes below it in the same bubble**: the turn's prose segments before and after the `clarify` step are drawn as one reply (`modules/session/conversation.ts` already draws a live blank under a running turn's steps, `addLiveBlank`; the live provider routes `clarify.request` to it instead of to the form layer).
- **Waiting looks like waiting.** The turn's live status says "Waiting for you" (not "Thinking"), its timer pauses, and the session's row and the dock show it as waiting on the person, like an approval.
- **Several questions in one call** are drawn as one group of blanks in the reply; each can be answered on its own (`clarify.lock`), and the reply resumes when the last is answered or skipped.
- **Answering:** pick an option, or type ("Other"), or Skip (`clarify.lock` with `null`). Keys as feedforward's: Alt+Down opens, Enter picks.
- **The composer while a blank is open** in the session's running turn: if exactly one question is open, Send **answers it** with the typed text (the button says "Answer"); with several open, the composer queues the message as today ("Send when done") and says which questions still wait. So a typed reply never becomes a second message that would cancel the question.
- **One answer resolves everywhere**: the engine's `clarify.settled` closes the blank in every window, the dock and the island.

## 4. Waiting: the knobs

| Knob | Default | Where |
|---|---|---|
| How long a blank waits | **no limit** | the host writes `agent.clarify_timeout: 0` into the root profile and every bot profile through the engine's own `config set` (a step of `bots::prepare` and of setup), once per install and when a profile is made |
| A cap for one bot | none | the bot's settings: "Stop waiting after …" (5 min, 30 min, 2 h, never); writes that bot's `agent.clarify_timeout` |
| A cap for a room | not applicable: room members cannot ask inline (section 6.1) | |
| A cap for your own sessions | none; settable in Settings (the root profile's value) | |

A cap is profile-wide in the engine (one `agent.clarify_timeout` per profile), so it is per bot, not per session. When a cap runs out the engine returns `outcome: timed_out` to the model, which goes on without the answer; the blank shows "Not answered: <bot> went on without it", and the plugin writes `blank.lapsed {reason: timed_out}`.

**Waiting costs no tokens.** The model is not called while the turn is parked in `clarify`. The governed cost cap and the monthly budget see no spend during the wait. One honest cost: a provider's prompt cache expires during a long wait (5 minutes for most), so the next request after a long answer may pay a cache write again. Settings' cost notes say so.

## 5. Stop, restarts and lost links

| Event | What happens | Verified |
|---|---|---|
| **Stop** (mod+. or the button) | the engine cancels the open request (`request.cancel {reason: interrupted}`) and ends the turn as interrupted. The blank shows "Stopped before you answered" with **Answer in a new message** (the explicit fallback, section 9). Nothing is sent by itself | `tui_gateway/server_requests.py` `send` |
| **The window closes or reloads, the engine keeps running** (the host restarts the UI, a lost link) | the request stays open in the engine; on reconnect it is replayed, and `session.resume`'s `open_requests` and the host's `connection.open_requests` redraw it (`docs/FORMS.md` section 6, already built for forms). The person answers and the same turn continues | `tui_gateway/server_requests.py`; `docs/FORMS.md` |
| **The engine restarts** (the app quits, which stops the gateway it started; a crash; an update) | the turn's wait lived in the engine process and is gone; the engine cannot resume a turn. The blank is **closed honestly**: "boopis restarted while this waited. The reply stopped here." with **Answer in a new message**. On the next start the plugin writes `blank.lapsed {reason: restart}` for every `blank.opened` with no end (section 8), so the record survives (the B28 lesson: nothing the person was waiting on is lost silently) | engine process model; **[verify]** whether the engine persists the partial assistant text of a turn killed mid-wait (if not, the reply bubble shows only what the UI had, marked "cut off by the restart") |
| **The gateway's inactivity watchdog** | the messaging gateway counts a clarify wait as activity (`tools/clarify_gateway.py` 74-95, "waiting for user clarify response"), so a parked turn is not killed for inactivity | verified for the messaging gateway; **[verify]** the same for the TUI/desktop gateway's turns |

Cancelling is never hidden: every way a blank ends without an answer (timed out, stopped, restarted, undelivered) is a visible state on the blank and a `blank.lapsed` with its reason.

## 6. Where blanks can wait, and where they cannot

### 6.1 Rooms

**The engine disables `clarify` for a room member's turn** (verified: `gateway/session_hosted_rpc.py` 91-97: "A room has no clarification reply (group controls expose approvals only), so a member turn that called clarify would block for clarify_timeout with its question unseen. As for cron, freeze it out; the member asks its question in the room reply instead."). A plugin tool that blocked would hold the room's Discussion (members answer in rounds) for up to 420 s and then fail.

So in a room **a bot never waits**. It asks at the end of its room message, and the person's answer is their next room message: one reply per bot per message, no injected turn, no double output, and no bot can hold the room's other bots. The UI draws a question that ends a member's message as an end-of-reply blank (dashed, answerable inline; answering posts the answer to the room as the person's message, addressed to that bot with `@handle`). This is the closest honest version; real inline waits in rooms would need the engine to expose clarify in group controls.

### 6.2 Cron, kanban workers and unattended runs

`clarify` is frozen out of cron runs too (same file). A scheduled run cannot ask; its question goes in its report. Kanban workers: **[verify]** whether `clarify` reaches a person; the proposal is the same as cron (no wait).

### 6.3 Governed sessions

A governed session is created with `toolsets: ["boopis"]` (`apps/desktop/ui/src/host/live-provider.ts` `GOVERNED_TOOLSETS`), so it has no `clarify` today. **New governed sessions are created with `["boopis", "clarify"]`.** Toolsets are fixed at `session.create`, so this is cache-safe (invariant 4); a session created earlier keeps its toolsets and has no inline blanks (it shows none, honestly). The plugin's policy already counts `clarify` as read-only (`plugins/boopis/policy/defaults.json`), and the rules engine lists it as inert (`rules-engine.md` 7.1), so it never meets the reviewer or a card. The governed prompt section (`plugins/boopis/prompt.py`, fixed at creation) gains one line: "To ask the owner something you need, call clarify; it waits inside your reply and returns their answer. Never end a turn just to ask."

**Workers cannot ask.** The engine strips `clarify` from delegated children (verified: `tools/delegate_tool.py` 309 `clarify_callback=None`, 731-736 "Children cannot call … clarify"). In governed mode only the orchestrator asks; a worker that lacks something fails its attempt, and the orchestrator asks.

### 6.4 Bots

Bots have the `clarify` toolset on by default (`apps/shared/data/bot-toolsets.json`, ADR-0048). In a bot's own chat in boopis it works as in a session. On a chat platform (Telegram, Slack) the engine's own clarify card is the blank and the bot's profile's `agent.clarify_timeout` applies.

## 7. Exec cells

`harness.leave_blank(question, options)` becomes **`harness.ask(question, options)`**, which **blocks the cell** until the person answers or the cell's time runs out:
- The plugin opens the same inline blank (an `exec` origin), and the answer goes back to the waiting cell through the existing `blank.fill` RPC, which now wakes the cell instead of injecting a message. The cell gets the answer as the value of `await harness.ask(...)`, and the `exec` tool returns normally, in the same turn.
- **Bounded by the cell:** at most the cell's remaining time (`exec.max_timeout_ms`, 300 s default, itself under the engine's 420 s deadline). When it runs out, `harness.ask` raises `BlankLapsed`; the cell can catch it; uncaught, the cell ends with `hx.exec.blank_lapsed` and the tool result says: "The owner did not answer within the cell's time. Ask with clarify, which waits as long as they need, then run the step again." The kernel keeps its variables, so the rerun is cheap.
- The `exec` tool's description changes from "asks the owner without stopping" to "asks the owner and waits (within the cell's time limit; use clarify for longer)".
- This is honest about the limit rather than hiding it: a cell is the wrong place for an open-ended wait, and the engine gives a plugin tool no way to wait longer.

## 8. The ledger

The plugin sees every `clarify` call in its hooks (`pre_tool_call` with `tool_call_id` and the questions, `post_tool_call` with the result) and records it, so blanks stay in contraprova's existing vocabulary (`blank.opened`, `blank.filled`, `blank.lapsed`; `docs/LEDGER.md`):
- `blank.opened {blank_id: "<tool_call_id>:<qid>", question, options, blocks: []}` with the extra `via: "clarify"` (or `via: "exec"`).
- `blank.filled {blank_id, answer, decided_by: "user"}` per answered question.
- `blank.lapsed {blank_id}` with the extra `reason`: `skipped`, `timed_out`, `interrupted`, `undelivered`, `restart`.
- At `on_session_start` the plugin closes any `blank.opened` with no end as `lapsed {reason: restart}`.

The plugin never answers a clarify itself and never mirrors the engine's `prompt_id` (it does not see it; `plugins/boopis/AGENTS.md`).

## 9. Removing the injected turn

- `rpc/blanks.py`: the `ctx.inject_message` call and the `HEADER` "[ANSWER TO YOUR OPEN QUESTION]" are deleted. `blank.fill` answers an **exec** blank whose cell is still waiting (`{delivered: true}`), and refuses anything else with `hx.invalid_params` ("this question is no longer waiting").
- `docs/PROTOCOL.md`: `blank.fill`'s row loses the inject text; `blank.opened/filled/lapsed` events keep their shapes plus `via` and `reason`.
- **The only fallback is explicit, and it is a normal message.** When a blank ended without an answer (stopped, restarted, timed out) the blank offers **Answer in a new message**: the composer is filled with "About your question “<question>”: <answer>" for the person to send, edit or discard. It is visibly the person's own new message, so the reply it gets is the only reply to it. Nothing is ever sent without the person pressing Send.
- `docs/FORMS.md` "Default to non-blocking" (section 8) and the forms `ask` tool's non-waiting delivery (`forms/service.py` `_deliver`, also through `inject_message`) have the same double-output problem; they are out of this spec's scope, flagged as a follow-up (owner question 2).

## 10. Answering from the island, the notch and the Local API

- A blank is an answer in the owner's voice, like an approval, so it follows ADR-0053: **only from an owner surface**. The app's windows, the dock and the island answer it; the host refuses an answer that comes from a bot's process (`host-protections.md`, the owner-voice check).
- **The island and the notch** show a waiting blank with its options (up to four) and Skip; a typed answer opens boopis at the blank.
- **The Local API's inbox** lists open blanks as kind `question` (`{session, bot, questions: [{qid, question, choices}]}`), answered by the inbox's answer verb, which the host turns into `clarify.lock` / `clarify.respond` on the engine; **[verify]** the inbox's kinds on `w30/local-api-0.2`. A client answer is subject to the same peer check as approvals.
- One answer resolves every surface (`clarify.settled`).

## 11. Approvals and the plugin's gate

`clarify` passes `pre_tool_call` like any tool, and `pre_tool_call` fails closed (verified: `hermes_cli/plugins_dispatch.py`). So:
- The policy must keep `clarify` allowed in both modes (it is in `policy/defaults.json`'s read-only list) and the rules engine must keep it inert; a test pins both, because a policy error would block every question.
- If the hook does fail, the call is blocked and the model gets the block message; it then asks at the end of its reply (no wait, no double output). The blank never appears in that case, and the plugin logs it.
- An approval card and a blank can both be open in one turn (an approval for one call, then a question); each is answered on its own. The engine excludes approval waits from tool deadlines; `clarify` has none.

## 12. Acceptance tests

**Plugin (pytest):**
1. `pre_tool_call`/`post_tool_call` on a `clarify` call with two questions write two `blank.opened`, then one `blank.filled` and one `blank.lapsed {reason: skipped}`; `outcome: cancelled` writes `interrupted`; `timed_out` writes `timed_out`.
2. On `on_session_start`, an unended `blank.opened` gets `blank.lapsed {reason: restart}`.
3. `blank.fill` never calls `inject_message` (a fake `ctx` whose `inject_message` fails the test); it wakes a waiting exec cell and returns `delivered: true`; for a blank whose cell is gone it raises `hx.invalid_params`.
4. `harness.ask` returns the answer to the cell; with no answer before the cell's limit it raises `BlankLapsed`, and uncaught gives `hx.exec.blank_lapsed` with the clarify sentence.
5. `policy.check` allows `clarify` in governed and ungoverned mode; the rules engine never reviews it.

**UI (vitest):**
6. A `clarify.request` for the followed session draws an inline blank after the streamed text of the running turn, not a form card; `message.delta` after the answer appends to the same reply; the turn ends with one `message.complete` and one assistant bubble.
7. Answering calls `clarify.lock` (one per question) and never `prompt.submit`; with one question open, Send in the composer answers it.
8. Stop draws "Stopped before you answered"; "Answer in a new message" fills the composer and sends nothing by itself.
9. A replayed open request after a reconnect redraws the blank once.

**End to end (real Hermes v0.23.2 and CI's fake model, `tests/e2e`):**
10. **No second reply.** The fake model's first response streams "Looking at the config…" then calls `clarify` with one question; the test answers through the UI; the fake model receives the answer as the `clarify` tool result in a request of the **same turn** and finishes with "Done.". Assertions: exactly one `prompt.submit` was sent by the client; the session's stored transcript has exactly one user row and one assistant reply for the exchange (no injected user row, none starting "[ANSWER TO YOUR OPEN QUESTION]"); exactly one `message.complete`; the fake model was asked for exactly the two requests of that one turn.
11. **No limit by default.** With `agent.clarify_timeout: 0`, and the engine's generic tool deadline lowered to 5 s for the test (`timeouts.tools.sequential_call: 5`, the engine's own setting, so the test does not wait 420 s), an answer given after 10 s still continues the same turn: the generic deadline does not apply to `clarify`.
12. **Stop:** interrupting while the blank waits ends the turn as interrupted, and no further model request is made.

## 13. Open owner questions

1. **When boopis quits while a bot waits for you.** The engine cannot resume that turn, so the question is closed and offered as "Answer in a new message". Proposed: keep it that way, and when you quit with a question open, the quit dialog says "kai is waiting for your answer" first. Agree?
2. **Forms that don't wait.** The `ask` and `request_input` tools also deliver a late answer as a new message (the same double output). Make them wait inline like blanks too? Proposed: yes, in the next wave.
3. **Rooms.** The engine does not let a room member ask and wait. Proposed: in rooms the bot asks at the end of its message and your answer is your next message (no waiting). Agree, or ask for a room-level wait as an engine feature request?

## 14. Verification log

| Claim | Where | Result |
|---|---|---|
| `clarify` returns the answer as its tool result, same turn | `tools/clarify_tool.py`; `tui_gateway/server.py` 983-993 | verified |
| `clarify_timeout <= 0` is unlimited on the desktop bridge and the gateway | `tools/clarify_gateway.py` 281-301; `tui_gateway/server.py` 973-979 | verified |
| `clarify` has no generic deadline | `agent/tool_executor.py` 926-947; `agent/tool_dispatch_helpers.py:31` | verified |
| plugin tools get the 420 s deadline and cannot declare a floor | `agent/tool_executor.py` 141, 859-866, 936; `hermes_cli/plugins_context.py` 272-298; `tools/registry.py` 845-914, 1118-1132 | verified |
| open requests survive a missing client and are replayed; Stop cancels them | `tui_gateway/server_requests.py` 208-240 | verified |
| up to 5 questions, answered one at a time | `tools/clarify_tool.py`; `tui_gateway/methods_prompt.py` `clarify.lock` | verified |
| room members and cron runs have no `clarify` | `gateway/session_hosted_rpc.py` 91-97 | verified |
| delegated children have no `clarify` | `tools/delegate_tool.py` 309, 731-736 | verified |
| clarify waits count as activity (messaging gateway) | `tools/clarify_gateway.py` 74-95 | verified; desktop gateway **[verify]** |
| partial assistant text of a turn killed mid-wait | engine | **[verify]** |
| kanban workers and `clarify` | engine | **[verify]** |
| the Local API inbox kinds | `w30/local-api-0.2` | **[verify]** |
