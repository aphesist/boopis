# The command line

`boopis` with no arguments starts the app. These commands print and exit, with no window. Plain output by default, `--json`
where a script wants it (one JSON object per line), and the same exit codes everywhere.

| Command | What it does |
|---|---|
| `boopis --version`, `boopis doctor` | The version, and a report on this machine (`docs/ENGINE.md`). |
| `boopis groups list\|create\|send\|log\|set` | Group chats from a terminal. |
| `boopis run --group <group> "<task>"` | Run a task through a group to its end, past the engine's round cap. |
| `boopis bots list\|create\|set` | One bot: its role, instructions, model, look and Governed switch. |
| `boopis team check\|apply\|export` | A whole team as one file. |

Exit codes: `0` done, `1` failed or timed out (or a plan with problems), `2` a usage mistake, `3` stopped at a cap (boopis's or
the engine's), `4` a bot needs you.

The commands that talk to the engine (`groups`, `run`, `bots`, `team apply|export`) reach it the way the app does: the same engine
plan, the same control socket and ticket, the same short link to the gateway (`gateway::oneshot::Link`), and the same
`groups.*`, `profiles.*`, `cron.manage` and `mcp.servers.*` calls the app makes. If the app is running they attach to its
gateway. If nothing is running they start one the way the app would, and serve the plugin's keychain channel for as long as
the command runs. They need the app to have finished its first-run setup once. `boopis team check` reads a file and needs no
engine.

## Groups

```
boopis groups list [--all] [--json]
boopis groups create "<name>" <bot> <bot> [<bot>...] [--lead <bot>] [--purpose FILE] [--max-rounds N] [--json]
boopis groups send <group> <text...> [--file FILE] [--wait] [--json]
boopis groups log <group> [--since SEQ] [--last N] [--follow [--for SECONDS]] [--json]
boopis groups set <group> [--max-rounds N|default] [--json]
```

A `<group>` is its id or its name (any case); a name two groups share is refused and the ids are listed. `create` takes two
to six bots, as the app does, and `--lead` makes messages that name nobody go to that bot first (`groups.context`, routing
`lead`). A bot the engine will not seat yet is named, with what to do (open boopis once so every bot is prepared). The text of
`send` may be `-` to read standard input.

`send` returns when the message is written. With `--wait` it follows the discussion, printing each bot's reply as it arrives,
until the bots stop handing off (exit 0) or the engine pauses at its limit (exit 3: use `run` to go on). `log` prints the
conversation; `--follow` keeps reading until you stop it (or `--for` seconds pass).

## Run a task through a group

```
boopis run --group <group> "<task>" [--max-rounds N] [--timeout MINUTES] [--to-board <board>] [--file FILE] [--json]
```

The engine runs one discussion per message: the bots answer in rounds, and at its own limit (3 rounds or 10 messages by
default) the discussion pauses and the app shows a Continue button. `run` sends the task and, whenever the engine pauses,
calls `groups.continue` for another budget, for as long as the bots are still handing off, up to a cap of its own. It prints
every reply as it arrives and ends with one line that says why it stopped:

| Why | Exit | What it means |
|---|---|---|
| done | 0 | The bots stopped handing off. |
| cap reached | 3 | The engine paused and boopis's cap is reached. The group is paused where it is. |
| a bot needs you | 4 | An approval (or a retry) waits in the group. `run` never answers an approval for you: answer in the app, then run again. |
| error | 1 | A bot's turn failed (said in boopis's words, with what to do), or the group went quiet without finishing. The group's work is stopped. |
| timed out | 1 | `--timeout` (60 minutes by default) passed. The group keeps its place. |

**The cap.** It counts rounds in all, in the engine's budgets: with the engine's 3 rounds a budget, the default cap of 10
allows three continues. The order is the flag `--max-rounds`, then the group's own setting, then 10. A group's setting is made with
`boopis groups set <group> --max-rounds N`, with `boopis groups create ... --max-rounds N`, with `max_rounds` in a team
file, or in the app, in the group's settings.

**Why the cap is boopis's and not the engine's.** The engine has one pair of limits for every room
(`hosted_rooms.discussion.max_rounds` and `max_messages`, read once when its gateway starts, so a change needs the gateway
restarted) and nothing per room in a room's own state. A per-room value cannot be written where the engine reads it, so it is
boopis's: a small file in the app's data folder (`rooms.json`), read by the command line and the app, and enforced by `run`.
The engine's own limits are left as they are, so the app's pause and its Continue button keep working in every room.

**Handing the rest to a board.** With `--to-board <board>`, a run that stops at a cap makes one task on that kanban board,
assigned to the group's lead (or its first bot), whose body is the task and where to read the rest (the group's id), with the
discussion's id as the task's idempotency key so a second try does not make a second task. The board's own dispatcher runs it.
The engine's kanban cannot take "the remaining steps" as separate tasks: what is left is the bots' own words in a log, not a
list, and no command turns it into one. One task for the lead to split is what can be done truthfully. A board that does not
exist is refused (`boopis team apply` can make it).

