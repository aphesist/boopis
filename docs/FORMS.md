# Forms

Status: spec v1, 2026-11-18. Decision: ADR-0020.

**Rule: nobody should ever leave boopis to set something up.** Whenever the agent, a teammate, the plugin, Hermes or an MCP server needs something from the user (a key, a choice, a sign-in, a permission, a folder, a setting), it sends a **form**. The user answers it in place, and boopis does the rest: it saves the key, writes the config, allows the host, retries the call.

Forms are cards. They're built from the approved card system (`design/v6`, `apps/desktop/ui/src/modules/cards`) and look and behave like the rest of the app. The owner designs the visual family; this spec defines what a form *is*.

## 1. One primitive
A form is defined by a schema, and one renderer draws every form. The schema is **MCP elicitation's** (`requestedSchema`: a flat object of string, number, boolean and enum fields, with title, description, default, format, min/max) **plus boopis extensions**. MCP servers' own forms then render natively, and agents and plugins use the same standard.

| Field type | Source | Renders as |
|---|---|---|
| `string` (`format`: email, uri, date, …) | MCP | text field |
| `number` / `integer` | MCP | number field |
| `boolean` | MCP | switch |
| `enum` (+ `enumNames`) | MCP | option list; a single choice shows inline options, as blanks do |
| `x-secret: true` (string) | ext | secret field. The value never reaches the agent (section 3) |
| `x-multi: true` (enum) | ext | multi-select |
| `x-other: true` (enum) | ext | an extra "Other" option with free text |
| `x-preview` per option | ext | side-by-side preview of each option (code, diff, image, mock-up) |
| `x-picker: folder\|file\|model\|repo\|host\|teammate\|branch` | ext | the app's own picker (home-relative paths, ADR-0018) |
| `x-upload: true` | ext | a file drop, stored as an artifact; the agent gets a reference |
| `x-signin: {provider, flow?, host?, server?}` | ext | a "Sign in" button that the host runs. `server`: an installed connector, signed in with OAuth through Hermes's own flow (its loopback listener, its token store). Otherwise `provider` is an **id in the host's own table of sign-in commands** (`apps/shared/data/logins.json`), and the host runs that entry's program and arguments, as a vector, never through a shell. **A form never chooses what runs**: a `command` or `args` in the field is ignored and the card says "This sign-in is not one boopis knows" with the control disabled, as for a provider outside the table, whoever sent the form (agent, teammate, mod). The agent learns only that sign-in succeeded |
| `x-hold: true` (the submit) | ext | hold-to-approve (1 s), for consequential actions |

## 2. Kinds
Every form has a `kind`, which picks its template, defaults and where the result goes. New kinds are data (a template plus an effect), not new components.

| Kind | Example | Effect on submit |
|---|---|---|
| `credential` | "Add your OpenAI key" | secret saved to the OS keychain (local), or the control plane (cloud), referenced by the provider config. Hermes's `secret` requests and the plugin's secret source read it from there |
| `question` | "Keep `prorate` as a deprecated alias?" | the answer goes back to the agent mid-turn (as blanks are delivered) |
| `approval` | deploy to staging; a dangerous command; spending past the cap | `approval.respond` / the policy decision; the ledger records `approval.decided` |
| `permission` | "Allow `npm publish` in this project?" with once / session / always / deny | a permission rule written at the chosen scope (project, local, user) |
| `signin` | connect Linear; sign in to Google Cloud (`gcloud auth login`) | an OAuth flow Hermes runs for an installed connector, or a sign-in command from the host's own table, run by the host; tokens stored as credentials |
| `setup` | the gate command for this project; trust this repository; turn tool search off (ADR-0014); allow `api.example.com` | the config written at the right scope, with a diff shown before saving |
| `connector` | install an MCP server from the curated collection (`docs/CONNECTORS.md`) or a plugin found in a marketplace | the install flow (COMPAT §8), with its contents and pinned hash shown |
| `choice` | the model picker; pick a teammate; pick a folder for Remote Control | the selection |
| `plan` | approve the plan before work starts (plan mode) | the plan accepted, edited or rejected |
| `feedback` | "Was this result right?" | stored for the user only; feeds nothing automatically |

