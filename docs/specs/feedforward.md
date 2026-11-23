# Feedforward: the agent reads the draft before it is sent

Status: draft for w31, proposed in ADR-0055. The owner's decisions: feedforward is **on by default** (23 November 2026), and first run shows it live (section 13). The reviewer is "the cheapest connected model" (owner decision 10), and this spec uses the same choice.

Source of the idea: Liu Xingyu's demo (x.com/liu_xingyu/status/2121015724374397183). While the person types, the agent marks the places where it would need more: ambiguous words, missing parameters, and assumptions it would otherwise ask about later. The person fills or changes them inline **before sending**, so there is no back-and-forth. Blanks are the same move after sending, and `blanks-inline.md` makes them wait inside the reply. Together they are one feature: the agent asks in place, before or during the turn, and never as a second exchange (section 9).

Engine claims were checked in the Hermes source the other w31 specs use (v0.23.2, `.github/workflows/claude-cli.yml` `HERMES_TAG`). Each is marked: verified with the file, or **[verify]** when it needs a live engine.

## 1. What is fake today, and what stays

| Piece | Today | After this spec |
|---|---|---|
| `core/settings.ts` `readFlag('feedforward')` | a preview flag, off by default | removed; a real setting, on by default (section 12) |
| `host/live-provider.ts:569-577` | `feedforward: { catalog: () => (flag ? mock.feedforward.catalog() : []) }`, and `MOCK_SOURCES = ['feedforward']`, `info.preview` has `feedforward` | the live provider calls the plugin (section 2); `MOCK_SOURCES` and `preview` lose `feedforward` |
| `modules/session/feedforward.ts` | `makeReader` runs the catalogue's regular expressions over the text; the row says ">preview: not read by the agent" in a live build | the reader keeps its job (marks, readings, items, confirmed and dropped) but its marks come from the plugin's answer, re-anchored on the live text (section 5) |
| `data/types.ts` `DecisionKind`, `data/mock-data.ts` `DECISIONS` | the catalogue | `DECISIONS` stays the **mock provider's** data (the lab, the UI tests); never read by the live provider |
| `components/composer.ts` | contenteditable, `feedforward(text) => FeedforwardMark[]`, `.ui-ff` marks, Alt+Down opens one (`ui:decision`), Tab reaches the assumptions (`ui:assumption`, `ui:assumption-drop`), its own undo, no redraw while an input method composes | unchanged in behaviour; the mark's drawing moves to the v7 dashed mark (section 14) |
| `modules/session/composer.ts` | `openReading` menu ("Dashed: my guess. Solid: your choice."), `reader.clear()` on send | adds free text for a missing value, and the commit on send (section 7) |
| `docs/PROTOCOL.md` `feedforward.preview`, `feedforward.set` | planned, never built | replaced by `feedforward.read` and `feedforward.commit` (section 15) |
| ledger `feedforward.set` | in contraprova's vocabulary (`_vendor/contraprova/events.py`: `turn_id`, `decision`, `value`, `source` in `config`/`convention`/`model`/`user`) | written on send, one per reading that travels (section 7.4) |

## 2. Where it runs

| Part | Runs in | Why there |
|---|---|---|
| The read: one model call per typing pause | the boopis plugin, RPC `plugin.boopis.feedforward.read` | the plugin already holds the cheapest-connected choice and the price book (`rules-engine.md` 7.3), writes the ledger, and calls a model through the engine's public `ctx.llm.complete_structured` (`agent/plugin_llm.py`, on `hermes_cli/data/plugin_api.json`). The host owns routing and auth; the plugin never sees a key |
| Debounce, revisions, re-anchoring, drawing | the UI (`modules/session/feedforward.ts`, the session composer) | only the UI knows the caret, the input method and what is on screen |
| The answers on send | the plugin: `feedforward.commit` arms the next turn, `pre_llm_call` returns them as context | `pre_llm_call` context is appended to the user message, never the system prompt (verified: `agent/turn_context.py` `_collect_pre_llm_call_context`, "injected into the user message (never the system prompt)"; `compose_user_api_content` appends it after the typed text) |
| The setting | the UI's settings, plus the reader route the host writes into the profile | a bot cannot reach a Tauri command |

**Verified about plugin RPCs** (`gateway/session_plugin_rpc.py`): a handler runs off the gateway loop on the runner's turn pool, which is unbounded (`gateway/run.py` `_get_executor`), so a slow read never stalls the gateway, but every read holds a thread until it returns. There is **no cancel for a plugin RPC**: the client cannot withdraw a call in flight (the gateway's `request.cancel` is for server-to-client requests). So staleness is handled by revisions on both sides (section 4), and the plugin bounds its own concurrency.

