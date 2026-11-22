# The local API for other clients

Status: version 1 (ADR-0045). For the owner's own tools: a shell's island, a script, another extension. Everything here is computed by the boopis host from what the engine already says; the engine and the plugin are not changed. Nothing in this contract is a secret: no ticket, no token, no key, no environment variable crosses it, and the types that make every response have no field that could hold one.

## Two ways in

| You want | Use |
|---|---|
| The roster with each bot's look and model, what every bot is doing now (any client, a cron run, a room turn), notifications, approvals you can answer from anywhere, a message into a bot's own thread | **The loopback endpoint** (below). Off by default; the owner turns it on in Settings, Local API |
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

**Label your sessions.** `session.create` takes `client: {name, version?}` (name `[a-z0-9][a-z0-9._-]{0,63}`; the engine advertises `session-client-v1`). The engine keeps it and echoes it as `session.info.client`; it is "a self-declared label, never an authentication: no policy, permission, toolset, approval, prompt or telemetry path reads it". boopis shows it ("from the island" for `panacea-island`, else "from `<name>`"). `session.create`'s `source` is a closed list (`cli`, `tui`, `gui`, `acp`, `tool`, `oneshot`): it is not the field for a client's name.

## The endpoint

A small HTTP/1.1 server on `127.0.0.1` (never another address, never IPv6). **Off by default.** Settings, Local API shows the switch, the address, the token file's path (never the token), how many streams are open and **Rotate token**.

- The address is in `<app data>/client-endpoint` (`{"url": "http://127.0.0.1:<port>", "version": 1}`; the port is 47821 when free, else any free port). The token is in `<app data>/client-token`.
- `<app data>` is `~/.local/share/dev.aphesist.boopis` (Linux, `$XDG_DATA_HOME` honoured), `~/Library/Application Support/dev.aphesist.boopis` (macOS), `%APPDATA%\dev.aphesist.boopis` (Windows).
- Every request carries `Authorization: Bearer <token>`. Never put the token in an address. A script sets `X-Boopis-Client: <name>` (a valid client name) to say what it is; without one it is `unknown`.
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
| Audit | every approval answer is a line of `<app data>/audit/client-answers.jsonl` (mode `0600`, rotated at 512 KiB): time, bot, session, prompt, choice, outcome, the client's label, the surface. Never the command |

A label is not an identity: any holder of the token can name itself anything. Per-client tokens are a follow-up that changes only the token file.

### Calls

Every success is `200` with a JSON object. Every failure is the error object above with a status.

| Call | Body | Answer |
|---|---|---|
| `GET /v1` | | `{name, api, endpoints}` |
| `GET /v1/bots` | | `{bots: [Bot], last_event_id}` |
| `GET /v1/presence` | | `{presence: [Presence], last_event_id}`: the snapshot. Read it, then follow `/v1/events` from `last_event_id` |
| `GET /v1/notifications?after=<id>&limit=<n>` | | `{notifications: [Notification]}`, oldest first, at most 200 |
| `GET /v1/approvals?all=1` | | `{approvals: [Approval]}`: the ones waiting; with `all=1` also those answered or expired in the last 10 minutes |
| `POST /v1/approvals/<id>` | `{choice: "once" \| "deny", execution_generation?}` | `{approval}`. See below |
| `POST /v1/bots/<name>/say` | `{text, session?: "latest" \| "new" \| "<stored id>"}` | `{said: {profile, session_id, created}}` |
| `GET /v1/rooms` | | `{rooms: [{id, name, members: [profile]}]}` |
| `POST /v1/rooms/<id>/say` | `{text}` | `{ok: true}` |
| `GET /v1/events` | `Last-Event-ID` header optional | a Server-Sent Events stream |

**`Bot`**: `{name, display_name, role, model, provider, look: {shape, color}, known_to_boopis, presence}`. `name` is the profile name (the id everywhere). `look` is the one the owner chose in boopis, else the default for the name (the same on every machine: `apps/shared/data/look-vectors.json`). `model` is `provider/model` as the engine has it pinned, from `profiles.describe` when the roster row lacks it (the engine's roster drops it for a named profile), and `null` when nobody says. `known_to_boopis` is false for a bot made outside boopis.

**`Presence`**: `{profile, state, activity, attention, session_id, source, client, at}`.
- `state` is orb2's own words: `idle`, `listening`, `thinking`, `working`, `compute`, `speaking`, `needs`, `done`, `error`, `sleeping`.
- `activity` is a tool's name while `working` or `compute`, else empty. `attention` is `approval` or `input` while `needs`, else null.
- `source` is `gui` (the boopis window), `cron`, `room`, `island` (a client labelled `panacea-*`) or `other`. `client` is the creating client's label when it declared one. `at` is when the state began, in milliseconds since the epoch.
- **What is fine and what is coarse.** The boopis window's own turns come event by event, so every word above is reachable. A turn of another client, a cron run or a room turn comes from a poll of the engine's `session.active_list` every two seconds, at the engine's grain: `working`, `needs` (the engine says `waiting`), `thinking` (`starting`) and `idle`. A fine word stands for three seconds against a coarser poll, and a poll never invents one. A bot with several sessions shows its busiest (`needs` first, then `error`, `speaking`, `compute`, `working`, `thinking`, `listening`, `done`, `idle`). A `done` shows for six seconds and an `error` for twenty. The poll runs only while someone listens (a stream is open or the app's own reader exists).

