# Blanks: in sessions, the agent asks inline, waits a while, then goes on with its guess

Status: draft for w31, proposed in ADR-0065. The owner's decisions (23 November 2026):
- "Should probably wait for your confirmation before continuing / find a way to make your answer reach the bot inside their own reply. That's the entire thing, so you don't trigger a double output from the bot. boopis needs to function this way."
- A blank **waits inline for a while, not forever**. With no answer in time, the agent **keeps going on its best guess**, and the question stays as a card that can still be answered; a late answer reaches it as a correction.
- **Blanks are for sessions only. Bots have no blanks at all, not even as an option.** A bot asks only where the owner decided beforehand that it must: the rules engine and the per-bot rows (`rules-engine.md`), shown as an approval card (`approval-surfaces.md`, the Grok-Bot design recording `grok-package/grokbot-design/GROKBOT-DESIGN.md`). A bot's ask has **no time limit**: "If it's asking you something it's not because it doesn't know, it's because you made it so it asks whenever that happens, so it should ask."
- The defaults match design system v7 (`w31/design-system-v7` at 8586c2b7, `docs/design/v7/DESIGN-SYSTEM.md` section 17.1): Settings > General > Sessions > "Wait for my answer": 30 s, **60 s (default)**, 2 min; a lapsed blank shows the agent's guess in the reply marked "(my guess)" and the question stays as a card; a late answer is sent as a correction. The look of every state is v7's; this spec gives only the behaviour.

Engine claims were checked in the Hermes source the other w31 specs use (v0.23.2). Each is marked: verified with the file, or **[verify]** when it needs a live engine. Nothing here patches Hermes.

## 1. Why today's blanks make a double output

Today (`plugins/boopis/exec/blanks.py`, `rpc/blanks.py`, `docs/PROTOCOL.md` `blank.fill`):
1. A cell calls `harness.leave_blank(question, options)`. The plugin writes `blank.opened`, emits it, and **the cell goes on** ("asks the owner without stopping", `tools/schemas.json`).
2. The model finishes its turn, and often asks the same question again in its reply.
3. The person answers; `blank.fill` hands the answer to `ctx.inject_message`, which queues a **new user-role turn** with no label the model is told how to read.
4. The model answers it as a new request: a **second reply**, often redoing the work.

## 2. Who asks how

| Where | How it asks | Waits | When nobody answers |
|---|---|---|---|
| **Your sessions** (Sessions tab, the dock), governed or ungoverned, in the root profile | a **blank** (`leave_blank`, section 3) | **60 s** by default; 30 s, 60 s or 2 min | goes on with its guess, shown as "(my guess)"; the question stays as a card; a late answer is a correction (section 5) |
| **A bot** (its own chat, a chat platform, `boopis run --bot`, a kanban worker) | **no blanks, no `clarify`.** Only an **approval card**, when a rule or the bot's row says Ask (`rules-engine.md`) | **until you answer**, no time limit (section 6) | it waits; nothing goes on by itself |
| **A room member's turn** | no blanks (the engine also removes `clarify` from member turns, `gateway/session_hosted_rpc.py` 91-97); approvals as `approval-surfaces.md` says | as approvals | as approvals |
| **A governed worker** | cannot ask (section 3.4) | n/a | it fails its attempt and the orchestrator asks |

So "a bot asks at the end of its message" is not a pattern boopis uses: a bot either does its work or meets an approval the owner set up.

## 3. The session's blank: `leave_blank`, owned by the plugin

### 3.1 Why a plugin tool, and not the engine's `clarify`

The engine's `clarify` returns an answer as a tool result in the same turn and waits per profile (`agent.clarify_timeout`, `tools/clarify_gateway.py`). But its timeout result is `{responses, outcome: "timed_out"}` with no guess and no instruction (`tools/clarify_tool.py` 96-111; the schema's description at 161-180), so "go on" is undefined and the model tends to ask again in its reply. It is also absent from governed sessions (created with `toolsets: ["boopis"]`). The owner's design needs a guess committed before asking, a lapse result that says "go on with it and don't ask again", and a question that stays answerable after the turn. A plugin tool does all of that, and the longest wait, 2 min, is far inside the engine's generic deadline for plugin tools, 420 s (verified: `agent/tool_executor.py` `_DEFAULT_CONCURRENT_TOOL_TIMEOUT_S = 420.0`, applied at 936-937; `ctx.register_tool` cannot declare a longer one, `hermes_cli/plugins_context.py` 272-298).