## 3. Secrets never reach the agent
- A secret field's value goes from the UI to the host to its store (OS keychain, Hermes's secret source, or the cloud control plane), never through the agent, the transcript, the ledger or a log. The agent receives `{saved: true, ref: "secret://<scope>/<name>"}`.
- Forms with secret fields are never mirrored to chat platforms. There, the user gets "Open boopis to finish", with a deep link.
- The ledger records `form.submitted` with field names and `provided: true` for secrets. It never records values.
- The exception is Hermes's own prompts (`secret`, `sudo`, `vault.*`, section 6). Hermes's tool needs the value, so it goes in the response frame to the gateway, which is Hermes and not the agent: Hermes's `secret` handler saves it in the profile's `.env`, `sudo` runs the command with it, the vault hands it to the password manager. It reaches no model, no plugin, no ledger line, no log and no keychain entry of boopis's, and the UI keeps no copy once it is sent.

## 4. Who can send a form
- **The agent:** the plugin tool `request_input(kind, title, schema, …)`, plus convenience forms `request_credential(host|provider, …)` and `ask(question, options, …)`. Usable from `exec` too (`await harness.request_input(...)`). By default the call returns at once with a `form_id` and the agent keeps working on whatever doesn't depend on it (as with blanks). `wait=true` blocks until answered, with a timeout.
- **Teammates (Bots):** the same tool. Their forms queue in the Bots section and the dock, and on chat platforms when they carry no secret.
- **The plugin itself:** setup steps, compat trust, cost cap, a missing gate command, a missing price.
- **Hermes:** its native interactive requests are adapted onto forms:
  - `clarify` (including batches) becomes `question`;
  - `approval.request` becomes `approval`;
  - `secret` becomes `credential`;
  - `sudo` becomes `credential`, answered for the one command Hermes names (Hermes keeps the password for the session, as its own cards say);
  - `vault.unlock_prompt`, `vault.save_login` and `vault.code` become `credential`;
  - plugin `ask_choice` becomes `choice`.
  The answer goes back through Hermes's own respond method.
- **MCP servers:** elicitation requests render as forms, labelled with the server's name and its trust state. Hermes v0.23.2 does not send them to the gateway as such (section 6): they arrive as `clarify` questions, so they are drawn as `question` forms with no MCP label.
- **The host:** sign-in flows, keychain unlock, updates.

## 4a. Origin
Every form, and every card, carries `origin`:
- `{kind: teammate, ids: [..]}`: one teammate, or several when a request is joint (for example two teammates need the same approval) or relayed (one asks on behalf of another, with `via`);
- `{kind: agent, model}`;
- `{kind: plugin|hermes|host}`;
- `{kind: mcp, server}`;
- `{kind: mod, plugin}`: a Claude Code mod asked (`docs/MODS.md`), for a permission its `$` call needs (`permission` form) or a question of its own (`$.ui.ask`, a `choice` form).

The card renders it through one shared origin slot: a teammate's orb, name and colour accent; stacked orbs plus a count for several; the model name for the agent; a glyph for the system sources. Users tell at a glance who is asking, in every place a card can appear, team chat included.

## 5. Where forms appear
- Inline in the conversation, at the point that raised them.
- In the dock's cards page, the queue of everything waiting on the user.
- In the Bots section for a teammate's forms, and in team chat, interleaved with the conversation.
- As a desktop notification, and in chat platforms when there's no secret field.

