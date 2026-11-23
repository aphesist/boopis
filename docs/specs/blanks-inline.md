# Blanks wait inline for a while, then the bot goes on and asks later

Status: draft for w31, proposed in ADR-0056. The owner's decisions (23 November 2026):
- "Should probably wait for your confirmation before continuing / find a way to make your answer reach the bot inside their own reply. That's the entire thing, so you don't trigger a double output from the bot. boopis needs to function this way."
- Refined the same day: a blank **waits inline for a while, not forever**. With no answer in time, the bot **keeps going on its best guess** and the question stays as a card that can still be answered; that answer reaches the bot later, honestly, as a message with its own state.
- **Sessions wait by default** (with the timeout). **Bots do not**: "The bots should work alone, that's their entire thing." A bot's blanks go straight to "keep working, ask later". Both are settings: a global default and one per bot.
- The waiting case keeps the inline design: the blank lives in a **plugin-owned tool call**, and an answer in time is that call's **result**, in the same reply.
- The defaults match design system v7 (`w31/design-system-v7` at 8586c2b7, `docs/design/v7/DESIGN-SYSTEM.md` section 17.1): Settings > General > Sessions > "Wait for my answer": 30 s, **60 s (default)**, 2 min; a lapsed blank shows the bot's guess in the reply marked "(my guess)" and the question stays as a card; a late answer is sent as a correction; a bot can be set to wait in its own settings, off by default. The look of every state is v7's; this spec gives only the behaviour.

Engine claims were checked in the Hermes source the other w31 specs use (v0.23.2). Each is marked: verified with the file, or **[verify]** when it needs a live engine. Nothing here patches Hermes.

## 1. Why today's blanks make a double output

Today (`plugins/boopis/exec/blanks.py`, `rpc/blanks.py`, `docs/PROTOCOL.md` `blank.fill`):
1. A cell calls `harness.leave_blank(question, options)`. The plugin writes `blank.opened`, emits it, and **the cell goes on** ("asks the owner without stopping", `tools/schemas.json`).
2. The model finishes its turn, and often asks the same question again in its reply text.
3. The person answers; `blank.fill` hands the answer to `ctx.inject_message`, which queues a **new user-role turn** with no label the model is told how to read.
4. The model answers it as if it were a new request: a **second reply**, often redoing the work.

## 2. The rule in one table

| Where | Waits? | Timeout | When it lapses |
|---|---|---|---|
| Your sessions (Sessions tab, the dock), ungoverned or governed | **yes** (default) | **60 s**; the setting offers 30 s, 60 s, 2 min | goes on with its guess; the question becomes a card |
| A bot (its own chat, a chat platform, `boopis run --bot`) | **no** (default) | n/a; if the owner turns waiting on for a bot: the same choices, 60 s preselected, never unlimited | goes on at once; the question is a card from the start |
| A room member's turn | **never** | n/a | a card (the bot's room message says it assumed) |
| A scheduled run, a kanban worker | **never** | n/a | a card (or, where nobody can see a card, the run's report) |
| A governed worker | cannot ask (3.4) | n/a | it fails its attempt and the orchestrator asks |

**No setting means "wait forever"**, and the plugin refuses any wait other than 30, 60 or 120 s. A hard bound is needed anyway: the blank lives in a plugin tool call, and the engine stops any plugin tool at its generic deadline of 420 s (verified: `agent/tool_executor.py` `_DEFAULT_CONCURRENT_TOOL_TIMEOUT_S = 420.0`, applied to every sequential call at 936-937; `ctx.register_tool` cannot declare a longer one, `hermes_cli/plugins_context.py` 272-298). The longest choice, 2 min, is far inside it.

"Never waits" is one rule for every place that runs without a person watching: a bot by default, a room, a schedule, a worker. Each gets the same lapsed card and the same correction message later.

## 3. The tool: `leave_blank`, owned by the plugin

### 3.1 Why a plugin tool, and not the engine's `clarify`

The engine's `clarify` also returns an answer as a tool result in the same turn, waits per profile (`agent.clarify_timeout`, `tools/clarify_gateway.py`), is cancelled by Stop and is replayed to a reconnecting client (`tui_gateway/server_requests.py`). But its timeout result is `{responses, outcome: "timed_out"}` with no guess and no instruction (`tools/clarify_tool.py` 96-111, the schema's description at 161-180). The owner's design needs:
- a **guess the bot commits to** before it asks, so "go on" has a definite meaning and the card can say what was assumed;
- a lapse result that says **proceed on the guess and do not ask again in the reply** (no double output);
- a lapsed question that **stays answerable** after the turn, with its own state, and a late answer delivered as a labelled correction;
- the same behaviour in places where the engine has no `clarify` at all: room member turns and cron runs (`gateway/session_hosted_rpc.py` 91-97 removes it), and governed sessions (created with `toolsets: ["boopis"]`).