**`Notification`**: `{id, kind, profile, title, body, session_id, room_id, source, at, urgent}`. `kind` is `approval` (urgent), `reply` (a bot finished a turn), `cron` (a scheduled run finished) or `error`. `body` is scrubbed and cut to 400 characters. A reply from the island's own session is not made (it watches it). A room turn that mentions the owner is not built yet.

**`Approval`**: `{id, profile, session_id, prompt_id, execution_generation, command, description, choices, answerable_with, timeout_s, origin: {model, tool}, governed, state, answered_by, asked_at}`.
- `id` is the prompt's id. `choices` are what the engine offered. `answerable_with` is what boopis accepts from outside its window: **`once` and `deny` only**.
- `state`: `pending`, `answering`, `settled`, `expired`. `answered_by`: `{client, surface, choice, at}` once someone has answered (`surface` is `gui`, `endpoint` or `cli`).
- A row exists only because the engine asked: from an `approval.request` event on a boopis link, or from the poll of a waiting session (`approval.pending`, with the generation and time limit read off that session's ring). An approval whose generation cannot be found is not offered.

**Answering.** The rules are boopis's own, the same as its window's card:
1. **First answer wins.** The row moves from `pending` to `answering` before the engine is called. A second client gets `409 already_answered` naming the first. If the engine fails or refuses, the row goes back to `pending` for another client; if the engine says it was already settled, the row closes as settled by someone else. A race with the boopis window is settled by the engine's own atomic resolve.
2. **`once` or `deny` only.** `session` and `always` (a standing grant) are `403 policy_refused` whether the bot is governed or not: grant them in boopis. The choice must be one the engine offered for that row (`400 choice_not_offered`).
3. **The generation must be the row's** if you send it (`409 stale_generation`); omit it to use the row's.
4. **Nothing is automatic.** No default choice (`400 choice_required`), no "all", no timeout that approves: an unanswered approval expires.
5. **Every answer is recorded** with who gave it (the audit file) and in the `approvals.changed` event.

**`say`.** `session: "latest"` is the bot's newest conversation as the engine's roster names it (the canonical chat, else the last session), and a new conversation when it has none; `"new"` always starts one, labelled with your `X-Boopis-Client`; a stored id continues that one. The boopis window does not report which thread it shows, so "the thread boopis shows" is the engine's own latest: if the window has it open, the two share it. A bot that is answering in that conversation is `409 bot_busy`; say it in a new one or wait. The reply streams as events of the session and shows in presence. A client that wants the words reads them through the gateway (`boopis connect`).

### The event stream

`GET /v1/events` answers `200` with `Content-Type: text/event-stream` and stays open. First an unnumbered `event: hello` (`{version, last_event_id}`). Then, in order, `id: <n>` / `event: <type>` / `data: <json>` for each event. A comment line (`: keepalive`) every 15 s. `Last-Event-ID: <n>` replays what the last 512 events still hold after `n`; if some were dropped an unnumbered `event: lagged` says so first. A stream that falls more than 512 events behind gets `event: lagged` (`{skipped}`) and is closed: read the snapshots again. Rotating the token closes every stream.

Each event's `data` is `{id, at, type, data}`:

| `type` | `data` |
|---|---|
| `bots.changed` | `{names: [profile]}`: a look, a name, a model or the set of bots changed; read `GET /v1/bots` |
| `bots.presence` | a `Presence` |
| `notifications.new` | a `Notification` |
| `approvals.changed` | an `Approval`, each time its state moves |
| `lagged` | `{skipped}` |

### What is not built, and why

- **Gateway methods.** `bots.say`, `bots.presence` and the others as methods of the engine's own WebSocket: the engine offers a client no way to add one.
- **Room mentions.** A notification for a room turn that mentions the owner needs the room's log read for each change; the feed makes `approval`, `reply`, `cron` and `error` ones.
- **Per-client tokens, a WebSocket, TLS.** One token and Server-Sent Events are enough for the owner's shells and scripts; the endpoint never leaves the machine.
- **A cron run's result as the notification's body.** The notification carries the session's id; the words are in the session's transcript.
- **Windows.** The endpoint is built for every platform and tested on Linux; the token file's privacy relies on the profile folder's access list there.

## The reference client

`scripts/boopis-local-client.py` (Python 3.10+, standard library only) speaks all of the above: `bots`, `presence`, `events [--approve]`, `approvals`, `answer <id> once|deny`, `say <bot> <text> [--session ...]`, `rooms`, `say-room`. `events --approve` follows the stream and asks on the terminal for each approval. It reads the endpoint and token files, refuses a token file other users can read, never prints the token, and labels itself `boopis-reference`. In fish:

```fish
python3 scripts/boopis-local-client.py bots
python3 scripts/boopis-local-client.py events --approve
```

## Versioning

`version` is 1. A new field or event is not a new version; a changed meaning is. The host's tests build on the engine's shapes for `session.active_list`, `approval.pending`, `session.events.since` and `session.resume`; a gateway upgrade that moves one fails them, not a user.