**A session that does not exist yet.** The live provider creates the gateway session on the first send (`host/live-provider.ts` `createLive`, from `ensureLive`), so the first message of a new session is typed with no `session_id`. `feedforward.read` therefore takes an optional `session_id` and a required `draft_id` (the composer's own UUID, kept until send). A call with no `session_id` passes the gateway's `session:control` capability check instead of a session's authorization (verified, `call_plugin_rpc`).

## 3. The read

### 3.1 `plugin.boopis.feedforward.read`

Params:

```json
{"session_id": "s-…|null", "draft_id": "0193…", "rev": 17,
 "draft": "refactor the proration helpers in src/billing, run the tests, then ship it",
 "cursor": 74,
 "prior": [{"id": "m3", "text": "src/billing", "kind": "scope", "value": "src/billing+tests", "source": "user"}],
 "context": {"answering": {"provider": "anthropic", "model": "claude-opus-5-5"}, "governed": true,
             "folder": "billing-service", "last_turn": "…at most 1,500 characters…"}}
```

- `draft`: the composer's plain text (mention chips as their words, as the send reads it). At most 6,000 characters; a longer draft is not read (`{marks: [], assumptions: [], skipped: "too_long"}`).
- `cursor`: UTF-16 offset of the caret, so the model can leave the word being typed alone.
- `prior`: the readings the person already decided or dropped (`source: user`, `dropped: true`), so the model keeps their ids and never asks again what was answered.
- `context.answering`: the model that will answer this message (the chip's pick, a mention's, or Smart's preview). It decides the reader route (section 6) and is never sent to the reader model as an instruction.
- `context.last_turn`: the last user message and the start of the last answer, cut to 1,500 characters together, so "fix it" can be read. Nothing else of the session is sent.

Result:

```json
{"rev": 17, "stale": false,
 "marks": [
   {"id": "m1", "at": 0, "text": "refactor", "kind": "ambiguous",
    "reading": "Read as", "question": "Same behaviour, or may it change?",
    "options": [{"value": "refactor", "label": "refactor", "desc": "Same behaviour, new structure"},
                {"value": "rewrite", "label": "rewrite", "desc": "Behaviour may change; I will list how"}],
    "guess": "refactor", "confidence": 0.62, "free": false},
   {"id": "m2", "at": 66, "text": "ship it", "kind": "missing",
    "reading": "When done", "question": "Where does it go when the tests pass?",
    "options": [{"value": "draft", "label": "Draft a PR", "desc": "You mark it ready"},
                {"value": "branch", "label": "Push the branch only", "desc": "No PR yet"}],
    "guess": "draft", "confidence": 0.4, "free": true}],
 "assumptions": [{"id": "a1", "text": "Tests: the project's gate command", "kind": "assumption"}],
 "level": {"value": 1, "why": "a refactor across one module"},
 "route": {"provider": "anthropic", "model": "claude-haiku-5-5"},
 "cached": false}
```

- `kind`: `ambiguous` (a word with readings that change the work), `missing` (a parameter the work needs and the text does not give; the mark sits on the word that needs it, never a zero-width point), `scope` (a path or set of files), `assumption` (no word to sit on: it goes to the assumptions row only). The UI's existing kinds (`verb`, `path`, `tests`, `pr`, `cost`) map onto these in the reader (`verb` is `ambiguous`, `path` is `scope`, `tests` and `pr` are `missing`); `cost` stays the UI's own (section 10).
- `options`: 0 to 4, best first; `free: true` means a typed value is accepted (the menu gets a text field, as clarify's "Other").
- `guess`: an option's `value`, or a short typed value; what the row shows as "Will assume" until the person changes it.
- `confidence`: 0 to 1, the model's own figure. Marks below 0.35 are shown; marks above 0.9 are not shown as marks at all but go to the assumptions row (the model is sure enough not to interrupt). The thresholds are data (`plugins/boopis/feedforward/feedforward.json`).
- At most 6 marks and 4 assumptions per draft (more is noise).

### 3.2 What the model is asked

`ctx.llm.complete_structured(task="boopis_feedforward", …)` with:
1. **System prompt (fixed, versioned, `plugins/boopis/feedforward/reader.md`)**: what a mark is, the four kinds, "mark only what would change the work or make you ask later", "never mark the word at the cursor", "keep the ids of prior readings, never re-ask a decided one", the limits. It is byte-stable so a provider's own prompt cache serves it.
2. **The draft (untrusted)** inside `<draft id="<16 random hex>">…</draft id="…">`, then `cursor`, `prior` and `context` as JSON. The instructions say the draft is data; nothing inside it changes the task or the answer format. (It is the person's own text, but it may quote pasted content.)

JSON schema, nothing else accepted (`additionalProperties: false` throughout): `marks[] {id, text, occurrence, kind, reading, question, options[] {value, label, desc}, guess, confidence, free}`, `assumptions[] {id, text}`, `level {value 0|1|2, why}`. The model gives `text` and `occurrence` (the n-th time the text appears), **never offsets**: models count characters badly. The plugin finds the span itself and returns `at` in **UTF-16 code units** (what the UI's strings count), and drops a mark whose text is not in the draft, overlaps another, or is the word at the cursor.

A reply that does not parse, misses the schema, or names nothing that is in the draft is a **failure**, handled quietly (section 8).

### 3.3 Incremental reading

A read is always of the whole draft (drafts are short; the provider's cache keeps the fixed prompt), but it is incremental in three ways:
1. **Between reads, the UI keeps the marks it has** and moves them with the text (section 5), so typing never makes them blink.
2. **`prior`** carries what is decided, so the model only adds or adjusts.
3. **The cache** (section 6.4) answers a draft that went back to an earlier text (undo, a deleted word) at once.

## 4. Revisions, debounce and stale answers

**The UI** (one reader per composer):
- `rev` starts at 1 per `draft_id` and grows with every read the UI sends.
- **Debounce:** a read is sent 600 ms after the last keystroke when the text ends a word (whitespace or punctuation after it), or 1,200 ms after it otherwise. Not while an input method composes, not while a mention is being suggested, not for a draft under 12 characters or with fewer than 3 words. The 1.5 s of `docs/PROTOCOL.md` is replaced.
- **One in flight:** while a read is out, the next one waits; when it returns, the UI sends only the latest text if it changed. So at most one read per composer is in flight and at most one is waiting.
- **Applying an answer:** an answer whose `rev` is below the last applied `rev` is dropped. Otherwise its marks are re-anchored onto the current text (section 5) and applied in the next animation frame; a mark that cannot be re-anchored is dropped. The caret never moves and nothing is drawn while an input method composes (the composer already refuses to redraw then).
- **Leaving:** on send, on switching session, or on clearing the composer, the reader forgets the `draft_id`; any answer still arriving is dropped by its `draft_id`.

**The plugin** (defence in depth, because a client cannot cancel):
- Per `draft_id` it keeps the highest `rev` seen and one model call at a time. A call whose `rev` is below the highest seen returns `{stale: true}` at once, with no model call. A call that waits behind a running one returns `{stale: true}` when a newer one arrived meanwhile. So a fast typist costs at most one call in flight and one waiting per composer.
- Process-wide: at most 4 reads in flight (data); a fifth returns `{marks: [], skipped: "busy"}`. A `draft_id` unseen for 10 minutes is forgotten.

## 5. Re-anchoring marks on the live text

The reader keeps, per mark, its `text`, `at` and the draft it was read on. On every input it maps each mark through the edit with a common-prefix and common-suffix diff of the old and new text: a mark wholly before or after the edited region moves with it; a mark the edit touched is dropped until the next read. If `draft.slice(at, at + text.length) !== text` after mapping, the reader looks for the same text within 40 characters and otherwise drops the mark. This is the composer's `FeedforwardMark.at` (already supported, with `indexOf` as its fallback today, which this replaces because it picks the wrong one of two equal words).

## 6. The model, cost, caching and latency

### 6.1 Which model

**The cheapest connected model of the provider that will answer the message** (proposed; owner question 1):
- Candidates: the roster the host sends (`dispatch.roster`, ADR-0034) filtered to `context.answering.provider`, each priced by the price book (`PriceBook.resolve`, models.dev rates and the owner's overrides). The same function as the reviewer (`rules-engine.md` 7.3: a standard check of 2,000 input and 200 output tokens; ties to the owner's order; an unpriced model is never ranked). One implementation (STANDARDS section 9): the chooser moves to `plugins/boopis/routes/cheapest.py` and both callers use it.
- **Why the answering provider, not the global cheapest:** the draft then goes only where the message itself is about to go, under the same account. The global cheapest would send a draft written for Claude to Google whenever a Gemini key is also connected.
- **Never a heavy model** (ADR-0037: nothing automatic picks one). If the provider's only models are heavy, there is no reader and feedforward is quiet for that message.
- **Governed or ungoverned does not matter.** A read does no work, writes nothing and is not on the ladder, so the frontier-only rule of governed mode (ADR-0037) does not apply to it, exactly as for the reviewer. The reader may be Haiku while the session runs on Opus.
- **A subscription** (Claude through the person's Claude Code, ChatGPT sign-in): its cheapest non-heavy model is the reader, billed to the plan (owner question 2). **[verify]** the latency of `complete_structured` on `claude-subscription-directsdk-experimental`: if a read cannot meet the budget below on a live engine, the subscription has no reader and feedforward is quiet for it, with Settings saying why.
- **The free tier and OpenRouter free models** count as connected; their price is zero. **[verify]** that `complete_structured` with a JSON schema works on the free tier's models; a model that does not honour the schema fails quietly.
- **Routing:** the plugin registers its own auxiliary task `boopis_feedforward` (`ctx.register_auxiliary_task`, defaults `{provider, model, timeout: 5}`); a plugin may route through a task it registered without any trust flag (verified, `agent/plugin_llm.py` `_check_task`: "a key the plugin registered itself → allowed"). The host writes the chosen route per provider into `auxiliary.boopis_feedforward` of the root profile (and of a bot's profile when its chat reads drafts, section 11) through the engine's own `config set`, and again when the roster or price book changes. The plugin checks the result's `provider` and `model` against the route it expected; a different one is a failure (quiet). **[verify]** that one auxiliary task can be given a route per call: if the engine reads one route per task, the plugin registers one task per provider (`boopis_feedforward.<provider>`), which the same code allows.

### 6.2 Cost on the ledger

Computed, never stored (invariant 3). Each read's usage is a `usage.recorded` with the extra fields `purpose: "feedforward"`, `draft_id`, `rev` (contraprova allows extra fields), from `PluginLlmCompleteResult.usage` (**[verify]** whether `post_auxiliary_call` also fires for `ctx.llm`; then record from the hook only, never both, as `rules-engine.md` 7.4).
- **With a `session_id`:** in that session's ledger, so `ledger.stats` and the governed cost cap count it.
- **Without one (the first message):** in the profile's **aside ledger**, `<profile home>/boopis/ledger/aside-<yyyy-mm>.jsonl`, a contraprova log of its own (`session.opened` with `session_id: "aside-<yyyy-mm>"`, `mode: "ungoverned"`), so the record is never lost and `contraprova verify|cost` read it. Settings' monthly spend and a monthly budget include it. When the draft is sent, `feedforward.commit` writes a `usage.recorded`-free pointer `tool.called {tool: "feedforward.reads", draft_id, aside_seq_from, aside_seq_to}` in the new session, so a session's cost report can add what its first draft cost.
- **The cap:** when the session's cost cap or the monthly budget is reached, reads stop (quiet). A read never blocks a turn for budget reasons.
- Settings shows the reader, its estimate per read and its spend this month, as it does for the reviewer.

### 6.3 Latency budget

| | Budget |
|---|---|
| Keystroke to redraw (re-anchoring, no call) | ≤ 4 ms p95, never on the critical path of input |
| Pause to marks on screen | p50 ≤ 1.6 s, p95 ≤ 3.5 s (debounce plus the call) |
| The model call | p50 ≤ 1 s, p95 ≤ 2.5 s, hard timeout 5 s (`complete_structured(timeout=5)`) |
| Plugin work around the call | ≤ 10 ms p95 |

A read that misses the timeout is dropped quietly; three timeouts in a row on one route pause reads on it for 2 minutes.

### 6.4 Caching

Per process, in memory, 256 entries, 10 minutes. Key: SHA-256 over the canonical JSON of the draft, `cursor` rounded to the word, `prior`, `context`, the route and the prompt version. Value: the answer before re-anchoring. A failure is never cached. The invalidation rule (any change to the prompt version or the route changes the key) is written next to the cache (STANDARDS section 6). A cache hit costs nothing and writes no usage.

## 7. How the answers travel with the message

### 7.1 What travels

Everything the assumptions row shows at the moment of sending, because the row says "Will assume:" and sending is accepting it:
- a reading the person picked or typed: `source: user`, shown as **chosen**;
- a guess the person left: `source: model`, shown as **assumed**;
- an assumption from the row: `source: model`, **assumed**;
- a dropped mark or assumption: not sent.

The governance item of the row (governed start, ungoverned pin) and a mention's item ("to X only") do not travel as text: they act through `cascade.start_tier`, `config.set` and `mode.once` as today.

### 7.2 `plugin.boopis.feedforward.commit`

The UI calls it after the session exists and **before** `prompt.submit` (in `details.prepareSend`, after Smart's pick):

```json
{"session_id": "s-…", "draft_id": "0193…", "text": "<the exact text about to be submitted>",
 "readings": [{"id": "m1", "text": "refactor", "kind": "ambiguous", "reading": "Read as",
               "value": "rewrite", "label": "rewrite", "source": "user"},
              {"id": "m2", "text": "ship it", "kind": "missing", "reading": "When done",
               "value": "draft", "label": "Draft a PR", "source": "model"}],
 "assumptions": [{"id": "a1", "text": "Tests: the project's gate command"}]}
```

Result `{armed: true}`. It **arms the session's next user turn**, exactly the pattern of `mode.once` (ADR-0036): one pending commit per session, replaced by a newer one, lapsing after 120 s unused.

### 7.3 Where it is injected

In `pre_llm_call`, for a turn that is not a worker's: if the session has an armed commit **and** `user_message` contains the committed `text` (whitespace-normalised; attachments may add lines around it), the plugin returns the block below as `{"context": …}`, joined with any other context the hook returns that turn (`turns.CONTEXT`, `turn_directive`; the hook today returns early in places, so it gathers its parts and returns them together). Otherwise the commit stays armed until it lapses.

Prompt caching stays fixed at `session.create` (invariant 4): the system prompt, toolsets and skills are untouched. The block lives in the turn's user message, after the typed text; the engine stores the exact sent bytes as the row's `api_content` and replays them on later turns (verified: `agent/turn_context.py` `_stamp_api_content_sidecar`, "persist what you send"), so the history's prefix stays byte-stable from turn to turn. The engine spills a hook context above 10,000 characters to disk (`tools/hook_output_spill.py` `DEFAULT_MAX_CHARS`); the block is capped at 2,000.

### 7.4 The exact format

```
<boopis-readings v="1">
The person read their own message with you before sending it. Take these as their instructions for this message only.
- "refactor": rewrite (chosen)
- "ship it" (When done): Draft a PR (assumed)
- Tests: the project's gate command (assumed)
"chosen" is the person's own pick. "assumed" is what they saw and sent without changing; follow it, and say so if it turns out wrong.
</boopis-readings>
```

Rules, so the block is deterministic and cannot break out of itself:
- Order: marks in text order, then assumptions in row order.
- Each `text`, `reading` and `label` is one line: newlines become spaces, `"` becomes `'`, `<` and `>` become `‹` and `›`, each cut to 160 characters with `…`.
- `(When done)` is the reading's name, left out when it is "Read as".
- At most 10 lines of items; the block at most 2,000 characters (items past it are left out, never cut mid-line).
- English, whatever the draft's language (the UI is English; a translated block is a later choice).

The plugin writes one ledger `feedforward.set` per item that travelled: `turn_id` (the hook's), `decision` (the mark's `reading` and `text`), `value` (the label), `source` (`user` or `model`), and the extra `draft_id`. These are what a resumed session reads to show, under the sent message, what it was read as (the row the composer had; `lastAssume()` today keeps only the visible labels).

### 7.5 When the commit cannot travel

- `feedforward.commit` fails, or the session has no plugin: the UI sends the message anyway (never blocked) and the sent turn's row says "Not read by the agent", quietly. The person's chosen readings are not silently lost from view: the row keeps them with that note.
- The commit lapsed or the text did not match: the plugin emits `feedforward.unused {draft_id}` to the session; the UI shows the same note.
- No fallback writes the block into the visible message text: that would change what the person wrote.

## 8. Failure behaviour: fail quiet

Feedforward is advice, not a gate, so it fails **quiet** (the opposite of invariant 6, which covers permission, policy and gate checks; feedforward is none of those):
- No model (no route, only heavy models, the subscription too slow, the budget reached), the plugin missing, the RPC failing, a timeout, a malformed answer: **no marks, nothing said in the composer**, and sending is never blocked or delayed. The send path never waits for a read.
- Settings says why reads are not happening (one sentence: "No reader: the only models on xAI are heavy").
- The plugin logs a failure once per route per 10 minutes; the UI logs nothing per keystroke.
- A read's error never becomes a toast.

**Privacy.** The draft goes only to a model of the provider the message is about to go to (section 6.1), under the person's own account, and only while feedforward is on. Nothing of the draft is stored: the ledger holds tokens, ids and the travelled readings (which the person sent anyway); the cache is memory only. Turning feedforward off stops every read at once (the UI is the only caller) and clears the reader's marks.

## 9. One feature with blanks

| | Feedforward | Blanks (`blanks-inline.md`) |
|---|---|---|
| When | while typing, before send | while the bot writes, inside its reply |
| Who asks | the reader model, from the draft | the answering model, through the engine's `clarify` |
| The mark | the v7 dashed mark on a word of the draft | the v7 dashed mark on the blank in the reply |
| Answer | pick, type, or leave the guess | pick or type; the reply goes on |
| Travels | as the `<boopis-readings>` block in the same message | as the tool result, in the same turn |
| Ledger | `feedforward.set` | `blank.opened`, `blank.filled` |

Shared, so they feel like one thing: the same dashed-then-solid look (dashed is the agent's guess or question, solid is the person's answer), the same menu shape (question, options best first, a typed answer, "Dashed: my guess. Solid: your choice."), the same keys (Alt+Down opens, Enter picks), and the same rule that **an answer never makes a second exchange**. The reader model is told that what it marks now will not be asked later; the answering model is told (in the governed and bot prompt sections, which are fixed at creation) that readings arrive with the message and that a question it still has goes in a blank, never in a separate turn.

## 10. Smart routing and the starting tier

`docs/ARCHITECTURE.md` says feedforward picks the starting tier in governed mode. ADR-0032 made Smart a pure function in the UI that picks it. Both stay true, with one implementation (STANDARDS section 9):
- The read returns `level {value, why}` (0, 1 or 2, Smart's own scale). Smart takes it as **one more signal**: the highest of Smart's own rule and the reading wins, and the reason shown is the reading's `why` when it won ("Smart: the reading says a refactor across one module").
- The person's own choice beats both: the row's governance item (today `costAssume`, kind `cost`: cheap, balanced, thorough) sets the start tier for this message through `cascade.start_tier`, as a mention beats Smart (ADR-0036).
- Ungoverned, the level only moves Smart's pick when Smart is on; with a pinned model nothing changes.
- No reading (quiet failure): Smart runs on its own rule as today.
- `docs/ARCHITECTURE.md` section 6's row becomes: "Smart picks the starting tier for each message from the ladder, with the draft's reading as one of its signals."

## 11. Rooms and bots

Proposed (owner question 3):
- **Sessions tab:** on.
- **A bot's own chat** (`host/live/bot-chat.ts`, one bot, its own profile): on. The read goes through that bot's link, so the reader is the cheapest model of the **bot's** answering provider, written into the bot's profile, and the cost lands in the bot's session (or its aside ledger). The commit and `pre_llm_call` run in the bot's own plugin copy.
- **Rooms** (`groups.send`, several bots): **off** in this wave. A room message goes to several members, each its own profile, model and session; the engine's room worker hands the text to each member (`gateway/hosted_room_*.py`), and no single `pre_llm_call` sees the person's commit. Arming every member's plugin copy is possible but each member would then read the same message with readings written for a different model. The honest version is later: readings as a visible part of the room message, which the owner would have to approve as a change to what people see in the room.
- The dock's session composer follows the session it shows.

## 12. On by default, and the setting

- **Default on** (owner decision). It is on for new installs and for existing ones on the release that ships this, with a one-time line under the composer the first time marks appear: "boopis reads your draft as you type, to ask before it starts. Turn this off in Settings." (copy is the owner's to approve).
- **The setting:** one switch, "Read my drafts as I type", with the reader named under it ("Reads with Claude Haiku 5.5, about $0.0006 a read" or why there is none). Where it sits in Settings is the owner's (v7); proposed beside the reviewer, since both name "the cheapest connected model". Stored by the UI (`core/settings.ts`, key `hx.v6.feedforward` `{on: boolean}`, default true when absent); the host keeps the reader routes. The first-run step (section 13) writes the same key.
- **Removing the mock from the live path:** delete `readFlag('feedforward')` and its `VITE_PREVIEW_FEEDFORWARD` switch, the `feedforward` entry of `MOCK_SOURCES` and of `info.preview`, the `preview` kind's ">preview: not read by the agent" item, and `PreviewSource`'s `feedforward`. `FeedforwardSource` becomes `{ read(req): Promise<ReadResult>; commit(req): Promise<void> }`; the mock provider answers `read` from `DECISIONS` (so the lab and the UI tests keep their catalogue), the live provider from the plugin. A test pins that the live provider never imports `mock-data`'s `DECISIONS`.

## 13. First run: a live demonstration

The owner: onboarding shows feedforward live; the person types or watches a draft being read, sees the marks appear, fills one, and is asked to keep it on or turn it off. Real whenever a model is connected; a recording, said to be one, when none is.

**Where:** first run's steps are Welcome, Models, Connectors, Store (`host/first-run-model.ts` `PHASES`, ADR-0040). The new step **"Try it"** goes after Models (it needs the reader the Models step connects) and before Connectors: `PHASES` gains `{ id: 'feedforward', label: 'Try it' }`, and "Step 3 of 5". It is skippable like Connectors and Store ("Skip"), and skipping keeps the default (on).

**The step:**
1. A composer (the library's, the same component as the session's, `ui.composer` with `feedforward`) holding a pre-typed draft: "refactor the billing helpers and ship it". A line above it: "boopis reads what you write before you send it, and marks what it would otherwise ask you later."
2. **Live** (a model is connected and the gateway link is up): the draft is "typed" into the composer at a reading pace (about 25 characters a second, so the debounce fires on real pauses), and the real `feedforward.read` runs on it, with no `session_id` and a first-run `draft_id`. The marks that appear are the model's real answer. The person may also clear it and type their own.
3. The person opens a mark (click or Alt+Down) and picks or types an answer; the mark turns solid and the assumptions row changes. A line says what would travel: the `<boopis-readings>` lines in plain words ("Sent with your message: 'ship it' means Draft a PR (your choice)").
4. The question: "Keep reading my drafts?" with **Keep it on** (primary) and **Turn it off**, and the reader and its cost per read under it. The choice writes the setting (section 12).
5. Nothing is sent: there is no session in first run. The reads' usage goes to the aside ledger (section 6.2), so the demonstration's cost is on the record like any other.

**Fallback: a recording.** When no model is connected (the person chose "Do it later" and the free tier is unavailable, or the reader route fails), the step plays a **recorded demo**: a real read captured once on a real engine, stored as data (`apps/shared/data/feedforward-demo.json`: the draft, the marks as returned, the model that produced them, the date, the engine version), replayed with the same typing and the same composer. A label stays on the card the whole time: "Recorded example. Connect a model and boopis reads your own drafts." The person can still open a mark and pick an option (the readings are the recording's), and is still asked to keep it on. The recording is produced by a script in CI's e2e job from a real engine run (`scripts/record-feedforward-demo.sh`), never written by hand (invariant 5).

**Failure inside the live step:** if the first read fails or times out, the step switches to the recording and says so ("boopis could not read just now, so this is a recorded example."). It never shows an empty composer as if nothing were wrong.

**[verify]** that the first-run view has a gateway link to the engine after the Models step's restart (it drives setup through the host's setup bridge today); if it does not, the step asks the host to open one, and until it is open the step uses the recording.

## 14. The visual

Feedforward uses design system v7's shared **dashed mark** primitive, being specified on branch `w31/design-system-v7` (`docs/design/v7/`). This spec does not design it. What it needs from the primitive, as behaviour only: a dashed state (the agent's guess or question), a solid state (the person's answer), a way to show `kind` without colour alone, keyboard focus, a menu anchor, and the same primitive for blanks in a reply. Until v7 lands, the v6 `.ui-ff` styles (`components/components.css:925-929`) stay as they are. The first-run step's layout is the owner's.

## 15. Protocol changes

`docs/PROTOCOL.md` section 3, replacing `feedforward.preview` and `feedforward.set`:

| Method | Params | Result |
|---|---|---|
| `feedforward.read` | `{session_id?, draft_id, rev, draft, cursor, prior?, context}` | `{rev, stale, marks, assumptions, level, route, cached, skipped?}` (section 3.1). Never an error for a model failure: `{marks: [], assumptions: [], skipped: "no_reader"|"failed"|"timeout"|"busy"|"too_long"|"budget"}` |
| `feedforward.commit` | `{session_id, draft_id, text, readings, assumptions}` | `{armed: boolean}`. Arms the next user turn of the session (120 s), injected by `pre_llm_call` (section 7) |

Event: `feedforward.unused {draft_id}` (the commit lapsed or did not match). `describe.capabilities` gains `feedforward`. Ledger: `feedforward.set` (exists), `usage.recorded` with `purpose: "feedforward"`, the aside ledger (section 6.2). Plugin files: `plugins/boopis/feedforward/` (`read.py`, `commit.py`, `reader.md`, `feedforward.json`), `routes/cheapest.py` shared with the reviewer.

## 16. Acceptance tests

**Plugin (pytest, a fake `ctx.llm` that returns scripted structured answers, records calls and can sleep or raise):**
1. A draft with "refactor … ship it" returns two marks with `at` in UTF-16 units; a draft with an emoji before the word returns the UTF-16 offset, not the code-point one.
2. A mark whose `text` is not in the draft, overlaps another, or sits on the word at `cursor` is dropped.
3. A reply that misses the schema, a raise, a timeout and a wrong route each return `{marks: [], skipped: …}` and never raise.
4. Revisions: rev 3 while rev 2 runs returns rev 2's answer for 2 and makes one more call for 3; rev 2 arriving after rev 3 returns `stale` with no call; three calls 2, 3, 4 arriving while 1 runs make exactly two model calls (1 and 4).
5. A fifth concurrent `draft_id` gets `skipped: "busy"`.
6. The cache: the same draft twice makes one call; a changed route or prompt version makes a new one; a failure is not cached.
7. The route: the cheapest priced non-heavy model of `context.answering.provider`; no candidate gives `no_reader`; an unpriced model is never chosen; the same chooser gives the reviewer's answer for the same roster (one implementation).
8. Usage: with a `session_id`, one `usage.recorded` with `purpose: "feedforward"` in that ledger; without one, in `aside-<yyyy-mm>.jsonl`, which `contraprova verify` accepts; a cache hit writes none.
9. Commit and inject: after `commit`, the next `pre_llm_call` whose `user_message` contains the text returns exactly the block of section 7.4 (a golden file), joined with `turns.CONTEXT` when the one-turn exception is armed; a worker's turn and a child completion do not consume it; a second commit replaces the first; after 120 s it lapses and `feedforward.unused` is emitted; one `feedforward.set` per travelled item.
10. The block escapes quotes, angle brackets and newlines, cuts at 160 characters, and stays under 2,000 characters with 12 items.
11. The system prompt is byte-identical across calls (cache-stable).

**UI (vitest):**
12. Stale revisions: answers arriving out of order (rev 2 after rev 3) never replace newer marks; an answer for a forgotten `draft_id` is dropped; only one read is in flight per composer and the waiting one carries the latest text.
13. Debounce: no read while composing with an input method, for a draft under 12 characters, or before 600 ms after a word ends.
14. Re-anchoring: typing before a mark moves it; editing inside it drops it; two equal words keep the right one.
15. Fail quiet: with `read` rejecting, timing out or returning `skipped`, no marks are drawn, no toast is shown, and `ui:send` still fires and the message is submitted without waiting.
16. The send payload: after picking "rewrite" for "refactor" and leaving "ship it", `feedforward.commit` is called before `prompt.submit` with `readings` `[{…value: "rewrite", source: "user"}, {…value: "draft", source: "model"}]` and the exact submitted text; a dropped mark is absent; a failing commit still submits, and the sent turn's row says "Not read by the agent".
17. Off: with the setting off, no `read` is ever called and no marks show; turning it off clears the marks at once.
18. The live provider does not reference `DECISIONS`, `MOCK_SOURCES` has no `feedforward`, and `readFlag` is gone.
19. First run: with a connected model the step calls `feedforward.read`; with none, or after a failed read, it plays `feedforward-demo.json` with the "Recorded example" label visible; both end at the keep-or-turn-off question, which writes the setting.

**End to end (one, `tests/e2e`, real Hermes v0.23.2 with the fake model server CI already runs, answering the reader's structured request):**
20. Type a draft in a new session; marks appear from the plugin's answer within the budget; pick one; send; the fake model's received request for that turn has the typed text followed by the `<boopis-readings>` block in the user message and an unchanged system prompt; the second turn's request replays the first turn's user message byte for byte; the ledger has the `usage.recorded` with `purpose: "feedforward"` (in the aside ledger for the first draft) and the `feedforward.set` events.

## 17. Open owner questions

1. **Which reader.** The cheapest model of the provider that will answer the message (proposed: the draft goes only where the message goes), or the cheapest connected model of any provider, like the reviewer (cheaper, but the draft can reach another lab)?
2. **Reading on a subscription.** When the message goes to your Claude or ChatGPT subscription, may the drafts be read on that plan (its smallest model, a read per typing pause, counted against the plan's limits)? Proposed: yes, if it is fast enough; otherwise no reads for that subscription.
3. **Rooms and bot chats.** Proposed: on in a bot's own chat, off in rooms for now (a room message goes to several bots, each on its own model). Agree?
4. **What travels.** Proposed: everything the "Will assume" row shows when you send, your picks marked as yours and the rest as assumed. Or only what you picked yourself?

## 18. Verification log

| Claim | Where | Result |
|---|---|---|
| `ctx.llm.complete_structured` with a JSON schema, `timeout`, `task` | `agent/plugin_llm.py` 500-536 | verified |
| a plugin may route through a task it registered, no trust flag | `agent/plugin_llm.py` `_check_task` | verified |
| plugin RPC runs off the loop, on the unbounded turn pool; no client cancel | `gateway/session_plugin_rpc.py`, `gateway/run.py` 3958-4004 | verified |
| a call without `session_id` needs `session:control` | `gateway/session_plugin_rpc.py` `call_plugin_rpc` | verified |
| `pre_llm_call` context goes into the user message, never the system prompt | `agent/turn_context.py` 905-968, 125-136 | verified |
| the sent user content is persisted (`api_content`) and replayed | `agent/turn_context.py` 1093-1110 | verified |
| hook context over 10,000 characters is spilled | `tools/hook_output_spill.py` | verified |
| `feedforward.set` in contraprova's vocabulary | `plugins/boopis/_vendor/contraprova/events.py` | verified |
| the gateway session is created at the first send | `apps/desktop/ui/src/host/live-provider.ts` `createLive` | verified |
| one auxiliary task routed per provider | engine | **[verify]** |
| `post_auxiliary_call` fires for `ctx.llm` | engine | **[verify]** |
| subscription latency; free-tier structured output | live engine | **[verify]** |
| a gateway link in first run after Models | `host/first-run.ts` | **[verify]** |