A plugin tool can do all of that, and a wait of at most 2 min fits well under the engine's deadline. So the blank is the plugin's `leave_blank`, and `clarify` is switched off where boopis makes the session (3.5): one way to ask (invariant 7).

### 3.2 The schema

Registered by the plugin in its own toolset **`boopis_blanks`** (so it can be given to ungoverned sessions and bots without the governed `boopis` tools):

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

Several independent questions go in one call (as one group of blanks); a question whose answer changes the next one is a separate call later in the turn.

### 3.3 What it returns

The call **blocks** in the plugin's handler (a `threading.Event` per call) until every question is answered, the timeout passes, the turn is stopped, or waiting is off (then it returns at once). It always returns one JSON result, one entry per question:

- **Answered in time** (the waiting case): `{"id": "b_…", "status": "answered", "answer": "production"}`. The model goes on with it in the same turn: one reply.
- **Answered with the guess** (the person picked it): `{"status": "answered", "answer": "<the guess>", "matches_guess": true}`.
- **No answer in time, or waiting off**:
  ```json
  {"id": "b_…", "status": "no_answer_yet", "proceed_with": "staging",
   "note": "The owner has not answered yet. Go on with your guess (staging) and mention it once in your reply as an assumption. Do not ask this question again in your reply: it stays open for them as a card. If they answer later, you will get a message that starts with [Correction to your guess]."}
  ```

The note is what keeps the lapse from doubling: the reply carries the work done on the guess and one line naming the assumption, and the question itself lives only in the card.

### 3.4 Where the tool is

- **Governed sessions** are created with `toolsets: ["boopis", "boopis_blanks"]` (`apps/desktop/ui/src/host/live-provider.ts` `GOVERNED_TOOLSETS`). Toolsets are fixed at `session.create`, so this is cache-safe (invariant 4); a session created before keeps what it had and has today's blanks only through `exec`.
- **Ungoverned sessions** in the root profile: the host enables `boopis_blanks` in the root profile's toolsets through the engine's own `tools` command (the same path as `bots.toolsets`, `plugins/boopis/bots/engine_config.py`), once.
- **Bots**: `boopis_blanks` joins `apps/shared/data/bot-toolsets.json` `every_bot.on`, so every bot has the tool (with waiting off, it never pauses; it just leaves cards).
- **Governed workers** cannot ask: the plugin's policy refuses `leave_blank` for the worker role (a worker that lacks something fails its attempt and the orchestrator asks). The engine strips `clarify` from children for the same reason (`tools/delegate_tool.py` 309, 731-736).

### 3.5 The engine's `clarify`

- **Off where boopis makes the profile or the session**: `clarify` moves from `bot-toolsets.json` `every_bot.on` to `off` (the owner chooses those lists: owner question 1), and the root profile's toolsets drop it, so a model has one way to ask.
- **Never unlimited.** The engine still uses its clarify callback internally (an MCP server's form-mode elicitation is asked through it, `docs/FORMS.md` section 6). "Wait for my answer" **is** the root profile's `agent.clarify_timeout` (v7 section 17.1): the host writes the chosen 30, 60 or 120 s there and the plugin reads the same value for `leave_blank`, so the two never differ. A bot's profile gets its own choice, or 60 s while its waiting is off (its `leave_blank` does not wait; the value only bounds the engine's internal use). Never 0. The UI draws such a request with the same countdown.

