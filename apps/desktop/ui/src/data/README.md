# The data seam

Every module reads data **only** through `DataProvider` (`provider.ts`), and every action a module takes is a **command** on it. Nothing under `src/modules` or `src/components` imports `mock-data.ts` or `mock-provider.ts`; `main.ts` picks the provider through `select.ts`. The live provider (`src/host/live-provider.ts`: the Hermes gateway through the Rust host) implements the same interfaces and the UI does not change.

```
data/
  types.ts          the entities (plain data: no functions, no DOM)
  provider.ts       the interfaces: streams plus commands
  store.ts          small reactive containers a provider builds its streams from (store, emitter, feed)
  index.ts          setProvider() / data(): the one place the app learns its provider
  select.ts         which provider this build runs on (VITE_DATA_PROVIDER, default "mock")
  mock-data.ts      today's content: v6's data.js plus what lived inside the v6 modules
  mock-provider.ts  serves mock-data through the interfaces and plays the backend (replies, runs, approvals)
```

## Streams, not getters

| Shape | Meaning |
|---|---|
| `Watch<T>` | the current value of something that changes: `get()` now, `subscribe(fn)` to every change |
| `Feed<S, E>` | a snapshot plus the events that follow it: `snapshot()`, `subscribe(fn)` |
| a command | a method; it returns when the provider has accepted it, and **the result arrives on a stream** |

A command never returns the new state for the UI to apply. The UI calls `bots.send(...)` and renders the `message` events that come back, so a reply that streams from the gateway and a reply the mock types out look the same to a module.

`DataProvider.ready` resolves when the first snapshot of everything is in; the app boots after it. Unknown values are `null` or empty in the entities, and the UI shows them as unknown. A provider never invents a value (AGENTS.md invariant 5), and the app never falls back to the mock when the live provider fails.

## The sources

| Source | Reads | Commands | The UI that uses it |
|---|---|---|---|
| `user` | `Watch<User>` | | shell (account menu, avatar) |
| `sessions` | `list`, `archived` (`Watch<SessionSummary[]>`), `conversation(id)` (`Feed<Conversation, ConversationEvent>`), `diff(id, {blank})`, `draft()` | `create`, `rename`, `fork`, `archive`, `restore`, `send(id, text, meta)`, `stop`, `answerBlank`, `openPullRequest` | session tab, list, palette, title |
| `details` | `context`, `todos`, `changes`, `output`, `connectors`, `environment`, `governance`, `ledger` (all `Watch`) | `compactContext`, `setGovernance`, `setConnector`, `signIn` | details panel, composer chips, dock (context) |
| `bots` | `Feed<BotsSnapshot, BotsEvent>` (bots and their threads), `catalog()` | `send(id, text, via)`, `stop`, `decide`, `update`, `create`, `archive` | bots tab, dock sessions, palette |
| `waits` | `Feed<Wait[], WaitsEvent>`: approvals and open questions that wait on the user | `resolve(id, outcome)` | dock, shell attention |
| `run` | `current: Watch<RunSnapshot>` | `stop`, `setSetting` | dock |
| `schedules` | `list: Watch<Schedule[]>` | `runNow`, `setPaused` | dock |
| `feedforward` | `catalog()`: the decision words the composer marks, with their options and guesses | | session composer |
| `dictation` | | `start({botId}, onTranscript)` | session composer's mic |
| `files` | | `pick('file' | 'folder')`, `complete(word, sessionId)` | attach menu (mentions) |

## Events