### 3.2 The schema

Registered by the plugin in its own toolset **`boopis_blanks`**:

```json
{"name": "leave_blank",
 "description": "Ask the owner something you need, with your best guess. You may get their answer here; if not, go on with your guess. The question stays open for them, and a later answer arrives as a correction message. Never ask the same thing again in your reply.",
 "parameters": {"type": "object", "additionalProperties": false, "required": ["questions"],
  "properties": {"questions": {"type": "array", "minItems": 1, "maxItems": 4, "items": {
    "type": "object", "additionalProperties": false, "required": ["question", "guess"],
    "properties": {
      "question": {"type": "string", "maxLength": 300},
      "options": {"type": "array", "maxItems": 4, "items": {"type": "string", "maxLength": 120}},
      "guess": {"type": "string", "maxLength": 200, "description": "What you will do if there is no answer: one of the options, or a short value."},
      "depends": {"type": "string", "maxLength": 200, "description": "What in your work rests on this answer (shown on the card)."}}}}}}}
```

Independent questions go in one call (one group of blanks); a question whose answer changes the next is a separate call later in the turn.

### 3.3 What it returns

The call **blocks** in the plugin's handler (a `threading.Event` per call) until every question is answered, the wait passes, or the turn is stopped. One JSON result, one entry per question:
- **Answered in time:** `{"id": "b_…", "status": "answered", "answer": "production"}` (with `"matches_guess": true` when it is the guess). The model goes on in the same turn: one reply.
- **No answer in time:**
  ```json
  {"id": "b_…", "status": "no_answer_yet", "proceed_with": "staging",
   "note": "The owner has not answered yet. Go on with your guess (staging) and mention it once in your reply as an assumption. Do not ask this question again in your reply: it stays open for them as a card. If they answer later, you will get a message that starts with [Correction to your guess]."}
  ```

The note is what keeps the lapse from doubling: the reply carries the work done on the guess and one line naming the assumption; the question itself lives only in the card.

### 3.4 Where the tool is, and where it is not

- **Governed sessions** are created with `toolsets: ["boopis", "boopis_blanks"]` (`apps/desktop/ui/src/host/live-provider.ts` `GOVERNED_TOOLSETS`). Toolsets are fixed at `session.create`, so this is cache-safe (invariant 4); a session created before keeps what it had.
- **Ungoverned sessions:** the host enables `boopis_blanks` in the **root profile's** toolsets through the engine's own `tools` command, once.
- **Bot profiles never have it** (section 6.2): the plugin refuses `leave_blank` in a bot's session whatever its toolsets say (fail closed: the call is blocked with "Bots ask through approvals, not questions."), and `bots.toolsets` refuses to switch `boopis_blanks` on for a bot.
- **Governed workers** cannot ask: the policy refuses `leave_blank` for the worker role. The engine strips `clarify` from children for the same reason (`tools/delegate_tool.py` 309, 731-736).

### 3.5 The engine's `clarify` in the root profile

- **Off in the root profile's toolsets**, so a session has one way to ask (invariant 7).
- **"Wait for my answer" is the root profile's `agent.clarify_timeout`** (v7 section 17.1): the host writes 30, 60 or 120 there, and the plugin reads the same value for `leave_blank`, so they never differ. The engine still uses its clarify callback internally (an MCP server's form-mode elicitation is asked through it, `docs/FORMS.md` section 6), and that question then waits the same time. Never 0.

### 3.6 Exec cells