### 3.6 Exec cells

`harness.leave_blank` becomes `harness.ask(question, options, guess)`, with the same rule: it waits (within the cell's own remaining time and the profile's timeout, whichever is shorter), then returns the answer, or the guess with `answered=False`. The cell goes on either way; the lapsed question becomes the same card, and a late answer the same correction message. `tools/schemas.json`'s `exec` description changes to "asks the owner and waits a while; with no answer it returns your guess and the question stays open".

## 4. What the person sees

### 4.1 While it waits

- The text the bot streamed before the blank stays on screen. The blank appears **in the same message bubble, right after it**, as the v7 dashed mark (the shared primitive on `w31/design-system-v7`, also used by feedforward; this spec does not design it), with the question, the options, a typed answer, and the bot's guess marked as such.
- **The countdown is visible in the blank**: v7's countdown chip ("0:42", ticking every second) and "waiting for you", counting down to the plugin's deadline (`blank.opened` carries `wait_s` and `deadline` as a UTC time, so every window, the dock and the island count to the same moment). The guess can be one of the options to pick. Focus puts the answer inline; Enter answers, Esc leaves it waiting (v7 section 17.1). The turn's status says "Waiting for you", and its timer pauses.
- **Answered in time:** the blank turns solid with the answer in place, and the reply **resumes below it in the same bubble** (the turn's prose before and after the `leave_blank` step is drawn as one reply; `modules/session/conversation.ts` already draws a live blank under a running turn, `addLiveBlank`).
- **The composer while a blank waits:** with exactly one question open, Send **answers it** with the typed text (the button says "Answer"); with several, the message queues as today ("Send when done"). So a typed reply never becomes a second message.

### 4.2 When it lapses

- The blank in the reply shows **the bot's guess in place of the gap, marked "(my guess)"** (v7's lapsed state). The reply continues after it with the bot's one-line assumption.
- The question stays as a **card under the reply** that can still be answered, and is also listed in "Waiting on you" (the dock), on the island and in the Local API inbox: the bot's name, the question, its options, "Assumed: staging", what depends on it (`depends`), and when it was asked. It is lower in the queue than approvals and waiting blanks: nothing is blocked by it.
- With waiting off (a bot), the blank is in the lapsed state from the start, with no countdown, and the card appears at once.

### 4.3 Stop, restarts and lost links

| Event | What happens |
|---|---|
| **Stop** | the plugin's `on_session_end` (fired for an interrupted turn, ADR-0036) wakes the waiting call with `status: no_answer_yet`; the engine has already abandoned the tool (`agent/tool_executor.py`: the worker is given 3 s after an interrupt). The blank becomes a card like any lapse; the turn is over, so a later answer is a correction message |
| **The window reloads, the engine keeps running** | open blanks are the plugin's: `blank.list {session_id}` returns them with their deadlines, and the UI redraws them in place (counting down from the same deadline) |
| **The engine restarts while a blank waits** | the turn is gone. On the next start the plugin writes `blank.lapsed {reason: restart}` for every blank with no end (from the ledger) and the card stays answerable, like any lapse. Nothing is lost (the B28 lesson). **[verify]** whether the engine stores the partial reply of a turn killed mid-wait; if not, the bubble shows what the UI had, marked "cut off by the restart" |

Every way a blank ends without an answer is a visible state and a `blank.lapsed` with its `reason`.

## 5. Late answers: one labelled correction, or nothing

### 5.1 How a late answer is applied

The person answers a lapsed card (in the reply, the dock, the island or the Local API):
1. **The answer equals the guess**: nothing is sent to the bot. The card closes "Confirmed: kai already went with staging" and the plugin writes `blank.filled {matches_guess: true}`. No turn, no reply.
2. **It differs, and the bot's turn that made the guess is still running**: the answer is **held** until that turn ends, so it never interrupts work mid-step. Answers to several lapsed questions of the same session that arrive meanwhile are **merged into one message**.
3. **It differs, and the session is idle**: one **correction message** is sent at once.
4. **The bot runs alone and its run has ended** (a schedule, a chat platform conversation): the correction is sent to that session if it can still take a message; otherwise it is held and given to the bot's **next run** as context at its first turn (`pre_llm_call` context, appended to the user message, never the system prompt: verified, `agent/turn_context.py` `_collect_pre_llm_call_context`). The card says which: "Sent to kai" or "kai will see it on its next run".