- `ConversationEvent`: `turn-added`, `step-added`, `turn-finished`, `blank-answered`, and (the live provider's, additive) `turn-text` (the running answer so far, streamed from `message.delta`) and `reset` (read the snapshot again: a transcript loaded, or events were lost).
- `BotsEvent`: `bot` (state, attention, activity, config), `bot-created`, `bot-archived`, `message` (with `streaming`), `message-text` (the text so far), `message-end`, `message-resolved`, `run` (a reply is being worked on, or stopped).
- `WaitsEvent`: `added`, `resolved`.

One decision, one path: an approval is decided with `bots.decide` (in a thread) or `waits.resolve` (in the dock), and the provider tells **both** the thread and the dock. The Session tab's open question works the same way (`sessions.answerBlank` or `waits.resolve`). The v6 mock-up passed `hx:approval`, `hx:bot-state` and `hx:bot-message` between modules to keep them in step; those are gone, and the provider is the one source of truth.

## Mapping from the mock-up

The v6 mock-up read `HX.data` (the `data.js` file) and mutated it from three modules. What moved where:

| v6 | Here |
|---|---|
| `data.js` `bots`, `botThreads`, `botSuggestions` | `mock-data.ts`; `bots.snapshot()`, `bots.catalog().suggestions` |
| `data.js` `sessions`, `conversation`, `composerDraft` | `sessions.list`, `sessions.conversation(id)`, `sessions.draft()` |
| `data.js` `context`, `connectors`, `output`, `environment`, `todos`, `changes`, `governance`, `ledger` | `details.*` |
| session.js `STEPS`, `HISTORIES`, `BLANK`, `diffFiles` | the turns' `steps`, other sessions' turns, `BlankData.rewrites`, `sessions.diff()` |
| session.js `DECISIONS` | `feedforward.catalog()` |
| bots.js `ACTIVITY`, `SPENT`, `REPLY`, the model, channel and approval lists | `Bot.activity`, `Bot.spent`, the mock's replies, `bots.catalog()` |
| dock.js `LAST`, `SCHED`, `S.run`, `S.waits` | `Bot.last`, `schedules`, `run`, `waits` |
| the timers in the modules that faked a reply, a run, a sign-in or a dictation | the mock provider (`mock-provider.ts`) |

## The live provider (`src/host/`)

`VITE_DATA_PROVIDER=live` (the desktop build: `vite --mode desktop`, `.env.desktop`) connects through the host (`bridge.ts`, `gateway.ts`) and serves the whole Sessions section from the gateway and the hypotaxis plugin:

| Source | From |
|---|---|
| `sessions.list`, `archived`, `conversation`, `send`, `stop`, `rename`, `archive`, `restore` | `session.list`, `session.resume`, `message.*`, `tool.*`, `prompt.submit`, `session.interrupt`, `session.title`, `session.archive` |
| `waits` | `approval.request` / `approval.respond`, and the plugin's blanks |
| `details.context` | `session.context_breakdown` and the `session.usage` event |
| `details.todos` | the `todo.updated` event and `session.resume`'s `todo_state` |
| `details.output` | `tool.complete` and the plugin's `ship.completed` |
| `details.connectors` | `mcp.servers.status`, plus the MCP servers of `plugin.hypotaxis.compat.inventory` |
| `details.environment` | `session.info`, `plugin.hypotaxis.describe` |
| `details.governance`, `ledger`, `models` | `plugin.hypotaxis.cascade.state` (the ladder), `ledger.stats` (spend and tokens, computed by the plugin from tokens), `describe` (mode, cap) |
| `details.changes`, `sessions.diff` | `plugin.hypotaxis.checkpoint.diff` (the kept ships), refreshed on `ship.completed` and at the end of a turn |
| `run.current` | the running turn (events), `ledger.stats` and `cascade.state` |
| blanks (`waits`, `sessions.answerBlank`) | `blank.opened`, `blank.filled`, `blank.lapsed`; the answer goes to `blank.fill` |
| `files.complete` | `complete.path` |
| `sessions.fork` | `session.branch`, only when this Hermes has it |

`details` follows one session: `sessions` selection calls `details.follow(id)`. Each live session keeps a record (`host/live/session-model.ts`) that events fill (a pure reducer) and reads complete (`host/live/details.ts`); `map-details.ts` holds the pure mappings, tested against frames recorded from a real gateway and plugin (`tests/e2e/record_ui_frames.py`, saved in `tests/fixtures/frames/`).

**Unknown stays unknown.** `details.notes` says what a panel cannot know or this Hermes cannot do (a context window not reported yet, "cost: unknown \u2014 no price for this model" when `ledger.stats` has `cost_usd: null`, a folder that is gone); `details.can` disables a control that would pretend (compacting without `session.compress`, switching a connector). `RunSnapshot.cost` and `.cap` are `null` when unknown, and the dock shows "cost unknown" and no meter. `provider.info.unavailable` lists what this Hermes lacks with the reason (learned once by probing a method with an id that matches nothing: only "unknown method" counts), and the UI hides what it names (Fork).

**Reconnect and replay.** The host replays missed events itself (`session.events.since`). The provider rereads what events would have carried: after a `connection.state` `ready` with `reconnected` it rereads the session list, the MCP servers and every open session's details; after `connection.replay_gap` it reloads that session's transcript and details. Blanks are rebuilt from `ledger.tail`, so one opened before a restart is still asked.

**Still the mock's, named in `MOCK_SOURCES`:** `bots`, `schedules` (phase 2) and the `feedforward` catalog (the plugin's feedforward RPC is not built). `provider.info.preview` names them and the UI marks them **Preview** (the Bots tab, the dock's bots and scheduled pages, the palette) and keeps them out of attention counts. The feedforward reading is off in a live build unless the preview flag is on (`hx.v6.preview` = `{"feedforward": true}`, or `VITE_PREVIEW_FEEDFORWARD=1`), and its assumption row then ends with "preview: not read by the agent". Dictation hears nothing and the file picker returns nothing: the mock's transcript and file would be invented. `sessions.openPullRequest` is not wired and says so in the log. Not wired yet either, and refused with a reason rather than pretended: Smart (automatic model choice), changing the cap, changing the model of a session that has started, switching a connector, signing in. If the host cannot reach Hermes the app shows a notice with the error code; it never falls back to the mock.

**Tests without a host.** `host/replay.ts` plays recorded frames as the transport (`ReplayHost`); the unit tests and, in the e2e build only, `?provider=live-replay&frames=session` use it (`tests/smoke/live.mjs`).

## Writing the live provider

1. Implement `DataProvider` in a new file next to `mock-provider.ts`; build its streams with `store()` and `emitter()` or your own.
2. Keep the entities exactly as they are (additive fields only; the UI ignores what it does not know). The wire types come from `apps/shared` (`hypotaxis-v1`); map them to these entities in the provider, not in a module.
3. Resolve `ready` after the first snapshot. Emit events in order: a `message` before its `message-text`, a `turn-added` before its `step-added`.
4. Add it to `select.ts` behind `VITE_DATA_PROVIDER=live`. Never fall back to the mock when it fails: show the failure.
5. Run `pnpm test` (the mock's own tests show the event order modules rely on) and `pnpm test:smoke`.