`harness.leave_blank` becomes `harness.ask(question, options, guess)`, with the same rule: it waits (within the cell's remaining time and the session's wait, whichever is shorter), then returns the answer, or the guess with `answered=False`. The lapsed question becomes the same card, and a late answer the same correction. In a bot's session `harness.ask` raises (section 6.2). `tools/schemas.json`'s `exec` description becomes "asks the owner and waits a while; with no answer it returns your guess and the question stays open".

## 4. What the person sees in a session

### 4.1 While it waits

- The text streamed before the blank stays on screen. The blank appears **in the same message bubble, right after it**, as the v7 dashed mark (`w31/design-system-v7`, shared with feedforward; this spec does not design it), with the question, the options and a typed answer.
- **The countdown is visible in the blank:** v7's countdown chip ("0:42", every second) and "waiting for you", counting to the plugin's deadline (`blank.opened` carries `wait_s` and `deadline` as a UTC time, so every window, the dock and the island count to the same moment). Focus puts the answer inline; Enter answers, Esc leaves it waiting (v7 section 17.1). The turn's status says "Waiting for you", and its timer pauses.
- **Answered in time:** the blank turns solid with the answer in place, and the reply **resumes below it in the same bubble** (the turn's prose before and after the `leave_blank` step is drawn as one reply; `modules/session/conversation.ts` already draws a live blank under a running turn, `addLiveBlank`).
- **The composer while a blank waits:** with exactly one question open, Send **answers it** with the typed text; with several, the message queues as today ("Send when done"). A typed reply never becomes a second message.

### 4.2 When it lapses

- The reply shows **the guess in place of the gap, marked "(my guess)"** (v7's lapsed state), and continues with the agent's one-line assumption.
- The question stays as a **card under the reply** that can still be answered: the **shared card** of design system v7 section 17.1 (`w31/design-system-v7`), one component with two uses, this one and a bot's approval (6.1). It is also listed in "Waiting on you" (the dock), on the island and in the Local API inbox, with "Assumed: staging" and what depends on it. It ranks below pending approvals: nothing is blocked by it.

### 4.3 Stop, restarts and lost links

| Event | What happens |
|---|---|
| **Stop** | the plugin's `on_session_end` (fired for an interrupted turn, ADR-0036) wakes the call with `no_answer_yet`; the engine has already abandoned the tool (`agent/tool_executor.py`: 3 s after an interrupt). The blank becomes a card; a later answer is a correction |
| **The window reloads, the engine keeps running** | open blanks are the plugin's: `blank.list {session_id}` returns them with their deadlines, and the UI redraws them in place |
| **The engine restarts while a blank waits** | the turn is gone. On the next start the plugin writes `blank.lapsed {reason: restart}` for every blank with no end, and the card stays answerable (the B28 lesson). **[verify]** whether the engine stores the partial reply of a turn killed mid-wait; if not, the bubble shows what the UI had, marked "cut off by the restart" |

## 5. Late answers: one labelled correction, or nothing

### 5.1 How a late answer is applied

The person answers a lapsed card (in the reply, the dock, the island or the Local API):
1. **Equal to the guess:** nothing is sent. The card closes "Confirmed: already went with staging"; the plugin writes `blank.filled {matches_guess: true}`.
2. **Different, and the turn that made the guess is still running:** held until that turn ends, so it never interrupts a step. Other late answers of the same session that arrive meanwhile are **merged into one message**.
3. **Different, and the session is idle:** one **correction message** is sent at once.

The message is submitted by the client that holds the answer (the UI's `prompt.submit`, or the host for the island and the Local API) as the person's own message, visible in the transcript. `blank.fill` returns its exact text so every client sends the same bytes. It never goes through `ctx.inject_message`.

### 5.2 The exact format

```
[Correction to your guess]
Earlier you asked: "Which environment should this deploy to?"
You went on with: staging
The owner's answer: production
This corrects an assumption; it is not a new task. Change only what depended on it, say in one line what you changed, and stop.
```

Merged answers repeat the three middle lines per question, in the order asked. Each value is one line (newlines become spaces, cut to 300 characters with "…"). The UI draws it as a quiet answer row linked to its blank, not as a new request.

**The agent treats it as a correction.** The rule is in the `leave_blank` description (3.2) and in the governed prompt section (`plugins/boopis/prompt.py`, fixed at creation): "A message that starts with [Correction to your guess] corrects an assumption you made earlier. Redo only what depended on it, say what you changed in one line, and do not start over or repeat other work."

### 5.3 When a late answer is ignored

Nothing is sent, and the card closes with its reason, when:
- **Superseded:** the agent asked the same thing again later in the session (same question after normalising): "Asked again below".
- **Undone:** the work that rested on the guess was rewound (`checkpoint.rewind` to before the blank), or the session was closed, archived or deleted: "No longer needed".
- **Expired:** after **24 hours** (owner decision, a default): "Expired: finished on its guess"; it stays in the history.
- **Answered with the guess:** case 5.1.1.

## 6. Bots: approvals only, with no time limit

This section only says what changes for bots; how an approval renders and is answered is `approval-surfaces.md`, and when a bot asks is `rules-engine.md`.

### 6.1 How a bot asks

Only through the plugin's gate: a global rule or the bot's row says Ask, `pre_tool_call` returns `approve`, and the engine raises its approval card (`rules-engine.md` sections 3 and 8). The card is the Grok-Bot pattern ("Paused by your Ask first rule", Allow once, Allow all this turn, Always allow, Deny once; `GROKBOT-DESIGN.md`, `approval-surfaces.md` sections 3 and 5). There is no free-form question from a bot, and no guess-and-go-on. **In the app, a bot's approval renders with the same shared card a lapsed session blank leaves under the reply** (v7 section 17.1: one card component, two uses), with no countdown, no time limit and no guess, and with the approval's own content and answers (owner decision; the line is also in `approval-surfaces.md` section 5). This spec does not design it.

### 6.2 No blanks and no `clarify` for bots

| Change | Where | Detail |
|---|---|---|
| `clarify` moves from `every_bot.on` to `every_bot.off`, why "A bot asks only through the approvals you set up (rules and its rows)." | `apps/shared/data/bot-toolsets.json` (ADR-0048) | the owner's decision, so not a question |
| Existing bots lose `clarify` **once** | `<root>/boopis/bot-toolsets.json`, the once-per-bot record (ADR-0048) | ADR-0048 applies the list once per bot and never again, and a toolset switched on later stays on. That would leave every existing bot with `clarify`. So the record gains a version: list version 2 turns `clarify` off once for every bot, recorded per bot, at preparation or the start-up repair |
| `clarify` and `boopis_blanks` are **not offered** for a bot | the bot's settings (one switch per toolset), team files (`toolsets:`), `bots.toolsets` | no switch is drawn for them; `bots.toolsets` refuses to enable them (`hx.invalid_params`, "Bots ask through approvals."); a team file that lists them is imported without them, and the import's report says so. This is the only exception to ADR-0048's "a team file's list is the owner's own" |
| The plugin refuses both in a bot's session | `policy.check` | `leave_blank` and `clarify` are blocked for a bot principal whatever its toolsets say (a profile edited outside boopis included), with the one-line reason; fail closed |
| A bot's exec cell | `harness.ask` | raises "Bots ask through approvals." |

The bot's hand-off skill (`boopis-handoffs`, `plugins/boopis/bots/guides.py`) says: "You cannot ask the owner questions. When you lack something, make the best choice you can, say so in your report, and go on. Actions the owner wants to approve will stop for approval by themselves."

### 6.3 No time limit on a bot's approval

The engine expires an approval card after `approvals.timeout`, 300 s by default, and then fails closed (verified: `hermes_cli/config_defaults.py`, `approvals.timeout: 300`; `tools/approval_context.py` `_get_approval_timeout`, clamped to `agent.deadline.MAX_SAFE_TIMEOUT_S`). The owner wants a bot's ask to wait until the person answers. So:
- The host writes `approvals.timeout` = the engine's maximum (`MAX_SAFE_TIMEOUT_S`: 31,536,000 s, one year, off Windows; about 49.7 days on Windows) into every bot profile, the engine's own "semantically unbounded" value (`agent/deadline.py` 55-64). 0 is not used: it is not documented as unlimited for approvals.
- The engine excludes an approval wait from the tool deadline (verified: `agent/tool_executor.py` `_authorization_gate_lock_timeout`, "never break serialization while a prompt is answerable"; the sequential poll subtracts `authorization_gate.excluded_seconds()`), so a long wait does not turn into `tool_timeout`.
- Waiting costs no tokens. A provider's prompt cache can expire meanwhile, so the next request may pay a cache write again.
- **[verify]** on a live engine that the gateway's turn inactivity watchdog does not end a turn parked at an approval for hours (`gateway/run_turn.py` around 1440); if it does, the host raises the profile's agent timeout for bots by the engine's own setting.
- `approval-surfaces.md` section 5 lists "expired (the engine's timeout, 300 s by default)" as a card state; for a bot's card that state then only comes from the engine's ceiling or a withdrawn turn. That spec's owner should update the line; the card's design is not changed here.
- **Where nobody can answer** (a scheduled run, an unattended platform), the engine resolves the card from `approvals.cron_mode` / `unattended_mode` at once (`tools/approval.py`, `rules-engine.md` 8.3): That is not a time limit but the absence of anyone to ask. The owner's decision: **the step is refused for now and left as the shared approval card; approving it re-runs that step** in a new run scoped to that step, with the context the run had. How the re-run works is `rules-engine.md` 8.3 and how the card offers it is `approval-surfaces.md` section 3.

### 6.4 Rooms

No blanks in rooms (no `boopis_blanks`, and the engine has no `clarify` there). A member's approvals follow `approval-surfaces.md` (and `rules-engine.md` 8.3's open check of whether a room turn's card reaches a person), with the same no-limit timeout as any bot.

## 7. Settings

- **Settings > General > Sessions > "Wait for my answer":** 30 s, **60 s** (default), 2 min (v7 section 17.1). Written by the host to the root profile's `agent.clarify_timeout` and to the plugin's `blanks.wait_s` (one value; the settings schema refuses anything else, 0 included). Applies to the next blank.
- **No per-bot setting.** Bots have no blanks; their approvals have no limit.

## 8. The ledger and the protocol

Blanks stay in contraprova's vocabulary (`docs/LEDGER.md`), sessions only:
- `blank.opened {blank_id, question, options, blocks: []}` with the extras `guess`, `depends`, `wait_s`, `deadline`, `via` (`tool` or `exec`), `tool_call_id`.
- `blank.filled {blank_id, answer, decided_by: "user"}` with the extras `in_time`, `matches_guess`, `delivered` (`result`, `message`, `none`).
- `blank.lapsed {blank_id}` with the extra `reason`: `timeout`, `interrupted`, `restart`, `superseded`, `undone`, `expired`.

`docs/PROTOCOL.md` section 3:

| Method | Params | Result |
|---|---|---|
| `blank.fill` | `{session_id, blank_id, answer}` | `{delivered: "result"\|"message"\|"none", message?: string}`. In time: wakes the waiting call. Lapsed and different from the guess: the correction text for the client to submit (held by the plugin until the turn ends, then returned). Equal to the guess, or no longer relevant: `none`. Never calls `ctx.inject_message`. Refused for a bot's session |
| `blank.list` | `{session_id}` | `{blanks: [{blank_id, question, options, guess, depends, state: "waiting"\|"lapsed", deadline?, asked_at}]}` |

Events: `blank.opened` (with `wait_s` and `deadline`), `blank.filled`, `blank.lapsed` (with `reason`).

## 9. Approvals in sessions, the island, the Local API, caps

- **`leave_blank` passes `pre_tool_call`**, which fails closed (verified: `hermes_cli/plugins_dispatch.py`). The policy allows it for a session's orchestrator in both modes and refuses it for workers and bots; the rules engine lists it as inert (`rules-engine.md` 7.1). A test pins all three.
- **Governed caps:** waiting costs no tokens; the cost cap sees nothing during a wait.
- **The island and the notch** show a waiting blank with its countdown and options, and a lapsed card with its options. A typed answer opens boopis at the blank.
- **The Local API** lists waiting blanks and lapsed cards as kind `question` and answers them through `blank.fill` (the host submits a returned correction). **[verify]** the inbox's kinds on `w30/local-api-0.2`.
- **Only owner surfaces answer** (ADR-0062): the host refuses an answer from a bot's process (`host-protections.md`).

## 10. Removing the injected turn

- `rpc/blanks.py`: the `ctx.inject_message` call and its `HEADER` ("[ANSWER TO YOUR OPEN QUESTION]") are deleted. The plugin never sends anything to the model by itself.
- The forms tools' non-waiting delivery (`forms/service.py` `_deliver`, also `inject_message`) has the same double-output problem; handled next wave (section 12).

## 11. Acceptance tests

**Plugin (pytest, fake clock and fake `ctx`):**
1. In a session, `leave_blank` answered at 10 s returns `answered`; at the 60 s default it returns `no_answer_yet` with `proceed_with` = the guess and the exact note; an answer equal to the guess returns `matches_guess: true`.
2. `blanks.wait_s` accepts only 30, 60 and 120; 0 and any other value are refused; the host writes the same value to the root profile's `agent.clarify_timeout`.
3. In a bot's session, `leave_blank`, `clarify` and `harness.ask` are refused by `policy.check` with "Bots ask through approvals." even when the profile's toolsets list them; `bots.toolsets` refuses to enable `clarify` or `boopis_blanks`; a team file listing them imports without them and reports it.
4. The once-per-bot record at list version 2 turns `clarify` off once for an existing bot and never again; a bot made afterwards never gets it.
5. A worker's `leave_blank` is refused; the rules engine never reviews it.
6. `on_session_end` for an interrupted turn wakes a waiting call with `no_answer_yet`, `reason: interrupted`; at `on_session_start` an unended `blank.opened` becomes `lapsed {reason: restart}`.
7. Late answers: equal to the guess, `delivered: none`; different while the turn runs, held and, with a second late answer, returned as **one** merged correction after the turn ends; different while idle, the exact text of 5.2 (a golden file); superseded, undone and expired return `none` with their reasons.
8. `blank.fill` never calls `inject_message` (a fake `ctx` whose `inject_message` fails the test).

**Host (cargo test):**
9. Preparing a bot writes `approvals.timeout` = the engine's maximum for that platform into its profile and never 0; the root profile's `approvals.timeout` is left as it is.

**UI (vitest):**
10. A blank draws inline after the streamed text with a countdown chip that reaches 0:00 at `deadline` (fake timers), in every window from the same `deadline`; after `blank.filled` the next deltas append to the same reply; one assistant bubble, one `message.complete`.
11. On `blank.lapsed` the reply shows the guess with "(my guess)" and a card appears under it and in the dock; answering with the guess sends nothing; answering differently submits exactly the returned text once and draws it as an answer row.
12. With one blank waiting, Send answers it and never calls `prompt.submit`.
13. A bot's settings draw no switch for `clarify` or `boopis_blanks`; Settings > General > Sessions offers exactly 30 s, 60 s, 2 min with 60 s selected by default.

**End to end (real Hermes v0.23.2 and CI's fake model, `tests/e2e`):**
14. **Answered in time, one reply.** In a session the fake model streams "Looking at the config…", calls `leave_blank`; the test answers in 5 s; the fake model receives the answer as the tool result in a request of the **same turn** and ends with "Done.". One `prompt.submit` from the client; one user row and one assistant reply stored; one `message.complete`; exactly two model requests; no stored row starting "[ANSWER TO YOUR OPEN QUESTION]" or "[Correction to your guess]".
15. **Lapsed, still one reply.** With the wait at 30 s (the shortest setting), the test does not answer; the fake model receives `no_answer_yet` with the guess in the same turn and ends its reply; the stored reply holds the assumption line and not the question again. Answering the card with a different value submits exactly one message starting "[Correction to your guess]", and the model is asked once for it; answering a second card with the guess submits nothing.
16. **A bot cannot ask a question, and its approval waits.** A bot whose row says Ask for `terminal` reaches a command: its tools have neither `clarify` nor `leave_blank`; the approval card stays pending for longer than the engine's default 300 s (the test runs on the engine's own clock override, or asserts the profile's `approvals.timeout` and that the pending card is not expired after 301 s of fake time) and runs once allowed.

## 12. Next wave (not built in w31): `ask` and `request_input` follow the same rule

Owner decision (23 November 2026). The forms tools (`docs/FORMS.md`: `request_input`, `ask`, and `harness.request_input` in a cell) today return at once and deliver a late answer through `ctx.inject_message` (`forms/service.py` `_deliver`): the same double output. In the next wave:
- **In sessions** they wait with the same timer as blanks ("Wait for my answer", 30 s, 60 s, 2 min), then return "no answer yet" and the agent goes on (with its `default` or guess where the form has one); the form stays as the shared card, answerable for 24 hours, and a late answer is the same labelled correction (section 5). `wait=true` and `timeout_s` are replaced by the session's wait.
- **For bots** they become **approval cards with no time limit**: the call waits at the plugin's gate like any rule match (section 6.3), and the answer is the tool's result. A scheduled run's form is refused and left as a card like a scheduled step (`rules-engine.md` 8.3).
- **Credentials and secrets never reach the agent**, in either case: a `credential` or `secret` field is still saved by the host and only its name (or "saved") is in the result, the correction message and the ledger (`docs/FORMS.md` section 6, `forms/effects.py`). A late credential is saved and announced as "saved", never quoted.
- `_deliver` and its `inject_message` call are removed then. Nothing here is built in w31.

## 13. Owner decisions recorded (23 November 2026)

1. A lapsed session question stays answerable for **24 hours** (a default; section 5.3).
2. A scheduled bot run that meets an Ask rule: the step is **refused for now and left as the shared approval card; approving re-runs that step** (section 6.3; `rules-engine.md` 8.3; `approval-surfaces.md` section 3).
3. `ask` and `request_input` get the same rule **next wave** (section 12).

No open questions remain in this spec.

## 14. Verification log

| Claim | Where | Result |
|---|---|---|
| plugin tools stop at the generic deadline (420 s); `ctx.register_tool` cannot declare a longer one | `agent/tool_executor.py` 141, 859-866, 936; `hermes_cli/plugins_context.py` 272-298; `tools/registry.py` 845-914, 1118-1132 | verified |
| an interrupted tool is abandoned after 3 s | `agent/tool_executor.py` `_run_sequential_tool_execution_middleware` | verified |
| `clarify`'s timeout result has no guess | `tools/clarify_tool.py` 96-111, 161-180 | verified |
| `clarify_timeout` is per profile | `tools/clarify_gateway.py` 281-301; `tui_gateway/server.py` 973-979 | verified |
| room member turns and cron runs have no `clarify` | `gateway/session_hosted_rpc.py` 91-97 | verified |
| delegated children have no `clarify` | `tools/delegate_tool.py` 309, 731-736 | verified |
| `approvals.timeout` defaults to 300 s, clamped to `MAX_SAFE_TIMEOUT_S` | `hermes_cli/config_defaults.py` 1612-1627; `tools/approval_context.py` 327-345; `agent/deadline.py` 55-64 | verified |
| approval waits are excluded from the tool deadline | `agent/tool_executor.py` 145-170, 887-905 | verified |
| a bot's toolsets are applied once per bot (ADR-0048) | `apps/shared/data/bot-toolsets.json`, `docs/DECISIONS.md` ADR-0048 | verified |
| the turn watchdog and a long approval wait | `gateway/run_turn.py` | **[verify]** |
| partial reply of a turn killed mid-wait | engine | **[verify]** |
| the Local API inbox kinds | `w30/local-api-0.2` | **[verify]** |