The message is submitted by the client that holds the answer (the UI's `prompt.submit`, or the host for the island and the Local API), as the person's own message, so the engine treats it like any message and it is visible in the transcript. The plugin returns its exact text from `blank.fill` so every client sends the same bytes. It never goes through `ctx.inject_message`.

### 5.2 The exact format

```
[Correction to your guess]
Earlier you asked: "Which environment should this deploy to?"
You went on with: staging
The owner's answer: production
This corrects an assumption; it is not a new task. Change only what depended on it, say in one line what you changed, and stop.
```

Several merged answers repeat the three middle lines per question, in the order they were asked. Each value is one line: newlines become spaces, cut to 300 characters with "…". The UI draws this message as a quiet answer row linked to its blank (with the person as author), not as a new request bubble.

**The bot's instructions treat it as a correction.** The same rule is in the `leave_blank` description (3.2), in the governed prompt section (`plugins/boopis/prompt.py`, fixed at creation) and in the bots' hand-off skill (`boopis-handoffs`, `plugins/boopis/bots/guides.py`): "A message that starts with [Correction to your guess] corrects an assumption you made earlier. Redo only what depended on it, say what you changed in one line, and do not start over or repeat other work."

### 5.3 When a late answer is ignored

The card is closed and nothing is sent when the answer is no longer relevant:
- **Superseded**: the bot asked the same thing again later (a newer blank in the session whose question is the same after normalising) — the old card closes "Asked again below".
- **Undone**: the work that rested on the guess was rewound (`checkpoint.rewind` to a point before the blank) or the session was closed, archived or deleted — "No longer needed".
- **Expired**: a lapsed card stays answerable for **24 hours** (owner question 2); after that it closes "Expired: kai finished on its guess" and stays in the session's history.
- **Answered with the guess**: case 5.1.1, nothing to send.

A closed card can still be read; answering it is no longer offered. Each closing is a `blank.lapsed` or `blank.filled` with its reason, so the ledger tells the whole story.

## 6. Settings

- **Global default:** Settings > General > Sessions > "Wait for my answer": 30 s, **60 s** (default), 2 min (v7 section 17.1). It is the root profile's `agent.clarify_timeout`, and the plugin's `blanks.wait_s` for the root profile holds the same value (3.5).
- **Per bot** (the bot's own settings): "Wait for my answer" **off** by default; on, with the same three choices, 60 s preselected (never unlimited). A bot left at off never pauses.
- Rooms, schedules and workers have no setting: they never wait (section 2).
- Stored by the host in the plugin's settings (`blanks.wait_s`: 30, 60, 120, or `null` for a bot that does not wait; per profile) and in the profile's `agent.clarify_timeout`, read by the plugin at each call, so a change applies to the next blank without restarting anything.

## 7. The ledger and the protocol

Blanks stay in contraprova's vocabulary (`docs/LEDGER.md`):
- `blank.opened {blank_id, question, options, blocks: []}` with the extras `guess`, `depends`, `wait_s` and `deadline` (null when waiting is off), `via` (`tool` or `exec`), `tool_call_id`.
- `blank.filled {blank_id, answer, decided_by: "user"}` with the extras `in_time` (true when it became the tool result), `matches_guess`, `delivered` (`result`, `message`, `next_run`, `none`).
- `blank.lapsed {blank_id}` with the extra `reason`: `timeout`, `not_waiting`, `interrupted`, `restart`, `superseded`, `undone`, `expired`.

`docs/PROTOCOL.md` section 3:

| Method | Params | Result |
|---|---|---|
| `blank.fill` | `{session_id, blank_id, answer}` | `{delivered: "result"\|"message"\|"next_run"\|"none", message?: string}`. In time: wakes the waiting call (`result`). Lapsed and different from the guess: returns the correction text for the client to submit (`message`), or holds it for the next run (`next_run`). Equal to the guess, or no longer relevant: `none`. Never calls `ctx.inject_message` |
| `blank.list` | `{session_id}` | `{blanks: [{blank_id, question, options, guess, depends, state: "waiting"\|"lapsed", deadline?, asked_at}]}` |

Events: `blank.opened` (with `wait_s` and `deadline`), `blank.filled`, `blank.lapsed` (with `reason`).

## 8. Rooms, approvals, governed caps, the island and the Local API

- **Rooms.** A member never waits (section 2): its blanks are cards from the start, so no bot can hold the room's discussion for the others. The engine's own room rule is the same (it removes `clarify` from member turns so a member "asks its question in the room reply instead", `gateway/session_hosted_rpc.py` 91-97). A correction for a room member is posted to the room as the person's message addressed to that bot (`@handle`), held until the room's current round ends; that is the room's normal way in, and the room's held-message rule already exists (ADR-0046).
- **Approvals.** `leave_blank` passes `pre_tool_call`, which fails closed (verified: `hermes_cli/plugins_dispatch.py`). The policy allows it in both modes for the orchestrator and refuses it for workers; the rules engine lists it as inert (`rules-engine.md` 7.1). A test pins both. If the hook fails anyway, the call is blocked, the model is told, and it goes on; no blank appears. An approval card and a blank can both be open in one turn and are answered separately.
- **Governed caps.** Waiting costs no tokens: no model is called while the tool waits, so the cost cap and the monthly budget see nothing. A provider's prompt cache can expire during a 5-minute wait, so the next request may pay a cache write again; Settings' cost notes say so.
- **The island and the notch** show a waiting blank with its countdown and its options, and a lapsed card with its options. A typed answer opens boopis at the blank.
- **The Local API** lists waiting blanks and lapsed cards in its inbox as kind `question` and answers them through the inbox's answer verb, which the host turns into `blank.fill` (and submits the correction message when one is returned). **[verify]** the inbox's kinds on `w30/local-api-0.2`.
- **Only owner surfaces answer.** A blank's answer is the owner's voice (ADR-0053): the host refuses an answer from a bot's process (`host-protections.md`).

## 9. Removing the injected turn

- `rpc/blanks.py`: the `ctx.inject_message` call and its `HEADER` ("[ANSWER TO YOUR OPEN QUESTION]") are deleted. The plugin never sends anything to the model by itself; a late answer is a message the client submits (section 5) or context at a bot's next run.
- The forms tools' non-waiting delivery (`forms/service.py` `_deliver`, also `inject_message`) has the same double-output problem; it is out of this spec's scope (owner question 3).

## 10. Acceptance tests

**Plugin (pytest, fake clock and fake `ctx`):**
1. `leave_blank` with waiting on: answered at 10 s returns `answered` with the answer; at the 60 s default deadline it returns `no_answer_yet` with `proceed_with` = the guess and the exact note; an answer equal to the guess returns `matches_guess: true`.
2. Waiting off (a bot profile, a room member's session, a cron run): returns `no_answer_yet` at once, writes `blank.lapsed {reason: not_waiting}`, and the call takes under 50 ms.
3. A worker's `leave_blank` is refused by the policy; the orchestrator's is allowed in both modes; the rules engine never reviews it.
4. `blanks.wait_s` accepts only 30, 60, 120 (and `null` for a bot); 0, "unlimited" and any other value are refused by the settings schema; the host writes the same value to `agent.clarify_timeout`.
5. `on_session_end` for an interrupted turn wakes a waiting call with `no_answer_yet` and `reason: interrupted`; at `on_session_start` an unended `blank.opened` becomes `lapsed {reason: restart}`.
6. Late answers: equal to the guess returns `delivered: none` and writes `matches_guess: true`; different while the turn runs is held and, with a second late answer, returned as **one** merged correction text after the turn ends; different while idle returns the exact text of 5.2 (a golden file); for an ended scheduled run it is returned as `pre_llm_call` context at the bot's next run, once.
7. Superseded, undone (a rewind before the blank), expired (24 h) and dismissed cards return `delivered: none` with their reasons.
8. `blank.fill` never calls `inject_message` (a fake `ctx` whose `inject_message` fails the test).
9. `harness.ask` returns the answer, or the guess with `answered=False` after the timeout, and the cell goes on.

**UI (vitest):**
10. The blank draws inline after the streamed text with a countdown chip that reaches 0:00 at `deadline` (fake timers), in every window from the same `deadline`; after `blank.filled` the next deltas append to the same reply; the turn has one assistant bubble and one `message.complete`.
11. On `blank.lapsed` the blank shows the guess with "(my guess)" in place, and a card appears under the reply and in the dock; answering it with the guess sends nothing; answering differently calls `blank.fill` and submits exactly the returned text once, and draws it as an answer row, not a request.
12. With one blank waiting, Send answers it and never calls `prompt.submit`.
13. After a reload, `blank.list` redraws a waiting blank with the remaining time.

**End to end (real Hermes v0.23.2 and CI's fake model, `tests/e2e`):**
14. **Answered in time, one reply.** The fake model streams "Looking at the config…", calls `leave_blank` with a guess; the test answers in 5 s through the UI; the fake model receives the answer as the tool result in a request of the **same turn** and ends with "Done.". Assertions: one `prompt.submit` from the client; one user row and one assistant reply stored for the exchange; one `message.complete`; exactly two model requests; no stored row starting "[ANSWER TO YOUR OPEN QUESTION]" or "[Correction to your guess]".
15. **Lapsed, still one reply per message.** With the session's timeout set to 3 s, the test does not answer; the fake model receives `no_answer_yet` with the guess in the same turn and ends its reply; the reply does not contain the question text again (the fake model echoes the note it was given, and the test checks the stored reply holds the assumption line and not the question). Then the test answers the card with a different value: exactly one new user message starting "[Correction to your guess]" is submitted, and the model is asked once for it. Answering a second card with the guess submits nothing.
16. **A bot does not pause.** In a bot's chat with waiting off, `leave_blank` returns at once, the turn completes without waiting, and the card is in the dock.

## 11. Open owner questions

1. **The engine's own question tool for bots.** Bots have the engine's `clarify` on today ("asking the owner a question instead of guessing"). Proposed: switch it off and give every bot boopis's blanks instead, so a bot always goes on with a guess and leaves a card. Agree?
2. **How long a lapsed question stays answerable.** Proposed: 24 hours, then it closes as "finished on its guess" and stays in the history.
3. **Forms that don't wait.** The `ask` and `request_input` tools also deliver a late answer as a new message. Give them the same "wait a while, then a labelled correction" rule? Proposed: yes, next wave.

## 12. Verification log

| Claim | Where | Result |
|---|---|---|
| plugin tools stop at the generic deadline (420 s); `ctx.register_tool` cannot declare a longer one | `agent/tool_executor.py` 141, 859-866, 936; `hermes_cli/plugins_context.py` 272-298; `tools/registry.py` 845-914, 1118-1132 | verified |
| an interrupted tool is abandoned after 3 s | `agent/tool_executor.py` `_run_sequential_tool_execution_middleware` | verified |
| `on_session_end` fires for an interrupted turn | ADR-0036, `plugins/boopis/turns.py` | verified in the plugin's own tests |
| `clarify`'s timeout result has no guess | `tools/clarify_tool.py` 96-111, 161-180 | verified |
| `clarify_timeout` is per profile; `<= 0` is unlimited | `tools/clarify_gateway.py` 281-301; `tui_gateway/server.py` 973-979 | verified |
| room member turns and cron runs have no `clarify` | `gateway/session_hosted_rpc.py` 91-97 | verified |
| delegated children have no `clarify` | `tools/delegate_tool.py` 309, 731-736 | verified |
| `pre_llm_call` context goes into the user message | `agent/turn_context.py` 905-968 | verified |
| `pre_tool_call` fails closed | `hermes_cli/plugins_dispatch.py` | verified (ADR-0051) |
| the engine's internal clarify use (MCP elicitation) | `docs/FORMS.md` section 6 | as documented there |
| partial reply text of a turn killed mid-wait | engine | **[verify]** |
| the Local API inbox kinds | `w30/local-api-0.2` | **[verify]** |