## Bots

```
boopis bots list [--json]
boopis bots create <name> [--role TEXT] [--soul-file FILE|-] [--model MODEL] [--shape SHAPE --color #rrggbb] [--governed] [--json]
boopis bots set <name> [--role TEXT] [--soul-file FILE|-] [--model MODEL] [--shape SHAPE] [--color #rrggbb] [--governed|--ungoverned] [--json]
```

Made and changed by the same operations the Bots form and `team apply` use, so a bot made here is the same bot (its home, its
plugin, its approvals). A new bot is ungoverned unless you say `--governed`, and governed needs a frontier model. `set` sends
only what differs: setting a bot to what it already is does nothing (exit 0). `create` refuses a name that exists and `set`
one that does not (exit 1). Because they go through the gateway, they attach to the running app's, which is where the secret
channel is.

## Teams

```
boopis team check <file>
boopis team apply <file> [--dry-run] [--prune] [--json]
boopis team export [--output FILE [--force]] [--json]
```

A team file holds a whole team: bots (role, instructions, model, look, skills, connectors, the Governed switch), rooms
(members, lead, purpose, max rounds), kanban boards (name, folder) and cron jobs (schedule, prompt, where the result goes,
paused). The format is [`team.schema.json`](team.schema.json); a complete example, the Paper Past team, is in
[`team-example/`](team-example/paper-past.yaml). A file with a mistake is refused whole: every problem is listed with where
it is, before anything is changed, and a key that does not exist is a mistake.

`apply` compares the file with what is there and prints a plan: `+` makes, `~` changes, `-` removes. It **creates what is
missing, updates what differs, and never deletes** unless you add `--prune`; `--dry-run` prints the plan and changes nothing.
A second `apply` of the same file finds nothing to do. Things are done in this order: bots (and their connectors), rooms,
boards, jobs. An action that fails is reported, what needs it is skipped, and the rest goes on, so running it again finishes
the job. Exit 1 when any action failed or the plan has problems.

What each part does:

- **Bots**, by name. A new bot is made the way the Bots form makes it: its profile, boopis's record (look, Governed switch),
  and everything a bot needs to run (plugins, its seat in groups, the model's provider). An existing bot is compared field by
  field (role, instructions, model, look, Governed switch); only what is written in the file is compared, and only what
  differs is changed. A model is `opus` (the provider the app uses) or `provider/model`. Governed mode runs on a frontier
  model only, so asking for it on another is refused. `skills` are checked: a skill the bot does not have is reported (the
  store installs skills), one that is switched off is switched on. `connectors` are added when missing; one that is there
  with another command is left alone and said (change it in Settings > Connectors). Keys never go in a team file: a
  connector's `env` is for plain values only, and keys belong in Settings > Connectors, which keeps them in the keychain.
- **Rooms**, by name (or by `id`, to adopt a room that exists). A room's members cannot be changed once it is made, so a
  roster that differs from the file is a note, not a change; make a room under another name to have a different one. `lead`
  and `purpose` are updated, `max_rounds` is boopis's cap.
- **Boards**, by slug, through the engine's own `kanban boards` commands: made when missing, name and folder updated.
- **Cron jobs**, by bot and name, through the bot's own `cron.manage`. A job whose schedule, prompt or delivery differs is
  made again, so it gets a new id; a job that differs only in `paused` is paused or resumed. `room: <name>` (with `as: <bot>`,
  the job's bot by default) is written for the engine as `room:<id>@<bot>`; `deliver:` writes a target as the engine does.
  The engine lists a job's prompt to 100 characters, so `apply` and `export` read the whole text from the bot's
  `cron/jobs.json` (read only). Where that file cannot be read, a prompt is compared by its start, and `export` says so.
- **`--prune`** removes what is there and not in the file: bots and boards are archived (a bot can be restored), a room is
  disbanded (permanent), jobs and connectors of the bots in the file are removed. The plan shows every one first.

`export` writes what is there as a team file, with every bot's instructions and every room's purpose written into it, so the
file is one piece. It writes a bot's skills only when the bot has some the default profile does not, and never a connector's
environment values (the engine does not list them). Exporting and applying the result to the same machine finds nothing to do.

## For scripts

`--json` prints one object per line. `run` and `groups send --wait` print `sent`, `message`, `continued`, `note` and a last
`end` object (`stop` is one of `done`, `cap_reached`, `paused`, `needs_owner`, `error`, `timed_out`, with `rounds`,
`continues` and `messages`). `team apply --json` prints a `plan` object and then an `applied` object. The exit code is the
same as without `--json`.
