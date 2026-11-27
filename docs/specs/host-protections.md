# Host protections: no bot answers for the owner (B47)

Status: draft for w31 (the package's w28), proposed in ADR-0062. Owner decision 10 (23 November 2026): "B47 and no self-approval are host protections, not rules". They are not in the rules list (`rules-engine.md`), cannot be edited or removed in Settings, and apply whatever a bot's tiers or the global rules say.

Beside them, from ADR-0021 and ADR-0050: **paying with a saved card, or passing a run cap, always asks.** The `spend` kind is `never_allow` in `policy/bot_tiers.json`, so its Allow is read as Ask. Since the owner dropped the bots' own default asks (ADR-0050, amended 27 November 2026), it is the only ask a bot has by default; every other kind is Allow, and only the owner's rules list, or a rule set for one bot, makes a bot ask.

## 1. The problem, and what this is not

Today a bot with `terminal` can act as the owner in five ways. Each is a path to the same result: an approval answered, or a rule loosened, by something that is not the owner.

| # | Path | Today (w30/governed-bots) |
|---|---|---|
| P1 | Read `<app data>/client-token`, then `POST /v1/approvals/<id>` on the Local API | Token read refused by policy; the host accepts any holder of the token |
| P2 | Mint a ticket through the engine's control socket (`<root>/gateway.sock`), attach to the gateway and call `approval.respond` or a `plugin.boopis.*` method | Command words `gateway attach` and `connect --ticket` refused for bot sessions; the socket itself is not a denied read |
| P3 | Speak as the owner: `POST /v1/bots/<name>/say`, `/retry`, `/rooms/<id>/say` with the token (the message shows as the owner's own, ADR-0045 decision 6) | Nothing beyond P1 |
| P4 | Edit the files that hold the rules: its own `boopis/bot.json` tiers, `<root>/boopis/budget.json`, the engine's `config.yaml` (`approvals.mode: off` auto-approves every plugin card, verified below), the plugin's own installed copy | Writes through `write_file`/`patch` to these are allowed; terminal writes are not looked at |
| P5 | Run an owner-only command: `boopis team apply`, `hermes config set approvals.mode off` | Nothing |

**Defence in depth, not a sandbox.** Bots run as the owner's user on the owner's machine. Any process of that user can read the owner's files, so no measure here is a boundary against a determined program the bot writes. Grok says the same: "Do not use separate Bots as a security boundary." What these protections do is make every path above refused by default, refused twice where possible (policy plus host), audited, and visible to the owner. The real boundaries come later: a bot computer (package w32, here w35) and per-client tokens (section 7).

## 2. Where each protection runs

| Layer | Runs in | What it can see | Protections |
|---|---|---|---|
| Plugin policy (`policy.check`, step 0) | the engine, in every bot's process, for every tool call (`pre_tool_call`; fail closed on error and on timeout) | the tool name and arguments | H1 denied reads, H2 governance writes, H3 denied command words |
| Host, Local API | the boopis host | the TCP peer of each request | H4 owner-voice routes refused from bot processes |
| Host, Tauri and CLI | the boopis host and the `boopis` binary | the caller | H5 owner-only commands, H6 owner surface for approvals |
| Plugin, at session start | the engine | the profile's configuration | H7 engine settings that would silence cards |

## 3. H1: paths no session may read

A hard deny (never an ask), for **every** session, bot or owner, as `denied_read_paths` already is (`plugins/boopis/policy/denied.py`): path arguments are resolved (`~`, variables, `file://`, `..`, symlinks), folders and globs are refused when they contain a denied location, command lines and code are read word by word. Data stays in `plugins/boopis/policy/defaults.json`.

| Path | Why | Glob (`//` absolute, case-insensitive) | Computed location (`denied_locations`) | Status |
|---|---|---|---|---|
| `<app data>/client-token` | the Local API token | `//**/dev.aphesist.boopis/client-token` | beside `<root>` | **done** (w30/governed-bots) |
| `<app data>/client-endpoint` | the endpoint's address; not a secret, listed so a bot is never told where to send an answer | `//**/dev.aphesist.boopis/client-endpoint` | beside `<root>` | new |
| `<root>/gateway.sock`, `<root>/gateway.sock.path` and the socket the pointer names | the engine's control socket mints tickets for any process of the owner (P2) | `//**/gateway.sock`, `//**/gateway.sock.path` | `<root>` and every `<root>/profiles/*`; the pointer's target read once at load | new |
| The host's socket folder: `host.sock` (secrets), `host-ops.sock` (`team-ops.sock`), `activity.sock` (w30/local-api-0.2) | the host's channels; activity datagrams are unauthenticated, so a bot could forge presence | `//**/boopis/host.sock`, `//**/boopis/**/host.sock` (done), `//**/boopis/**/host-ops.sock`, `//**/boopis/**/activity.sock` | `BOOPIS_HOST_SECRETS_SOCKET` (done); its folder | partly done |
| `<root>/boopis/activity.json` | names the activity socket | `//**/boopis/activity.json` | `<root>` | new |
| `<profile>/boopis/host-channel.json`, `.hx-journal-key` | old rendezvous token, hx journal key | (as today) | (as today) | done |

The pointer `gateway.sock.path` exists because the engine binds elsewhere when the home path is too long for `sun_path` (`apps/desktop/src-tauri/src/hermes/control.rs` `socket_path`); the plugin reads it at load and adds the target, the same way it adds the secret socket from the environment.

Reading `<root>/.env` and `auth.json` (provider keys) is **not** a host protection: it is the owner's default rule "shell startup files, SSH keys, keyrings, `.env` and credential files" (`rules-engine.md` R4), which the owner may edit. Those files do not let a bot answer for the owner.

## 4. H2: governance files a bot may not change

A hard deny for **bot sessions** (a session whose `SessionPolicy.bot` is set). The owner's own sessions may still work on these files, as they may work on boopis's source today (`test_the_owner_s_own_session_may_work_on_boopis_s_source`). Checked for every tool, not only `write_tools`: a path argument of any tool, and the targets of a command line (redirections `>`/`>>`/`tee`, `cp`/`mv`/`install`/`ln`/`sed -i`/`truncate`/`rm` targets, `python -c`/`perl -e` scripts read as text), with the same resolver as H1.

| File or folder | Why |
|---|---|
| `<root>/boopis/rules.json`, `rules.json.lock` | the global rules (`rules-engine.md`) |
| `<root>/profiles/*/boopis/bot.json`, `<root>/boopis/bot-defaults.json`, `bot-skills.json`, `bot-toolsets.json` | a bot's tiers, cap and preset; the once-only records |
| `<root>/boopis/budget.json` | the monthly budget |
| `<root>/config.yaml`, `<root>/profiles/*/config.yaml` | `approvals.*`, `plugins.*`, `auxiliary.boopis_reviewer`, toolsets, model |
| `<root>/plugins/boopis/**`, `<root>/profiles/*/plugins/boopis/**` | the plugin's own installed copy, including `policy/defaults.json` and `policy/bot_tiers.json` |
| `<app data>/audit/**`, `<app data>/house/**`, `<app data>/room-holds.json` | the audit trail, plans and snapshots (`team-ops.md`), held room messages |

Matching uses `//` globs in a new list `governance_write_paths` in `defaults.json` (data, rule 6), plus computed locations under `<root>` as H1 does. Reading these files stays allowed: a bot may explain its own tiers.

## 5. H3: denied command words

For bot sessions, any tier. Best effort, as `denied.py` and `tiers.py` say: a shell can build a word from pieces. The host checks (H4, H5) are the boundary where one exists.

Already refused (w30/governed-bots, `policy/bot_tiers.json` `owner_answer.markers`, in command lines, code and URLs): `approval.respond`, `clarify.respond`, `groups.approve`, `secret.respond`, `sudo.respond`, `form.submit`, `form.cancel`, `/v1/approvals`, `client-token`, `connect --ticket`, `gateway attach`; and the chat answers `/approve`, `/deny`, `/always`, `/yes`, `/no` at the start of a message a people tool sends.

Added by this spec (same list, same matcher):

| Marker | Why |
|---|---|
| `gateway.sock`, `client-endpoint` | P1, P2 by name |
| `/v1/bots/` + `/say`, `/v1/bots/` + `/retry`, `/v1/rooms/` + `/say` | P3; read as URL path pairs |
| `boopis team apply`, `boopis team undo`, `boopis team apply --hash` | P5; the CLI also refuses itself (H5) |
| `hermes config set approvals`, `hermes config set plugins`, `hermes config set auxiliary.boopis_reviewer`, `hermes plugins disable boopis`, `hermes plugins remove boopis`, `--yolo` | P4, P5 through the engine's own CLI |
| `rules.json`, `bot.json`, `budget.json` together with a write verb (H2's list) | P4 through the shell |

A refusal says what to do: "Only the owner can do that. Tell the owner what you need and why." It never says how the check works.

## 6. H4: the host refuses owner-voice requests from bot processes

### 6.1 Which routes

Every Local API route that answers for the owner or speaks as the owner:

| Route | Owner-voice? |
|---|---|
| `POST /v1/approvals/<id>` | yes: an answer |
| `POST /v1/bots/<name>/say`, `POST /v1/bots/<name>/retry`, `POST /v1/rooms/<id>/say` | yes: shown as the owner's own words |
| `POST /v1/bots/<name>/stop`, `POST /v1/rooms/<id>/stop`, `POST /v1/jobs/<id>/stop`, `POST /v1/house/stop-all` | no: stopping only reduces activity (ADR-0045's rule), so allowed |
| every `GET` | no |

### 6.2 The decision

When an owner-voice request arrives, after the token and `Host` checks and **before** the body is acted on, the host finds every process that holds the client's end of the TCP connection and refuses the request if **any** of them is a bot process. A bot process is one for which any of these is true:

1. **Ancestry.** The gateway the host recorded (`secrets::peer::PeerPolicy`, rule A: pid, start time, executable) is on its parent chain, up to 64 hops or pid 1.
2. **Environment.** The environment it was started with holds `BOOPIS_ENGINE_LAUNCH=<nonce>`, a non-secret per-launch value the host adds to the gateway's launch environment beside the secret channel's variables, and which the plugin does **not** remove (it removes only the token). Children inherit it, also across `setsid` and a double fork. **[verify]** that the engine's child environments (`tools/environments/local.py` `build_subprocess_env`) keep a non-secret variable; the source copies `os.environ` and strips secrets, so it should.
3. **Group** (Linux only). Its cgroup (`/proc/<pid>/cgroup`) is the gateway's, when the gateway's cgroup is not shared with the host itself or the login session (a systemd unit or scope of its own). Skipped, not failed, when they are shared.

A request whose peer **cannot be identified** (the connection is not in the table, a process cannot be read, the platform cannot say) is refused the same way. Refusal: `403 owner_surface_unproven`, "Answer this in boopis." No detail of the check is sent.

### 6.3 Per platform

| Platform | Socket to processes | Ancestry and start time | Environment | Group |
|---|---|---|---|---|
| **Linux** | `/proc/net/tcp`: the row whose local address is `0100007F:<client port>` and remote `0100007F:<endpoint port>`, state `01`, gives the inode; then `/proc/<pid>/fd/*` of every process of the same uid, matching `socket:[<inode>]` (every holder counts, so a descriptor passed or inherited is still seen) | `/proc/<pid>/stat` fields 4 and 22 (`secrets::peer::Os` already reads them) | `/proc/<pid>/environ` (`Procs::started_with`) | `/proc/<pid>/cgroup` |
| **macOS** | `proc_listpids(PROC_UID_ONLY, uid)`, then `proc_pidinfo(PROC_PIDLISTFDS)` and, for socket descriptors, `proc_pidfdinfo(PROC_PIDFDSOCKETINFO)`: an `INI_IPV4` TCP socket with local port = client port and foreign port = endpoint port | `proc_pidinfo(PROC_PIDTBSDINFO)` `pbi_ppid`, `pbi_start` (w30/macos `secrets/macos.rs` reads them). The gateway's parent is `osascript` under launchd, never the host (w30/macos rule B); a tool's chain still passes through the gateway | `KERN_PROCARGS2` (w30/macos) | none |
| **Windows** | `GetExtendedTcpTable(TCP_TABLE_OWNER_PID_CONNECTIONS)` gives the owning pid of the client's end directly | `CreateToolhelp32Snapshot` `th32ParentProcessID`, checked with `GetProcessTimes` (a parent created after its child is a reused pid and ends the chain) | not read | a Job Object, if the host ever starts the gateway in one: membership (`IsProcessInJob`) survives a dead parent. It does not today |

**Windows today.** The host does not know the gateway's pid on Windows (the control socket is a named pipe the host does not use, `hermes/control.rs`), so rule 1 cannot run. Until it can, every owner-voice route is refused on Windows with `owner_surface_unproven`: approvals and messages go through the app. Stop routes and reads keep working.

The lookup runs only for owner-voice routes, which are rare. Cost budget: under 50 ms on Linux and macOS with 2,000 processes; the lookup has a 500 ms timeout, and a timeout refuses.

### 6.4 The hole that remains

A program that double-forks, clears its environment (`env -i`) and moves itself out of the gateway's cgroup (`systemd-run --user --scope`) passes all three checks. Reading the token is a denied read (H1) and a denied word (H3), but a program can build the path. This is why the spec is called defence in depth, why it is written down in `docs/LOCAL-API.md`, and why per-client tokens are the follow-up (section 7). Open question 3 asks the owner whether endpoint answers stay on.

## 7. H6: approvals are answered only from an owner surface

An approval raised in any session, a bot's or the owner's, may be answered only from:

| Surface | Proof | `answered_by.surface` |
|---|---|---|
| The boopis window | the host's own link; the webview cannot be reached by a bot | `gui` |
| A Local API client | H4 passed | `endpoint` |
| A chat platform the engine bridges (Telegram, Discord…; owner decision 7) | the engine's own approver check (`gateway.approval_actor.may_answer`); the host sets `approvals.approvers: []` (the requester and the platform's admins) in bot profiles instead of the engine default `["*"]`, which lets any admitted member answer | not seen by the host |
| Never | a bot's tool, a host-ops verb (`team-ops.md` has none), a plugin RPC a session can call | — |

**What the endpoint may answer** (changes ADR-0045's "once or deny only"; detail in `approval-surfaces.md`): `once`, `deny`; `session` (for a boopis rule card: allow all matches of that rule in this turn); `always` on a boopis rule card answers `once` and saves the drafted exception **disabled**, for the owner to finish in the app. A standing grant never becomes active from outside the window.

**Per-client tokens (follow-up, not w31).** One token per client, issued by pairing in the app (a code shown in Settings, typed into the client once), each revocable, each answer audited with the token's id. It removes "a bot that read one file holds every client's power". It reverses ADR-0045's "one token for every local client" consequence (the owner skipped per-client tokens on 22 November 2026), so it waits for the owner (open question 3). It is still not a boundary against a same-user process that reads where the client keeps its token.

**Answer provenance (follow-up).** The engine's `post_approval_response` reports `pattern_key` and `choice` but not who answered (`tools/approval_gateway_wait.py:184`). An approval answered through a ticket minted at the control socket (P2) is invisible to the host. The engine report already asks for a veto hook with the answering principal (ADR-0048 on w30/governed-bots, "What needs the engine"). Until then H1 and H3 are the only guard on P2.

## 8. H5: owner-only commands refuse a bot caller

- **CLI.** `boopis team apply` (every form), `boopis team undo` and any future rules or token command check their own process: if the recorded gateway is an ancestor (rule 1) or the environment holds `BOOPIS_ENGINE_LAUNCH` (rule 2), they exit 2 with "A bot cannot change the team. The owner applies plans in boopis." The CLI has no host state, so it reads the gateway's pid from the control socket (`hermes/control.rs` `identify`, `SO_PEERCRED`); when it cannot, it refuses only if rule 2 says bot.
- **Tauri commands** that loosen (`rules_put` with an exception, `rules_set_enabled false`, `rules_remove`, `team_plan_apply`, `team_plan_undo`, token Rotate) are reachable only from the window's own capability set (STANDARDS section 5, Tauri); no change.
- **Plugin RPCs that loosen.** `bots.write` with `approvals` or `settings.cap`, and `budget.set`, can be called by anything holding a gateway link (P2). Where the host-ops channel exists (Linux, macOS), they require a one-time owner grant: the UI asks the host (`owner_grant {purpose}`, 60 s, single use), passes it in the call, and the plugin redeems it over host-ops (`grant.redeem`, `team-ops.md` section 4). Without the channel (Windows) these RPCs keep today's behaviour, and the gap is written in `plugins/boopis/AGENTS.md`.

## 9. H7: engine settings that would silence cards

Read in the engine (v0.23.2): a plugin card goes through `request_tool_approval` then `_run_approval_gate`, which approves at once under yolo or `approvals.mode: off` (`tools/approval.py:1231`), and resolves from `approvals.cron_mode` or `unattended_mode` where no human can answer. A card that is approved without a person is a rule silenced.

- At `on_session_start` and at every gate, the plugin reads the profile's `approvals.mode` (`hermes_cli.config.load_config_readonly`, public API). For a bot session, `off` is a problem: every tool call that would need a card is refused ("Approvals are off in this bot's engine settings, so boopis cannot ask you. Turn them back on in Settings."), and the host shows it on the bot. `smart` and `manual` are both accepted (`rules-engine.md` section 9).
- `approvals.cron_mode: approve` and `unattended_mode: approve` are refused the same way for bot profiles.
- A session's `/yolo` is not readable through the public plugin API (`_yolo_active` is private). Not covered; the engine report asks for it.

## 10. Audit

- `<app data>/audit/client-answers.jsonl` (exists, ADR-0045): every owner-voice request, answered or refused, gets a line: `{at, route, profile, session_id?, prompt_id?, choice?, outcome, surface, refusal?}`. `refusal` is one of `owner_surface_unproven`, `bot_process` (with which rule matched: `ancestry`, `environment`, `group`), `lookup_timeout`. Never a pid in the file shown to clients; the pid and the matched chain go to the host log at `debug`.
- The plugin's refusals (H1, H2, H3, H7) are `tool.called` ledger events with `reason` `denied_read`, `governance_write`, `owner_answer`, `approvals_off`, as the policy writes today.
- A refused owner-voice request also raises one notification per bot per hour: "A bot tried to answer for you. It was stopped." with the bot when known (the session of the matched process, when the host can map it; else "a program").

## 11. Failure behaviour (fail closed)

| Failure | Result |
|---|---|
| The peer lookup errors, times out or finds no holder | the request is refused (`owner_surface_unproven`) |
| The recorded gateway is unknown (just restarted, not yet recorded) | rule 1 cannot clear anyone: owner-voice requests are refused until it is recorded; rule 2 still applies |
| `defaults.json` cannot be read | the policy is in its invalid-configuration state: read-only tools only (as today) |
| The pointer `gateway.sock.path` cannot be read | the default path is denied; the pointer itself is denied by name |
| The profile's configuration cannot be read (H7) | treated as `off`: cards are refused for that bot |

## 12. Local API and protocol changes

- `docs/LOCAL-API.md`: section "Security" gains the owner-voice rule and its refusal code; the approvals section gains `session` and `always` as in section 7; a "What a bot cannot do" paragraph says it is defence in depth.
- New refusal code: `403 owner_surface_unproven`.
- `docs/PROTOCOL.md` section 6 (error codes): `hx.policy.denied` gains reasons `governance_write`, `approvals_off`; new `hx.host.owner_grant_required` (plugin RPC called without a valid grant).
- Host environment for the gateway launch: `BOOPIS_ENGINE_LAUNCH` (non-secret, documented in `apps/desktop/AGENTS.md`).

## 13. What w30/governed-bots already does, and what remains

| Done on w30/governed-bots | Remains in w31/host-protections |
|---|---|
| `client-token` denied (glob and computed location) | `client-endpoint`, `gateway.sock`, `gateway.sock.path` and target, `host-ops.sock`, `activity.sock`, `activity.json` (H1) |
| owner-answer markers and chat slash answers refused for bot sessions | the markers of section 5 (H3) |
| every card names the bot and who asked | — |
| labelled bot-to-bot traffic (S2) | — |
| — | governance-file writes (H2) |
| — | host peer refusal on Linux, macOS; Windows refusal (H4) |
| — | `session`/`always` from the endpoint with the draft rule (H6) |
| — | CLI self-check, owner grants for loosening RPCs (H5) |
| — | `approvals.mode: off` and approving cron/unattended modes refused for bots; `approvals.approvers: []` for bot profiles (H7, H6) |

## 14. Acceptance tests

Plugin (`plugins/boopis/tests/`):
1. For each H1 path and for its realpath through a symlink, `read_file`, `search_files` on its folder, `terminal` with `cat`, `cd <dir> && cat <name>`, `python -c 'open("…")'` are blocked with `denied_read`, in a bot session and in the owner's.
2. `gateway.sock.path` naming `/tmp/x/gateway.sock`: reading `/tmp/x/gateway.sock` is blocked.
3. For each H2 file: `write_file`, `patch`, `terminal` with `echo x > f`, `sed -i`, `cp a f`, `mv a f`, `tee f` are blocked with `governance_write` in a bot session and allowed in the owner's own session; `read_file` of `bot.json` is allowed in both.
4. Each H3 marker in a command line, in `execute_code` code and in a URL is refused for a bot session; a message that only mentions "approval" is not.
5. A bot profile with `approvals.mode: off`: a call that would ask is refused with `approvals_off`; with `smart` or `manual` it asks.
6. `approvals.cron_mode: approve` in a bot profile is a problem on the bot.

Host (`apps/desktop/src-tauri/src/local_api/`, Rust, over the `Procs` trait's made-up process table, plus one Linux integration test with real processes):
7. A client whose process descends from the recorded gateway: `POST /v1/approvals/<id>` is `403 owner_surface_unproven`, the row stays pending, the audit line says `bot_process` and `ancestry`.
8. The same client re-parented to pid 1 but started with `BOOPIS_ENGINE_LAUNCH`: refused (`environment`).
9. A client outside the tree and without the variable: answered, `surface: endpoint`.
10. `say`, `retry` and room `say` follow 7 to 9; `stop` routes and every `GET` are answered from a bot process.
11. A connection the table cannot find, an unreadable process, a lookup over 500 ms: refused.
12. Before the gateway is recorded: refused.
13. Windows build: every owner-voice route answers `owner_surface_unproven`.
14. Linux integration: spawn a fake gateway (recorded), have it spawn a client that opens a real loopback connection and posts an answer: refused; a sibling client of the test process: answered.
15. `client-endpoint` and `client-token` stay mode `0600` (existing test kept).

CLI:
16. `boopis team apply <file>` run with the recorded gateway as an ancestor, or with `BOOPIS_ENGINE_LAUNCH` set: exit 2, nothing applied.

Plugin RPC:
17. `bots.write {approvals}` without a grant (Linux, macOS): `hx.host.owner_grant_required`; with a grant: applied once; the same grant twice: refused.

## 15. Open questions

- Owner question 3 (`README.md`): keep endpoint answers on for bot approvals, with the residual hole of section 6.4, and per-client tokens as a follow-up?

## 16. Verification log

| Claim (package) | Result |
|---|---|
| `denied_read_paths` lacks `client-token` and `gateway.sock` (B47) | Partly fixed: `client-token` is denied on w30/governed-bots (`policy/defaults.json`, `policy/denied.py` `_CLIENT_TOKEN`); `gateway.sock` is still not denied |
| Ungoverned bots have `terminal` (ADR-0042) | verified: `apps/shared/data/bot-toolsets.json` lists `terminal` on (ADR-0048 on w29/integrate) |
| The control socket mints tickets for any process of the owner | verified as documented in `docs/LOCAL-API.md` and ADR-0045; `hermes/control.rs` checks only that the socket's owner is the home's owner |
| The secret channel's peer check admits only the gateway, never a child | verified: `apps/desktop/src-tauri/src/secrets/peer.rs` rule A and the test `the_recorded_gateway_is_admitted_and_nothing_else_is` |
| PID from `/proc/net/tcp` inodes | verified as possible; the host has no such code yet. Double-fork and cgroup escapes are holes (section 6.4) |
| `approvals.mode: off` and yolo approve plugin cards silently | verified: `tools/approval.py:1231` (`_run_approval_gate`) |
| Cron and unattended platforms resolve from their mode | verified: `tools/approval.py:1238-1273`, `tools/approval_context.py:186-201`; defaults `deny` (`hermes_cli/config_defaults.py:1626-1628`) |
| `approvals.approvers` default `["*"]` | verified: `hermes_cli/config_defaults.py`, `approvals.approvers` |
| `post_approval_response` carries who answered | not as stated: it carries `command`, `description`, `pattern_key(s)`, `session_key`, `surface` (the gateway's surface, not the answerer), `choice` (`tools/approval_gateway_wait.py:184-189`) |
| Engine child environments keep a non-secret variable | [verify] (`tools/environments/local.py:375-414` copies `os.environ`, then sanitises) |