Answering in any one place resolves the form everywhere (one form id). Forms are keyboard-first: Tab and Shift-Tab move between fields, Enter submits, Space-hold confirms a hold, Esc defers (doesn't cancel), and `x` cancels. They're accessible, using the design system's labels, focus and contrast rules.

## 6. Protocol
- **Plugin to UI events:** `form.opened {form_id, kind, title, body?, schema, submit, cancel?, sensitive, origin: agent|teammate|plugin|hermes|mcp|host, expires_at?}`, then `form.resolved {form_id, status: submitted|cancelled|expired}`.
- **UI to plugin, `form.submit {form_id, values}`:** secret fields are not in `values`. The UI sends them to the host (`secret_set`), which stores them and passes the plugin a reference.
- **`form.cancel {form_id}`**, and **`form.list {session_id}`** for reconnects.
- **Ledger:** `form.opened` and `form.resolved` (field names only; secrets as `provided`). These are added to contraprova's vocabulary as the harness events were.
- Forms survive reconnects and device switches. A cloud session's open forms reach any attached device.

### Implementation notes (plugin, host and UI)
- A secret field names where the host stores it with the extension `x-secret-ref: "secret://<scope>/<name>"` (`secret://provider.<name>/api_key` for a model key). The UI splits the field off (`apps/desktop/ui/src/host/forms.ts`, `splitSecrets`), saves it with `secret_set`, and sends `form.submit {form_id, values, provided: [field, ...]}`; the plugin asks the host whether each provided secret exists and answers the agent `{saved: true, ref}`. The keychain comes first: if it refuses, nothing is sent and the form stays open with the reason.
- One renderer draws every form: the `form` kind of the card layer (`src/modules/cards/form.ts`, `form-model.ts`), from the schema kept whole (`FormSpec`). Every adapter in `host/forms.ts` builds that spec, so a source adds no component. Origin is drawn by the card layer's one origin slot (`cards/parts.ts`): the agent shows its model and the provider's logo; a teammate or an MCP server whose name the event does not carry shows none (nothing is invented).
- A form appears **inline** in the conversation, in the turn that raised it (`AgentTurn.forms`), **in the dock's "Waiting on you" queue** (a `FormWait`, next to approvals and blanks) and, for setup, in the first-run view (`host/first-run.ts`, answered through `setup_advance`, with no "Later": there is nowhere to wait). Cards with the same form id copy a decision at once; the provider then tells every place (`form-resolved`, a resolved wait), so one answer resolves everywhere, a device that answers it included.
- Forms the host itself sends (first-run setup) have `origin: "host"`. Hermes's `clarify` is adapted from the canonical `clarify.request` (`fromGatewayEvent`) and answered through `clarify.respond`; Hermes's `approval.request` keeps the approval card (the owner's hold to approve, in the thread and in the dock) and is answered through `approval.respond`. `secret`, `sudo` and `vault.*` are adapted from the gateway's server requests (next bullets); MCP elicitation has nothing to adapt (below).
- **Hermes's string prompts** (`fromServerRequest` and `answerFor` in `host/forms.ts`; `serverRequest` and `restore` in `host/live/forms.ts`). In Hermes v0.23.2 these are not events with a `*.respond` method but JSON-RPC requests from the gateway (`id: "srq-..."`, `tui_gateway/contracts/server_requests.py`; the canonical gateway writes them to the viewers attached to a local turn, and the host declares `client.capabilities {server_requests: true}` for the UI). The answer is the response frame `{id, result: {value}}`, and an empty `value` is "skipped". The live provider registers one handler: a string prompt becomes a `credential` form (the request id is the form id, the origin is Hermes), the handler returns `ANSWER_LATER` so nothing is sent yet, and the person's answer is sent with `GatewayClient.respond`. Any other server request is still refused (`-32601`), so a tool that cannot be answered fails fast. What each asks and sends:

  | Request | Params | Form | `value` sent |
  |---|---|---|---|
  | `secret` | `env_var`, `prompt`, `metadata?` (`skill_name`, `help`, `required_for`) | one masked field named for the variable; Hermes's own sentence and the skill's words | the secret |
  | `sudo` | `command` (redacted by Hermes) | one masked field; the command is shown so it can be checked | the password |
  | `vault.unlock_prompt` | `backend`, `display_name` | "Unlock *name*", master password | the password |
  | `vault.save_login` | `origin`, `site` | identifier in the clear, password masked | the pair as one JSON string, `{identifier, password}`, as Hermes's own card sends it |
  | `vault.code` | `site`, `hint` | one masked field | the code without spaces and dashes |

- Where the value goes: only in that response frame (section 3). Hermes saves a `secret` in the profile's `.env` itself and offers no other place (no keychain or vault choice), so none is offered; the form says where it goes. A secret field of these forms has no `x-secret-ref`, so `splitSecrets` would refuse it: this path never touches the keychain or the plugin, and `form.submitted` is not written (the plugin never sees it). A failed send leaves the form open with fixed words that never echo what was typed. The recorded `requests` scenario checks on a real gateway that the typed value is in Hermes's `.env` and in none of the transcript, the plugin's ledger and the logs.
- Not a hold: the design system's hold to approve is "nowhere but an approval" (DESIGN-SYSTEM.md 14.15), and a password is typed on purpose, so `sudo` is an ordinary submit. Hermes's own `approval.request` for a dangerous command is still held.
- Timeouts and withdrawal are Hermes's. A string prompt carries no deadline (Hermes waits 120 s for `secret`, `sudo` and the unlock, 180 s for the login and the code, then withdraws it), so none is drawn. The event `request.cancel {id, method, reason}` closes the form everywhere: `timeout` is expired, `interrupted`, `session_closed` and `shutdown` are cancelled, `resolved` (another window answered, or our own answer) is submitted. Cancel and Later: the buttons say Skip, Cancel or Keep locked and send an empty value (all Hermes defines); Later keeps the request waiting until Hermes withdraws it. `session.resume`'s `open_requests` redraws the prompts a session still has open. After a lost link the host's replay (`session.events.since`) gets the same list in its answer, since the event ring cannot carry "a question still waiting"; the host passes it on as the host event `connection.open_requests {open_requests}` (envelope `session_id`, sent after the replayed events, only when the list is not empty) and the UI draws each entry it has not drawn (`restore`: an id already on screen, or already answered or withdrawn, is ignored). So a prompt raised during the gap is drawn once, and one Hermes withdrew meanwhile arrives as its replayed `request.cancel`.
- What Hermes does not offer. **MCP elicitation**: the gateway gets no elicitation event, no `requestedSchema` and no server name. A form-mode elicitation is asked through the turn's clarify callback, one question per field with the server's words in the question text, and Hermes checks the answers against the schema itself (a wrong one is asked again, twice); the accept, decline or cancel the server hears is Hermes's reading of the clarify outcome. It reaches boopis as `clarify.request`, which is adapted as a `question` with no origin claim: the server's name is in the text only, and text can be written by the model too, so it is not parsed into an origin. A schema-to-form mapping and a Decline distinct from Cancel need Hermes to send the elicitation itself. **Vault "pick an item"**: Hermes has no such request (`vault.list` is a method the Settings page calls); only the three prompts above exist. URL-mode elicitation is declined by Hermes.
- Setup's models question (`setup.ladder`, kind `choice`) lists the free choices first and has the first as its `default`: "Free models (Nous free tier, no account)", then "OpenRouter free models" (a `credential` form for the key, then `setup.openrouter`, a multi-select of the catalogue's free rows). A choice Hermes cannot offer here is left out and the form says why in Hermes's terms. A free-tier limit (`error_surface.code` `free_tier_*`) raises a `choice` form from the host's adapter (`fromFreeTierLimit`): Hermes's own sentence, when it says the limit lifts, "choose another model" (asks the models question again, through `setup_reopen_models`) or wait. Nothing is invented: no allowance size, no time Hermes did not give. It also lists "Claude subscription (your Claude Code login)" (`claude-subscription`), after the API-key choice, with a sentence in its body about what Claude Code lacks (ADR-0029). Choosing it opens `setup.claude` (kind `setup`, no fields: the official commands to install, sign in or update Claude Code as `contents` rows, "Check again", "Choose another model"), and once Claude Code is ready, `setup.claude.install` (kind `connector`: the plugin, its pinned sha, where it comes from and goes, what it registers, and the command the host will run, before anything is installed). The first-run view draws every host form with `fromConnectorForm`, which shows `contents`, `pinned` and `effect` when a form has them; boopis offers no sign-in field for Claude in setup, because the login belongs to the `claude` program.
- Controls that reach outside the page say so when this build cannot run them: upload (no artifact store) is drawn disabled with a note, and so is sign-in in a build with no host (the page build); in the desktop app sign-in is enabled and the host runs it (below). A folder picker uses the host's own dialog in the desktop app; the other pickers list teammates and models and nothing else.
- **`connector` forms** (`docs/CONNECTORS.md`) are the host's, in three steps in Settings > Connectors: the inputs (a URL, a command or a collection entry's setup values, `connector_inputs`), the review (`connector_review`: the card's `contents` rows for the command and arguments, the hosts it reaches and the version, `pinned`, the config `diff`, `effect`, and a secret field per key with its `x-secret-ref` `secret://connector.<name>/<field>`) and the install (`connector_install`, which names the review's `plan_hash`). The host form carries `contents`, `pinned` and `effect` beside `diff`, and `fromConnectorForm` (`host/forms.ts`) draws it; the questions before the review are not a hold, the install is. A key goes in the install call's `secrets` to the keychain and no further. A key means a restart of Hermes: the review's "Restart" row says so and how many sessions have a turn running, and while any does (or Hermes cannot say) the form carries a required `restart` choice, `when_idle` (the default) or `now`; the install names it (`restart`) and the host refuses a key install that does not (`hx.connectors.restart_choice`). `when_idle` saves everything now, restarts when no turn runs and says so with a `connector-restart-event` notice. The card's receipt is the form's own words (`spec.receipt`), so a step that is not the install does not say "Installed".
- **`signin` forms**: one `x-signin` field. The host runs it: `connector_signin` for a `server` (Hermes's OAuth), `connector_login` for a `provider` (the host's table, by id: no command ever comes from a form, so an agent that writes a schema cannot run a program, which is what removing `terminal` in governed mode is for). The live provider's forms (`host/live/forms.ts`: `hostSignin`) and the Connectors tab give the card that sink; `hostSignin` refuses a field that carries a command, a provider outside the table or no provider without calling the host, the card draws it disabled with "This sign-in is not one boopis knows", and a known provider shows the line the host will run (`host/logins.ts` reads the same table the host does; the host decides again). Cancel on a running sign-in tells the host (`FormsSource.cancelSignin`), which cancels Hermes's flow and closes its listener. A server that is not an OAuth server, a connector that is not installed, a provider outside the table, and a sign-in address that is not `https` with a loopback return address are refused in words. The details panel's Sign in on a connector row is the same call.
- Open forms live in the plugin's memory: a plugin restart forgets them. `form.list` redraws the open ones when a session is resumed or the link returns.
- Recorded frames: `tests/e2e/record_ui_frames.py` has a `forms` scenario (`HX_REC_ONLY=forms` records it alone) over a real gateway and plugin, with a stand-in for the host's secret channel, and a `requests` scenario (`HX_REC_ONLY=requests`) with a skill whose token is missing, a `sudo` command (answered, and withdrawn by an interrupt) and what was typed left out of the recording; the unit tests (`live-requests-frames.test.ts`) and the smoke (`forms-requests`) replay them. The vault prompts need a password manager and a browser, and MCP elicitation the `mcp` package: neither is in the e2e install, so the vault frames are built in the unit tests from Hermes's contract and elicitation has none.

## 7. Rules for form authors (agents, teammates, plugin code)
- Ask only for what can't be inferred, and prefer one form with three fields over three forms.
- Every form says why it's needed and what happens on submit.
- Never ask for a secret in a question form or in chat. Use `credential`.
- Default to non-blocking: keep working on what doesn't depend on the answer.
- A form the user defers or ignores never silently stalls a run. At turn end it becomes a normal question, as a lapsed blank does.
