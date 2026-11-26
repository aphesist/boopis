# The local API for other clients

Status: version 1 (ADR-0045). For the owner's own tools: a shell's island, a script, another extension. Everything here is computed by the boopis host from what the engine already says; the engine and the plugin are not changed. Nothing in this contract is a secret: no ticket, no token, no key, no environment variable crosses it, and the types that make every response have no field that could hold one.

## Two ways in

| You want | Use |
|---|---|
| The roster with each bot's look and model, what every bot is doing now (the app, a cron run, a room turn, a kanban worker), notifications, approvals you can answer from anywhere, a conversation read and followed as the app shows it, a message into the bot's own thread, a room's log read and followed, a message into a room (held while its members work, as in the app), stopping a bot's or a room's turn | **The loopback endpoint** (below). Off by default; the owner turns it on in Settings, Local API |
| The engine's own gateway (sessions, the session's events, everything the boopis window itself uses) | **`boopis connect`** (below) says how to dial it |

The engine's gateway has no extension point for a client to add methods or events (a plugin adds `plugin.boopis.*` methods to a session's link, never a global event), so `bots.say`, `bots.presence` and the rest cannot be methods on the engine's WebSocket without patching it, which boopis never does (ADR-0023). They are calls and events of the endpoint instead.

## Which homes have their own gateway

