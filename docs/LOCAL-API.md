# The local API for other clients

Status: version 1 (ADR-0045). For the owner's own tools: a shell's island, a script, another extension. Everything here is computed by the boopis host from what the engine already says; the engine and the plugin are not changed. Nothing in this contract is a secret: no ticket, no token, no key, no environment variable crosses it, and the types that make every response have no field that could hold one.

## Two ways in

| You want | Use |
|---|---|
| The roster with each bot's look and model, what every bot is doing now (the app, a cron run, a room turn), notifications, approvals you can answer from anywhere, a conversation read and followed as the app shows it, a message into the bot's own thread | **The loopback endpoint** (below). Off by default; the owner turns it on in Settings, Local API |
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
| Audit | every approval answer is a line of `<app data>/audit/client-answers.jsonl` (mode `0600`, rotated at 512 KiB): time, bot, session, prompt, choice, outcome, and the surface it came through (`gui` for the app's window, `endpoint` for this API), never a name and never the command. No screen shows it |

There are no per-client tokens (the owner skipped them): every client holds the same token, and no client is told apart from another. On Windows the token file's privacy relies on the user profile folder's access list, which the owner accepted.

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
| `GET /v1/bots/<name>/conversation?session=latest\|<stored id>&limit=<n>` | | `{profile, session_id, messages: [Message], older, last_event_id}`: the conversation as the app shows it, oldest first |
| `POST /v1/bots/<name>/say` | `{text, session?: "latest" \| "new" \| "<stored id>"}` | `{said: {profile, session_id, created}}` |
| `GET /v1/rooms` | | `{rooms: [{id, name, members: [profile]}]}` |
| `POST /v1/rooms/<id>/say` | `{text}` | `{ok: true}` |
| `GET /v1/events?conversations=1&bot=<name>` | `Last-Event-ID` header optional | a Server-Sent Events stream; `conversations=1` adds the words of conversations, `bot=` (up to 6) narrows them |

**`Bot`**: `{name, display_name, role, model, provider, look: {shape, color}, known_to_boopis, presence}`. `name` is the profile name (the id everywhere). `look` is the one the owner chose in boopis, else the default for the name (the same on every machine: `apps/shared/data/look-vectors.json`). `model` is `provider/model` as the engine has it pinned, from `profiles.describe` when the roster row lacks it (the engine's roster drops it for a named profile), and `null` when nobody says. `known_to_boopis` is false for a bot made outside boopis.

**`Presence`**: `{profile, state, activity, attention, session_id, source, at}`.
- `state` is orb2's own words: `idle`, `listening`, `thinking`, `working`, `compute`, `speaking`, `needs`, `done`, `error`, `sleeping`.
- `activity` is a tool's name while `working` or `compute`, else empty. `attention` is `approval` or `input` while `needs`, else null.
- `source` is the engine's kind of session: `gui` (the app, and anything started the way the app starts one, `say` included), `cron`, `room` or `other`. It is not who started it. `at` is when the state began, in milliseconds since the epoch.
- **What is fine and what is coarse.** The boopis window's own turns come event by event, so every word above is reachable. A turn the app does not run (a cron run, a room turn, a program on the engine's gateway) comes from a poll of the engine's `session.active_list` every two seconds, at the engine's grain: `working`, `needs` (the engine says `waiting`), `thinking` (`starting`) and `idle`. A fine word stands for three seconds against a coarser poll, and a poll never invents one. A bot with several sessions shows its busiest (`needs` first, then `error`, `speaking`, `compute`, `working`, `thinking`, `listening`, `done`, `idle`). A `done` shows for six seconds and an `error` for twenty. The poll runs only while someone listens (a stream is open or the app's own reader exists).

**`Notification`**: `{id, kind, profile, title, body, session_id, room_id, source, at, urgent}`. `kind` is `approval` (urgent), `reply` (a bot finished a turn), `cron` (a scheduled run finished) or `error`. `body` is scrubbed and cut to 400 characters. A turn in a conversation of the app's kind (`source` `gui`) makes a `reply` notification when it ends on the app's own link, and none from the poll, which sees only that it ended. A room turn that mentions the owner is not built yet.

**`Approval`**: `{id, profile, session_id, prompt_id, execution_generation, command, description, choices, answerable_with, timeout_s, origin: {model, tool}, governed, state, answered_by, asked_at}`.
- `id` is the prompt's id. `choices` are what the engine offered. `answerable_with` is what boopis accepts from outside its window: **`once` and `deny` only**.
- `state`: `pending`, `answering`, `settled`, `expired`. `answered_by`: `{surface, choice, at}` once someone has answered (`surface` is `gui`, the app's window, or `endpoint`, this API; never a name).
- A row exists only because the engine asked: from an `approval.request` event on a boopis link, or from the poll of a waiting session (`approval.pending`, with the generation and time limit read off that session's ring). An approval whose generation cannot be found is not offered.

**Answering.** The rules are boopis's own, the same as its window's card:
1. **First answer wins.** The row moves from `pending` to `answering` before the engine is called. A second answer gets `409 already_answered`, saying whether the first came from the app or from the local API. If the engine fails or refuses, the row goes back to `pending` for another client; if the engine says it was already settled, the row closes as settled by someone else. A race with the boopis window is settled by the engine's own atomic resolve.
2. **`once` or `deny` only.** `session` and `always` (a standing grant) are `403 policy_refused` whether the bot is governed or not: grant them in boopis. The choice must be one the engine offered for that row (`400 choice_not_offered`).
3. **The generation must be the row's** if you send it (`409 stale_generation`); omit it to use the row's.
4. **Nothing is automatic.** No default choice (`400 choice_required`), no "all", no timeout that approves: an unanswered approval expires.
5. **Every answer is recorded** with who gave it (the audit file) and in the `approvals.changed` event.

**`say`.** `session: "latest"` is the bot's newest conversation as the engine's roster names it (the canonical chat, else the last session), and a new conversation when it has none; `"new"` always starts one, exactly as the app starts one (so it is named and shown as any other); a stored id continues that one. The boopis window does not report which thread it shows, so "the thread boopis shows" is the engine's own latest: if the window has it open, the two share it. A bot that is answering in that conversation is `409 bot_busy`; say it in a new one or wait. The message is made an event for every stream that follows conversations, and the reply streams there (below). In the app, a chat that has the conversation open shows the message at once as the owner's own (the host tells the window before it sends, `connection.said`), and the reply streams in that chat as one typed there would; a conversation that is not open shows it when opened. A message `say` into a room (`POST /v1/rooms/<id>/say`) is the engine's own `groups.send`, so an open room shows it as the owner's, and its members' replies, from the engine's own room change events, with nothing added.

### Conversations

**`Message`**: `{id, role, text, truncated, at, state}`. `role` is `user` (the owner, from the app or through this API, never told apart) or `assistant`. `text` is scrubbed, keeps its line breaks and is cut at 16 KiB (`truncated` says so). `state` is `streaming` (the reply is being written: `text` is what there is so far) or `done`. `at` is milliseconds since the epoch (0 when the engine gave no time). Tool rows, reasoning, hidden rows and compaction summaries are not messages: it is the thread the app draws.

**`GET /v1/bots/<name>/conversation`** is the engine's stored transcript of the conversation (`session=latest`, the one `say` writes into and the app shows, or a stored id), read without attaching to it. `limit` is how many of the newest rows to read (default 100, at most 200); tool rows count, so a page may hold fewer messages. `older` says there are earlier rows. `last_event_id` is the stream's position taken just before the read. Refusals: `400 bad_session` (`new` has nothing to read, or an id that is not one), `404 no_such_bot`, `404 no_conversation` (the bot has none yet), `404 no_such_session`.

**Following.** Open the stream with `conversations=1` (every bot) or add `bot=<name>` once for each bot to narrow it. Then every message added to a conversation of the host's own link arrives as a `conversation.message`, from either side:
- the owner's message typed in the app, and one said through `say`, as a `user` message (`done`);
- a bot's reply as an `assistant` message that starts empty (`streaming`), grows (the text so far, again at most every 250 ms while it changes), and ends (`done`), all under one `id`. An event whose `id` you have already seen replaces that message.
- `session_id` is the stored id (what `say` returns) once the host has seen the session listed, which it asks for the moment it sees a new one, else the engine's live id.

To show a conversation: read it, remember `last_event_id`, open the stream (or resume it with `Last-Event-ID`), and apply the events. A message that finishes just as you read can be in both: it is the same message when the role and text match the last you read. What is covered is what runs on the host's own link: the app's conversations and those `say` starts. A conversation a program runs on the engine's gateway by itself is not visible here; that program reads it there. The host copies words off its link only while a stream follows conversations; with none, nothing of any conversation is read or kept.

### The event stream

`GET /v1/events` answers `200` with `Content-Type: text/event-stream` and stays open. First an unnumbered `event: hello` (`{version, last_event_id}`). Then, in order, `id: <n>` / `event: <type>` / `data: <json>` for each event. A comment line (`: keepalive`) every 15 s. `Last-Event-ID: <n>` replays what the last 512 events still hold after `n`; if some were dropped an unnumbered `event: lagged` says so first. A stream that falls more than 512 events behind gets `event: lagged` (`{skipped}`) and is closed: read the snapshots again. Rotating the token closes every stream.

Each event's `data` is `{id, at, type, data}`:

| `type` | `data` |
|---|---|
| `bots.changed` | `{names: [profile]}`: a look, a name, a model or the set of bots changed; read `GET /v1/bots` |
| `bots.presence` | a `Presence` |
| `conversation.message` | a `ConversationMessage`: a message added to a conversation, or a reply growing or finished. Only to a stream that asked (`conversations=1`) |
| `notifications.new` | a `Notification` |
| `approvals.changed` | an `Approval`, each time its state moves |
| `lagged` | `{skipped}` |

### What is not built, and why

- **Gateway methods.** `bots.say`, `bots.presence` and the others as methods of the engine's own WebSocket: the engine offers a client no way to add one.
- **Room mentions.** A notification for a room turn that mentions the owner needs the room's log read for each change; the feed makes `approval`, `reply`, `cron` and `error` ones.
- **Per-client tokens (skipped by the owner's decision), a WebSocket, TLS.** One token and Server-Sent Events are enough for the owner's shells and scripts; the endpoint never leaves the machine.
- **A cron run's result as the notification's body.** The notification carries the session's id; the words are in the session's transcript.
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

What to draw from it: `bots[name].look.{shape,color}` is the orb's body and colour; `presence.state` is orb2's state word (`idle`, `listening`, `thinking`, `working`, `compute`, `speaking`, `needs`, `done`, `error`, `sleeping`) and `presence.activity` the tool's name while `working`; `needs` with `attention: "approval"` is the cue to open `pending`. A second answer arriving first is not an error to hide: the `409 already_answered` says whether the app or the API got there first, and the `approvals.changed` that follows closes the row. A thread is the same: whatever the owner types in the app arrives as a `conversation.message`, and what you `say` shows in the app.

## The reference client

`scripts/boopis-local-client.py` (Python 3.10+, standard library only) speaks all of the above: `bots`, `presence`, `events [--approve] [--conversations [--bot NAME]]`, `conversation <bot>`, `approvals`, `answer <id> once|deny`, `say <bot> <text> [--session ...]`, `rooms`, `say-room`. `events --approve` follows the stream and asks on the terminal for each approval. It reads the endpoint and token files, refuses a token file other users can read, never prints the token, and names itself nothing (the contract does not tell clients apart). In fish:

```fish
python3 scripts/boopis-local-client.py bots
python3 scripts/boopis-local-client.py events --approve
```

## Versioning

`version` is 1. A new field or event is not a new version; a changed meaning is. The host's tests build on the engine's shapes for `session.active_list`, `approval.pending`, `session.events.since` and `session.resume`; a gateway upgrade that moves one fails them, not a user.