One gateway process per machine serves every profile: the engine's `gateway.multiplex_profiles` (boopis sets it) and its host topology (`gateway/host_topology.py`). Its control socket is `<root home>/gateway.sock`. A named profile's home (`<root home>/profiles/<name>`) is a *served* profile of that gateway: its link is the same process with a ticket bound to the profile (`served_profiles` in the socket's `identify`). A profile home has a gateway of its own only if something started one there, which boopis never does. `boopis connect --json` states, per profile, `this_profile_is_served_by_the_root_gateway` and `this_profile_has_its_own_gateway` from the socket's own answers, so a client need not assume.

## `boopis connect`

```
boopis connect [--profile NAME] [--json] [--ticket] [--start]
```

Runs as the owner in a terminal, before any window. Reads the control socket; prints how to dial the gateway.

- Without `--ticket` **no credential is printed at all**, so the output is safe to log: `{version, profile, url, protocols: ["hermes-gateway-v1"], ticket: null, gateway: {state, instance_id, capabilities, root_home, profile_home, control_socket, serves_profile_homes, this_profile_is_served_by_the_root_gateway, this_profile_has_its_own_gateway}, client: {...}, docs}`.
- With `--ticket` it mints **one single-use ticket (30 seconds)** through the same control socket any process of the owner can ask (`identify`, then `session-ticket` with `purpose: "interactive"`), puts it in `protocols` as `hermes-gateway-ticket.<ticket>`, and prints it to its standard output and nowhere else: not a log, a file or a setting. Treat the output as a credential for those 30 seconds.
- `--start` starts the engine when none runs. Without it, no engine is exit code 1.
- Exit codes: 0 done, 1 no engine or it refused, 2 a usage error.

**One thread.** Nothing in this contract tells a client from the app: a message you say shows in the app, one typed in the app shows to you, and nothing is labelled "from the island". If you start a conversation on the engine's gateway yourself, start it as the app does, `session.create {source: "gui"}` (`boopis connect --json` says so), so the app shows it like any other. The engine's optional `client` label is not used by boopis and is not read by anything here.

## The endpoint

A small HTTP/1.1 server on `127.0.0.1` (never another address, never IPv6). **Off by default.** Settings, Local API shows the switch, the address, the token file's path (never the token), how many streams are open and **Rotate token**.

- The address is in `<app data>/client-endpoint` (`{"url": "http://127.0.0.1:<port>", "version": 1}`; the port is 47821 when free, else any free port). The token is in `<app data>/client-token`.
- Both files belong to the running app. One boopis runs per user: launching it again brings the running window forward and starts nothing. When the app closes it removes each file only while it still holds what that app wrote, so a file written by a later run is never taken away.
- `<app data>` is `~/.local/share/dev.aphesist.boopis` (Linux, `$XDG_DATA_HOME` honoured), `~/Library/Application Support/dev.aphesist.boopis` (macOS), `%APPDATA%\dev.aphesist.boopis` (Windows).
- Every request carries `Authorization: Bearer <token>`. Never put the token in an address. There is one token for every local client: a client is cut off by Rotate, and by the new token every start makes.
- One request per connection (`Connection: close`) except the event stream. JSON in and out (`Content-Type: application/json` on a `POST`). No keep-alive, no chunked bodies, no compression, no CORS, no cookies, no redirects.

### Security (ADR-0045)

| Rule | Detail |
|---|---|
| Loopback only | binds `127.0.0.1`; a connection from anywhere else is dropped |
| Token | 256 bits from the system's random source; new at every start and on Rotate; `client-token` mode `0600`, written by renaming a private temporary file into place, re-checked at every start (a readable file is never used); compared in constant time; on Windows the file relies on the user profile's access list |
| Host | exactly `127.0.0.1:<port>` or `localhost:<port>`; anything else (DNS rebinding) is `403 bad_host`, before the token is looked at |
| Origin | any `Origin` header, any `Sec-Fetch-*` header or `Access-Control-Request-*` header is `403 browser_refused`: browsers may not call this. `OPTIONS` is `405`; no `Access-Control-*` header is ever sent |
| Shape | HTTP/1.1 only; `GET` and `POST` only; request line 512 bytes, head 8 KiB, 32 headers, body 64 KiB, a message 32 KiB; no `%` escapes, no chunked body, no `Expect`, no `Upgrade`; 5 s to send the head and the body |
| Limits | 16 connections, 8 event streams; 20 reads a second (burst 40) and 2 writes a second (burst 6); 5 wrong tokens in 10 s shut the door for 10 s (`429 too_many_failures`) |
| No secret | responses and events are typed values chosen field by field; free text from the engine (a command, a description, a tool's name, a preview) passes a scrubber for bearer tokens, ticket strings, key shapes, `password:`-style values and long opaque strings, and the exact values the host holds (the endpoint's token) |
| Errors | `{"error": {"code", "message"}}`: what happened and what to do; never the request's text, the token or a path |
| Audit | every approval answer and every stop is a line of `<app data>/audit/client-answers.jsonl` (mode `0600`, rotated at 512 KiB): time, bot, session (a room's id for a room's stop), prompt, choice (`stop`, `stop_room` for a stop), outcome, and the surface it came through (`gui` for the app's window, `endpoint` for this API), never a name and never the command. No screen shows it |

| Owner voice (B47, H4, ADR-0062) | an answer (`POST /v1/approvals/<id>`) or a message in the owner's voice (`POST /v1/bots/<name>/say`, `/retry`, `POST /v1/rooms/<id>/say`) is refused with `403 owner_surface_unproven` ("Answer this in boopis.") when any process holding the client's end of the connection is a bot's: a gateway the host identified at the engine's control socket is that process or one of its ancestors, it was started with `BOOPIS_ENGINE_LAUNCH` (which the host puts in the gateway's launch environment and every process the engine starts inherits), or it sits in the gateway's own cgroup (Linux). A client that cannot be shown to be the owner's is refused the same way: before the host has identified a gateway, a connection the system table does not show, a process that cannot be read, a lookup over 500 ms. Stops and reads stay open. The audit line says `refused:bot_process:<rule>` or `refused:owner_surface_unproven:<why>`, never a pid. **Linux only today**: on macOS and Windows every owner-voice route is refused and the owner answers in the app (`crates/boopis-peer`) |

**What a bot cannot do, and what remains (B47).** A bot runs as the owner's user, so none of this is a sandbox. A bot's session may not read the token or this endpoint's address file (a denied read for every session), may not name these routes, the engine's control socket or owner-only commands in a command line, code or a URL, and the host refuses an owner-voice request from its processes. A program that double-forks, clears its environment (`env -i`) and moves itself out of the gateway's cgroup (`systemd-run --user --scope`) passes the host's check; reading the token is denied but a program can build the path. This is defence in depth: per-client tokens are the follow-up, and the owner's call.

There are no per-client tokens (the owner skipped them): every client holds the same token, and no client is told apart from another. On Windows the token file's privacy relies on the user profile folder's access list, which the owner accepted.

### Calls

Every success is `200` with a JSON object. Every failure is the error object above with a status. A snapshot (`/v1/bots`, `/v1/presence`, `/v1/rooms`) is current from the first request after boopis starts, with or without a stream open: the host reads the roster and the rooms at start, and a snapshot read asks the engine again when what it holds is older than its cadence (10 s for the roster, 2 s for the bots' sessions).

| Call | Body | Answer |
|---|---|---|
| `GET /v1` | | `{name, api, endpoints}` |
| `GET /v1/bots` | | `{bots: [Bot], last_event_id}` |
| `GET /v1/presence` | | `{presence: [Presence], last_event_id}`: the snapshot. Read it, then follow `/v1/events` from `last_event_id` |
| `GET /v1/notifications?after=<id>&limit=<n>` | | `{notifications: [Notification]}`, oldest first, at most 200 |
| `GET /v1/approvals?all=1` | | `{approvals: [Approval]}`: the ones waiting; with `all=1` also those answered or expired in the last 10 minutes |
| `POST /v1/approvals/<id>` | `{choice: "once" \| "deny" \| "session" \| "always", execution_generation?}` (the last two on a boopis rule's card only) | `{approval}`. See below |
| `GET /v1/bots/<name>/conversation?session=latest\|<stored id>&limit=<n>` | | `{profile, session_id, messages: [Message], older, last_event_id}`: the conversation as the app shows it, oldest first |
| `POST /v1/bots/<name>/say` | `{text, session?: "latest" \| "new" \| "<stored id>"}` | `{said: {profile, session_id, created}}` |
| `POST /v1/bots/<name>/retry` | `{session?: "latest" \| "<stored id>"}` | `{retried: {profile, session_id, created: false}}`: the conversation's last turn is taken back and the owner's last message is sent again, the engine's own retry. See below |
| `POST /v1/bots/<name>/stop` | `{session_id?}` | `{stopped: [session id]}`: the bot's running turns are interrupted (`session.interrupt` on its own link), or only that session (a live or stored id). See below |
| `GET /v1/rooms` | | `{rooms: [{id, name, members: [profile]}]}` |
| `GET /v1/plans?state=proposed\|all` | | `{plans: [{plan_hash, title, reason, counts: {bots, rooms, boards, jobs}, state, created_at, expires_at, undoes}]}` (at most 50): team plans the house bot proposed (ADR-0061). Read only: there is no route that applies, undoes or rejects a plan (`405`); only the owner's hold in boopis does |
| `GET /v1/plans/<plan_hash>` | | the plan's `actions` (`{mark, target, what}`), `problems`, `notes`, `state`, `report`; never the fragment or the merged file |
| `GET /v1/jobs` | | `{jobs: [{id, title, state, steps, spend: {usd_est, turns}, started, at}]}`: the house bot's open jobs |
| `GET /v1/rooms/<id>/log?after=<seq>&limit=<n>` | | `RoomLog`: the room's log as lines, who is at work, what it holds. See below |
| `POST /v1/rooms/<id>/say` | `{text, now?: false}` | `{ok: true, status: "sent" \| "held", event_id, held: [Held]}`: through the room hold. See below |
| `POST /v1/rooms/<id>/stop` | `{}` | `{stopped: true, cancelled, held: [Held]}`: the room's running and queued work is stopped (`groups.stop`) |
| `GET /v1/events?conversations=1&bot=<name>&stream_ms=<n>&rooms=1&room=<id>` | `Last-Event-ID` header optional | a Server-Sent Events stream; `conversations=1` adds the words of conversations, `bot=` (up to 6) narrows them, `stream_ms` (50 to 1000, default 250) is how often this stream gets a growing reply again; `rooms=1` adds the rooms' lines, state and held messages, `room=` (up to 6) narrows them |

**`Bot`**: `{name, display_name, role, model, provider, look: {shape, color}, known_to_boopis, presence}`. `name` is the profile name (the id everywhere). `look` is the one the owner chose in boopis, else the default for the name (the same on every machine: `apps/shared/data/look-vectors.json`). `model` is `provider/model` as the engine has it pinned, from `profiles.describe` when the roster row lacks it (the engine's roster drops it for a named profile), and `null` when nobody says. `known_to_boopis` is false for a bot made outside boopis.

**`Presence`**: `{profile, state, activity, detail, progress, attention, session_id, source, summary, steps, at}`.
- `state` is orb2's own words: `idle`, `listening`, `thinking`, `working`, `compute`, `speaking`, `needs`, `done`, `error`, `sleeping`.
- `activity` is a tool's name while `working` or `compute`, else empty. `attention` is `approval` or `input` while `needs`, else null.
- `detail` is what the running tool touches, in a few safe words: `Read a file · shots/03.json`, `Run a command · cargo test`, `Open a page · docs.rs`. It is made from the arguments the engine's `tool.start` carries, and only from a file's last two path parts, a command's program and plain subcommand (never its arguments, flags or `NAME=value` environment), or a page's host (never its path, query or credentials); anything else (a search query, a message, code) leaves only the verb. It passes the scrubber and is cut at 80 characters. Null when the tool names none of these, and when no tool runs.
- `progress` is how far the running tool says it has come: `{fraction, step, of, label}`, exactly as the tool reported it and never an estimate. `step` is its own count (the item it is on, the bytes it moved), `of` the total when it said one (else null), `fraction` from 0 to 1 when there is a total (else null), `label` its own words, scrubbed and cut at 80 characters (else null). It is the engine's `tool.progress`, which it sends for an MCP server's progress notifications (at most every half second per call), on the host's own links. Null when the running tool reports nothing, which is most tools, and when no tool runs; it goes with the call. boopis's own plugin tools cannot report it yet: the engine's progress reporter is not part of its public plugin API.
- `source` is the kind of session the state comes from: `gui` (the app, and anything started the way the app starts one, `say` included), `cron`, `room`, `kanban` (a kanban worker running one of the board's tasks) or `other`; `null` while the bot is idle or sleeping (no session is behind it). It is not who started it, and a session keeps the kind it started with: what the host knows from its own link comes first (a session on it is the app's kind), then the engine's own `source` when its live-session row carries one, then the engine's own name for a room member's session (`Group: <room id>`) or for a scheduled run's (`cron_<job id>_<time>`), else `other`. `at` is when the state began, in milliseconds since the epoch.
- `summary` is what the running session is about, in a line: its title as the engine keeps it (a room member's session reads `In <room name>`; a kanban worker's, its task), else the first line of what the engine shows of it; scrubbed; `null` when the engine says neither, and while idle.
- `steps` is how many tool steps the running turn has taken, counted from the turn's own events on the host's link; `null` for a turn the host's link does not run (a cron run, a room turn, a kanban worker, another program): the plugin's pushes say each tool as it starts, but the host did not see the turn begin, so a count would be a guess. `null` while idle.
- **What is fine and what is coarse.** The boopis window's own turns come event by event, so every word above is reachable. A turn the app does not run comes from two places (0.2.0, below): **pushed**, the moment a tool starts and ends and the moment the turn ends, from the plugin's own tool hooks in every agent the engine runs; and **polled**, the engine's `session.active_list` every two seconds, at the engine's grain: `working`, `needs` (the engine says `waiting`), `thinking` (`starting`) and `idle`. A kanban worker is a process of its own that the engine's live-session list never shows: it is `working` (source `kanban`) while the bot's newest worker session (`worker_session` in `profiles.list`, asked on the bot's own link every 10 s) showed life in the last 90 seconds, the engine's own liveness rule for a worker, and its tools are pushed like any other. A fine word stands for three seconds against a coarser poll, and a poll never invents one. A bot with several sessions shows its busiest (`needs` first, then `error`, `speaking`, `compute`, `working`, `thinking`, `listening`, `done`, `idle`). A `done` shows for six seconds and an `error` for twenty. The poll runs only while someone listens (a stream is open or the app's own reader exists).

**`Notification`**: `{id, kind, profile, title, body, session_id, room_id, seq, message_id, next_run_at, source, at, urgent}`. `kind` is `approval` (urgent), `reply` (a bot finished a turn), `cron` (a scheduled run finished), `error`, `mention` (urgent: a room member addressed the owner) or `task` (a kanban task the bot ran finished, is ready for review, or is blocked). `body` is scrubbed and cut to 400 characters. Every body is the engine's own words, never a placeholder:
- a turn of the app's kind (`gui`) makes a `reply` when it ends on the app's own link, with the reply's words, and none from the poll;
- a room turn makes a `reply` with the member's message and the room's `room_id` (from the room's log, below), or a `mention` when the message addresses the owner; a failed room turn is an `error` in boopis's words. Each carries the message's `seq` and `message_id` (its event id), so the whole text can be read with `GET /v1/rooms/<id>/log?after=<seq - 1>&limit=1`; two messages in a row are two notifications;
- a turn of another program (`other`) makes a `reply` with the words it ended on (the last `message.complete` in the session's event ring); when the ring holds none, no notification is sent;
- a scheduled run makes a `cron` when the bot's own cron list (`cron.manage`, read on its link every 10 seconds while someone listens) shows the job's last run moved. The title names the job and how the run ended (`finished`, `failed`, `was stopped`, `finished, but its delivery failed`); the body is the last words the bot wrote in the run's stored session (the newest `cron` session of the bot's list the scheduler named after the job, `<job name> · <date>`, or whose id is `cron_<job id>_<time>`, and that started after the run before it ended), else, for a failed run, the engine's own already-redacted error, else nothing; `session_id` is that session when it was found; `next_run_at` is when the job runs next (milliseconds since the epoch; null when it will not run again or the engine does not say). The first read of a job is its baseline: a run that ended while nobody listened is no news;
- a kanban task makes a `task` with the summary its worker handed off (the board's `latest_summary`, read with the engine's own `kanban` command when the worker stops); a task that cannot be found on any board, or that is still running, makes none.

**The owner's mention.** The engine reserves no handle for the human: it names the human `user` in every member's prompt (`User (user): ...`), matches mentions with `@([A-Za-z0-9][A-Za-z0-9._:-]*)` case-insensitively, and resolves `@all` and `@everyone` to the members. So a member's message addresses the owner when it mentions `@user` and no member of the room holds that handle (`@user.` names the handle `user.`, which is nobody). The rule is data, `apps/shared/data/room-mentions.json`, read by the host (`rooms/mentions.rs`) and by the app's room, so both say the same.

**`Approval`**: `{id, profile, session_id, prompt_id, execution_generation, command, description, choices, answerable_with, timeout_s, origin: {model, tool}, governed, state, answered_by, asked_at}`.
- `id` is the prompt's id. `choices` are what the engine offered. `answerable_with` is what boopis accepts from outside its window: **`once` and `deny`**, and on a card the rules engine raised also `session` and `always` (B47 H6, ADR-0062).
- `state`: `pending`, `answering`, `settled`, `expired`. `answered_by`: `{surface, choice, at}` once someone has answered (`surface` is `gui`, the app's window, or `endpoint`, this API; never a name).
- A row exists only because the engine asked: from an `approval.request` event on a boopis link, or from the poll of a waiting session (`approval.pending`, with the generation and time limit read off that session's ring). An approval whose generation cannot be found is not offered.

**Answering.** The rules are boopis's own, the same as its window's card:
1. **First answer wins.** The row moves from `pending` to `answering` before the engine is called. A second answer gets `409 already_answered`, saying whether the first came from the app or from the local API. If the engine fails or refuses, the row goes back to `pending` for another client; if the engine says it was already settled, the row closes as settled by someone else. A race with the boopis window is settled by the engine's own atomic resolve.
2. **`once` or `deny`; on a boopis rule's card also `session` and `always`** (B47 H6). On a rules card (its text names a rule: "Rule: “…”"), `session` allows that rule's matches for the rest of the turn (the plugin's key is scoped to the turn), and `always` is delivered to the engine as `once` while the drafted exception is kept **as a draft**, never applied until the owner finishes it in Settings. On any other approval `session` and `always` are `403 policy_refused`: grant them in boopis. The choice must be one the engine offered for that row (`400 choice_not_offered`).
3. **The generation must be the row's** if you send it (`409 stale_generation`); omit it to use the row's.
4. **Nothing is automatic.** No default choice (`400 choice_required`), no "all", no timeout that approves: an unanswered approval expires.
5. **Every answer is recorded** with who gave it (the audit file) and in the `approvals.changed` event.

**`say`.** `session: "latest"` is the bot's newest conversation: the first row of `session.list` on the bot's own link, the list the app's bot view reads for its recent sessions, and a new conversation when it has none (the engine's roster leaves a named bot's `canonical_session` and `last_session` out, so it is not read for this); `"new"` always starts one, exactly as the app starts one (so it is named and shown as any other); a stored id continues that one. The boopis window does not report which thread it shows, so "the thread boopis shows" is the engine's own latest: if the window has it open, the two share it. A bot that is answering in that conversation is `409 bot_busy`; say it in a new one or wait. The message is made an event for every stream that follows conversations, and the reply streams there (below). In the app, a chat that has the conversation open shows the message at once as the owner's own (the host tells the window before it sends, `connection.said`), and the reply streams in that chat as one typed there would; a conversation that is not open shows it when opened. A message said into a room goes through the room hold (below); once it goes out it is the engine's own `groups.send`, so an open room shows it as the owner's, and its members' replies, from the engine's own room change events, with nothing added.

**`retry`** (0.2.0). For an error card's "Retry": the engine's own retry, the one its `/retry` runs. On the conversation (`latest`, the default, is the one `say` writes into; or a stored id) the host asks `command.dispatch {name: "retry"}` on the live session, which takes the owner's last message and everything after it out of the conversation and answers that message; the host then sends it again exactly as `say` sends one (the windows hear it first, the reply streams to every stream that follows conversations, the bot's presence moves to `listening`). The engine refuses before it takes anything back, so these leave the conversation as it was: `409 bot_busy` (the bot is answering there), `409 nothing_to_retry` (no message of the owner's), `409 cannot_retry` (the engine cannot rebuild it, as for a message with attachments, or another command answers to the name), `400 bad_session` (`new` has nothing to retry), `404 no_such_bot`, `no_conversation`, `no_such_session`. The engine takes the message back *before* it is sent again, so if sending it fails the message is gone from the conversation: that is `502 resend_failed`, and its words say exactly that (say it again). A chat open on the conversation in the app shows the message again and the new reply; the attempt it replaced stays drawn there until the conversation is opened again (the engine tells a window nothing of a rewind; the host marks its own notice `retry: true`).

### Rooms

**The room hold.** The engine runs one discussion per thread, and a newer user message ends it: a member still working has its answer dropped (`turn.cancelled`, `superseded_by_newer_user_event`). It has no queue or steer for a room, so boopis holds a message written while the members work and sends it when the discussion is over. The hold is the host's, one for every client: the app's room, `boopis groups send` and `run --group`, and `POST /v1/rooms/<id>/say` all go through it (`rooms/hold.rs`), so a message waits the same way wherever it was written. The room is busy while members are at work (`groups.state`), or while its log holds a discussion the engine has not finished that showed life in the last 45 seconds (a silent open discussion is taken as stuck). Held messages are kept in `<app data>/room-holds.json`, oldest first, so they survive the app closing; the app sends them when the room is free, and so does a command that waits for its own. Each carries the event id it is sent with, and the engine's `groups.send` is idempotent by it, so two senders never make two messages.
- `POST /v1/rooms/<id>/say` answers `status: "sent"` (it is in the room) or `"held"` (it waits), the `event_id` it has or will have in the log, and what the room holds now. `now: true` stops the running turns first (`groups.stop`) and sends at once.
- `409 hold_full`: 20 messages already wait for that room. `413 text_too_long`, `400 empty_text`, `404 no_such_room`.
- A held message is shown in the app's room, where it can be taken back or sent now.

**`RoomLog`** (`GET /v1/rooms/<id>/log`): `{room_id, name, lines: [RoomLine], latest_seq, more, working: [member id], held: [Held], last_event_id}`. Without `after` it is the newest `limit` events (default 100, at most 200); with `after=<seq>` the events after it. `latest_seq` is where to read on from; `more` says more follow. Bookkeeping events are not lines, so a page may hold fewer.

**`RoomLine`**: `{seq, id, at, kind, from, member, name, text, truncated, mentions_you}`, the words `boopis groups log` prints (`rooms/lines.rs`). `from` is `user`, `member` or `boopis`: boopis says what happened in the room in its own words (a failed turn, a cancelled turn, a member that was not available, the lead passing a message on, a stop, a discussion that paused or settled), never the engine's raw text. `member` is the member it is from, or the member a boopis line is about; `name` its name. `text` is scrubbed and cut at 16 KiB. `mentions_you` is the owner's mention above.

**`Held`**: `{id, text, at}`: the event id it will have, its words, when it was held (seconds).

**Following a room.** Open the stream with `rooms=1` (every room) or `room=<id>`: each line added to a room's log arrives as a `room.line` (`{room_id, line}`), who is at work as a `room.state` (`{room_id, working}`) when it changes, and what a room holds as a `room.held` (`{room_id, held}`) when it changes. The host reads a room's log only when the engine's room list says it moved; a room it sees for the first time starts at its end (its history is no news; read it with `GET /v1/rooms/<id>/log`).

**Stopping.** `POST /v1/rooms/<id>/stop` stops the room's running and queued work; its held messages go out once it is free. `POST /v1/bots/<name>/stop` interrupts the bot's running turns on its own link; `409 not_running` when nothing of it runs there (a kanban worker runs outside the engine's sessions and cannot be stopped from here; the answer says so). Every stop is a line of the audit file (`choice` `stop` or `stop_room`, the outcome and the surface).

### Conversations

**`Message`**: `{id, role, text, truncated, at, state}`. `role` is `user` (the owner, from the app or through this API, never told apart) or `assistant`. `text` is scrubbed, keeps its line breaks and is cut at 16 KiB (`truncated` says so). `state` is `streaming` (the reply is being written: `text` is what there is so far) or `done`. `at` is milliseconds since the epoch (0 when the engine gave no time). Tool rows, reasoning, hidden rows and compaction summaries are not messages: it is the thread the app draws.

**`GET /v1/bots/<name>/conversation`** is the engine's stored transcript of the conversation (`session=latest`, the one `say` writes into and the app shows, or a stored id), read without attaching to it. `limit` is how many of the newest rows to read (default 100, at most 200); tool rows count, so a page may hold fewer messages. `older` says there are earlier rows. `last_event_id` is the stream's position taken just before the read. Refusals: `400 bad_session` (`new` has nothing to read, or an id that is not one), `404 no_such_bot`, `404 no_conversation` (the bot has none yet), `404 no_such_session`.

**Following.** Open the stream with `conversations=1` (every bot) or add `bot=<name>` once for each bot to narrow it. Then every message added to a conversation of the host's own link arrives as a `conversation.message`, from either side:
- the owner's message typed in the app, and one said through `say`, as a `user` message (`done`);
- a bot's reply as an `assistant` message that starts empty (`streaming`), grows (the text so far, again at most every `stream_ms` while it changes: 250 ms unless the stream asked for its own pace, from 50 to 1000), and ends (`done`), all under one `id`. An event whose `id` you have already seen replaces that message.
- **Pace** (0.2.0). A client that animates the text asks for a finer pace (`stream_ms=50`); one on a slow screen for a coarser one. The host sends a growing reply again at the fastest pace any open stream asked for, and each stream thins those updates to its own: an update that comes too soon is held, and the newest held one is sent when its time comes, so the words never stall; a finished message is sent at once. `400 bad_stream_ms` for a number outside 50 to 1000, `400 stream_ms_without_conversations` without `conversations=1`.
- `session_id` is the stored id (what `say` returns) once the host has seen the session listed, which it asks for the moment it sees a new one, else the engine's live id.

To show a conversation: read it, remember `last_event_id`, open the stream (or resume it with `Last-Event-ID`), and apply the events. A message that finishes just as you read can be in both: it is the same message when the role and text match the last you read. What is covered is what runs on the host's own link: the app's conversations and those `say` starts. A conversation a program runs on the engine's gateway by itself is not visible here; that program reads it there. The host copies words off its link only while a stream follows conversations; with none, nothing of any conversation is read or kept.

### Turns the app does not run: pushed and polled (0.2.0)

The plugin is loaded in every agent the engine runs, the scheduler's and a kanban worker's included (the engine loads a profile's plugins in each of them, and a cron worker in a process of its own loads the owning profile's), and its `pre_tool_call`, `post_tool_call` and `on_session_end` hooks fire for every call. It tells the host from there, one Unix datagram per event, sent without waiting to a socket the host binds while the app runs (`activity.sock` in the host's private socket folder, mode 0700 and 0600, the folder of its secret channel; the path is in `<root home>/boopis/activity.json`, mode 0600, which only the host writes). A datagram carries the profile, the session, the event, the tool's name and call id, whether it failed, the cron job of a scheduled run (the engine's own `ctx.current_cron_execution()`), and of the call's arguments only those the safe words of `detail` are made from (`apps/shared/data/tool-args.json`), cut short. The host makes the words and scrubs them as it does every engine text. With no host listening, or a host too slow to read, the plugin drops the event at once: nothing is written to disk and nothing waits, and a turn is never slowed. A call the policy blocks is never told.

| Source | Pushed (as it happens) | Polled |
|---|---|---|
| `gui`: the boopis window and `say` | everything, on the host's own link (as before) | `needs` for a question asked elsewhere |
| `room`: a room member's turn | each tool's start and end (`activity`, `detail`), the turn's end (`done` or `error`) | whether it runs or waits (`session.active_list`, 2 s): the poll lists it, so the poll ends it |
| `cron`: a scheduled run | each tool's start and end, the turn's end | never in the live list: it stands on its pushes; the job's cron list (10 s) ends it when its own end never came, and 10 minutes without a push do too |
| `kanban`: a kanban worker | each tool's start and end | whether it runs (`worker_session`, 10 s, the engine's 90-second rule) |
| `other`: a program on the engine's gateway | each tool's start and end, the turn's end | whether it runs or waits (2 s) |

A push for a session the table does not hold yet (one the poll has not listed) waits up to five seconds for the poll to list it, which is asked at once; a delegated child's session never is, so it never shows (its parent's turn shows `working`). `needs` and approvals still come from the poll (`approval.pending`). `steps` stays null for every pushed turn. Where there is no socket (Windows, or an engine the app did not start) everything is polled, as in 0.1.9.

### The event stream

`GET /v1/events` answers `200` with `Content-Type: text/event-stream` and stays open. First an unnumbered `event: hello` (`{version, last_event_id}`). Then, in order, `id: <n>` / `event: <type>` / `data: <json>` for each event. A comment line (`: keepalive`) every 15 s. `Last-Event-ID: <n>` replays what the last 512 events still hold after `n`; if some were dropped an unnumbered `event: lagged` says so first. A stream that falls more than 512 events behind gets `event: lagged` (`{skipped}`) and is closed: read the snapshots again. Rotating the token closes every stream.

Each event's `data` is `{id, at, type, data}`:

| `type` | `data` |
|---|---|
| `bots.changed` | `{names: [profile]}`: a look, a name, a model or the set of bots changed; read `GET /v1/bots` |
| `bots.presence` | a `Presence` |
| `conversation.message` | a `ConversationMessage`: a message added to a conversation, or a reply growing or finished. Only to a stream that asked (`conversations=1`) |
| `notifications.new` | a `Notification` |
| `room.line` | `{room_id, line: RoomLine}`: a line added to a room's log. Only to a stream that asked (`rooms=1`) |
| `room.state` | `{room_id, working}`: who is at work in a room changed. Only to a stream that asked |
| `room.held` | `{room_id, held: [Held]}`: what a room holds changed (held, sent or taken back, by any client). Only to a stream that asked |
| `approvals.changed` | an `Approval`, each time its state moves |
| `lagged` | `{skipped}` |

### What is not built, and why

- **Gateway methods.** `bots.say`, `bots.presence` and the others as methods of the engine's own WebSocket: the engine offers a client no way to add one.
- **Per-client tokens (skipped by the owner's decision), a WebSocket, TLS.** One token and Server-Sent Events are enough for the owner's shells and scripts; the endpoint never leaves the machine.
- **Telling a room what a kanban worker did.** The engine has no room event a host may write except the owner's own message (`groups.send` writes `message.user` as the user), so a note from boopis in a room's log would read as the owner speaking. The `task` notification and the bot's presence say it instead; a room-visible note needs the engine to offer a host- or gateway-authored room event.
- **Stopping a kanban worker.** It runs outside the engine's sessions; there is no public call that stops it.
- **Windows.** The endpoint is built for every platform and tested on Linux; the token file's privacy relies on the profile folder's access list there.

## A worked example: an island in Quickshell

What a shell's island needs, in the order it needs it. The token and the address are two small files in `<app data>` (see above); read them with the shell's own file reader, never put the token in an address, and never log the headers. Every call below can be tried first in a terminal (fish; `$data` is the app data folder):

```fish
set data ~/.local/share/dev.aphesist.boopis
set url (jq -r .url $data/client-endpoint)
set auth "Authorization: Bearer "(cat $data/client-token)

# 1. the roster, each bot's look and what it is doing, and where the stream stands
curl -s -H $auth $url/v1/bots | jq '.bots[] | {name, look, presence}'

# 2. follow the events (-N: do not buffer), with the words of every bot's conversation. It stays open; it ends when the
#    token is rotated or boopis stops. Narrow it with &bot=kai
curl -sN -H $auth "$url/v1/events?conversations=1"

# 3. answer an approval that arrived as an `approvals.changed` event with state "pending"
curl -s -H $auth -H 'Content-Type: application/json' \
     -d '{"choice":"once"}' $url/v1/approvals/<id>

# 4. read a bot's conversation, the thread the app shows (then follow it with the stream above)
curl -s -H $auth "$url/v1/bots/kai/conversation?session=latest" | jq '.messages[] | {role, text}'

# 5. say something to a bot, in its own latest conversation
curl -s -H $auth -H 'Content-Type: application/json' \
     -d '{"text":"how is the build?","session":"latest"}' $url/v1/bots/kai/say
```

A client that sends `Expect: 100-continue` (older `curl` does for any body over 1 KiB) is refused with `400 unsupported`; add `-H 'Expect:'`. A browser's `fetch` or `EventSource` is refused by design (`403 browser_refused`, and `EventSource` cannot send the token header), so a shell talks to it through a process or its own HTTP client, as below.

The `curl` commands above are run as written by a test of the host (`the_documented_curl_commands_work_and_an_expect_header_is_refused`). The shell's side, in QML (Quickshell). It reads the two files, takes a snapshot, then follows the stream (with the conversations) and keeps its own state from the events, a bot's thread included. It is a sketch written from the contract above and from the requests the tests make; it has not been run inside Quickshell here.

```qml
import QtQuick
import Quickshell
import Quickshell.Io

Scope {
    id: root
    property var bots: ({})          // name -> {look, presence, ...}
    property var pending: ({})       // approval id -> Approval
    readonly property string dataDir: Quickshell.env("HOME") + "/.local/share/dev.aphesist.boopis"

    FileView { id: endpointFile; path: root.dataDir + "/client-endpoint"; blockLoading: true }
    FileView { id: tokenFile;    path: root.dataDir + "/client-token";    blockLoading: true }

    readonly property string url: { try { return JSON.parse(endpointFile.text()).url } catch (e) { return "" } }
    // trim: the file ends with a newline
    readonly property string token: tokenFile.text().trim()

    function headers() {
        return ["-H", "Authorization: Bearer " + token]
    }
    property var thread: ({})        // bot -> [Message], oldest first: the thread the app shows

    // 1. the snapshot, then 2. the stream
    Process {
        id: snapshot
        running: root.url !== "" && root.token !== ""
        command: ["curl", "-s", ...root.headers(), root.url + "/v1/bots"]
        stdout: StdioCollector {
            onStreamFinished: {
                const all = JSON.parse(text)
                for (const b of all.bots) root.bots[b.name] = b
                root.botsChanged()
                stream.running = true
            }
        }
    }

    property string eventName: ""
    Process {
        id: stream
        command: ["curl", "-sN", ...root.headers(), root.url + "/v1/events?conversations=1"]
        stdout: SplitParser {                 // one line at a time
            onRead: line => {
                if (line.startsWith("event:")) root.eventName = line.slice(6).trim()
                else if (line.startsWith("data:")) root.onEvent(root.eventName, JSON.parse(line.slice(5)))
            }
        }
        // the stream ends when the token is rotated or boopis stops: read both files again and reconnect
        onRunningChanged: if (!running && root.url !== "") retry.start()
    }
    Timer { id: retry; interval: 3000; onTriggered: { endpointFile.reload(); tokenFile.reload(); snapshot.running = true } }

    function onEvent(name, e) {
        switch (name) {
        case "bots.presence":     root.bots[e.data.profile].presence = e.data; root.botsChanged(); break
        case "bots.changed":      snapshot.running = true; break          // a look, a model or the set of bots moved
        case "approvals.changed":
            if (e.data.state === "pending") root.pending[e.data.id] = e.data
            else delete root.pending[e.data.id]                            // someone answered, or it expired
            root.pendingChanged(); break
        case "notifications.new": /* show e.data.title and e.data.body */ break
        case "conversation.message": root.apply(e.data); break
        case "lagged":            snapshot.running = true; break          // fell behind: read the snapshot again
        }
    }

    // the thread: an id seen again replaces that message (a reply growing), a new id is added at the end
    function apply(c) {
        const list = root.thread[c.profile] || (root.thread[c.profile] = [])
        const i = list.findIndex(m => m.id === c.message.id)
        if (i >= 0) list[i] = c.message
        else list.push(c.message)
        root.threadChanged()
    }
    // read a bot's conversation (the thread the app shows) once, then let the events keep it current
    function open(bot) {
        readProc.bot = bot
        readProc.command = ["curl", "-s", ...headers(), url + "/v1/bots/" + bot + "/conversation?session=latest"]
        readProc.running = true
    }
    Process {
        id: readProc
        property string bot
        stdout: StdioCollector {
            onStreamFinished: {
                const c = JSON.parse(text)
                if (!c.error) { root.thread[readProc.bot] = c.messages; root.threadChanged() }
            }
        }
    }
    // say: into the bot's own latest conversation, which is the app's. The message comes back as a conversation.message
    function say(bot, text) {
        sayProc.command = ["curl", "-s", ...headers(), "-H", "Content-Type: application/json",
                           "-d", JSON.stringify({ text, session: "latest" }), url + "/v1/bots/" + bot + "/say"]
        sayProc.running = true
    }
    Process { id: sayProc }

    // 3. answering: only "once" and "deny"; a refusal is in the answer's error.message, show it
    function answer(id, choice) {
        answerProc.command = ["curl", "-s", ...headers(), "-H", "Content-Type: application/json",
                              "-d", JSON.stringify({ choice }), url + "/v1/approvals/" + id]
        answerProc.running = true
    }
    Process {
        id: answerProc
        stdout: StdioCollector { onStreamFinished: { const r = JSON.parse(text); if (r.error) console.warn(r.error.message) } }
    }
}
```

What to draw from it: `bots[name].look.{shape,color}` is the orb's body and colour; `presence.state` is orb2's state word (`idle`, `listening`, `thinking`, `working`, `compute`, `speaking`, `needs`, `done`, `error`, `sleeping`) and `presence.activity` the tool's name while `working`, `presence.detail` what it touches and `presence.progress` (when not null) a bar: `fraction` when there is one, else `step` alone, with `label` under it; `needs` with `attention: "approval"` is the cue to open `pending`. A second answer arriving first is not an error to hide: the `409 already_answered` says whether the app or the API got there first, and the `approvals.changed` that follows closes the row. A thread is the same: whatever the owner types in the app arrives as a `conversation.message`, and what you `say` shows in the app.

## The reference client

`scripts/boopis-local-client.py` (Python 3.10+, standard library only) speaks all of the above: `bots`, `presence`, `notifications [--after ID]`, `events [--approve] [--conversations [--bot NAME] [--stream-ms N]] [--rooms [--room ID]]`, `conversation <bot>`, `approvals`, `answer <id> once|deny`, `say <bot> <text> [--session ...]`, `retry <bot> [--session ...]`, `stop <bot>`, `rooms`, `room-log <room> [--after SEQ]`, `say-room <room> <text> [--now]`, `stop-room <room>`. `events --approve` follows the stream and asks on the terminal for each approval. It reads the endpoint and token files, refuses a token file other users can read, never prints the token, and names itself nothing (the contract does not tell clients apart). In fish:

```fish
python3 scripts/boopis-local-client.py bots
python3 scripts/boopis-local-client.py events --approve
```

## Versioning

`version` is 1. A new field or event is not a new version; a changed meaning is.

**What boopis 0.2.0 adds**, all of it optional and compatible with version 1 (new fields, events and calls; nothing changed meaning, so a 0.1.9 client keeps working and ignores what it does not know):
- `Presence.detail`: what the running tool touches, in safe words.
- `Notification.seq` and `Notification.message_id` on a room's reply, mention or error, and `RoomLine.id`.
- `POST /v1/bots/<name>/retry`: the engine's own retry of a conversation's last turn.
- `Presence.progress`: how far the running tool says it has come, when it reports it.
- `stream_ms` on `/v1/events`: each stream's own pace for a growing reply, from 50 to 1000 ms (250 by default, as before).
- Tools of room turns, scheduled runs, kanban workers and other programs pushed as they happen (`activity`, `detail`, then `thinking`, then `done` or `error`), from the plugin's own hooks, instead of at the poll's two-second grain: a tool that runs for a second shows. See "Turns the app does not run" above.
- A scheduled run's `cron` notification carries the words the run ended on, the job's name and how it ended in the title, and `Notification.next_run_at`. It comes from the engine's own cron list, not from the poll of live sessions (which never sees a run: the scheduler builds its own agent), so every run is told, short or long; the poll makes no `cron` notification any more.

The host's tests build on the engine's shapes for `session.active_list`, `approval.pending`, `session.events.since`, `session.resume`, `session.list`, `session.transcript`, `cron.manage`, `command.dispatch {name: "retry"}` and `tool.progress`, and the plugin's on the hook arguments of `pre_tool_call`, `post_tool_call` and `on_session_end` and on `ctx.current_cron_execution()`; a gateway upgrade that moves one fails them, not a user.
