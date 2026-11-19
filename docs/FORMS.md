# Forms

Status: spec v1, 2026-11-18. Decision: ADR-0020.

**Rule: nobody should ever leave hypotaxis to set something up.** Whenever the agent, a teammate, the plugin, Hermes or an MCP server needs something from the user (a key, a choice, a sign-in, a permission, a folder, a setting), it sends a **form**. The user answers it in place, and hypotaxis does the rest: it saves the key, writes the config, allows the host, retries the call.

Forms are cards. They're built from the approved card system (`design/v6`, `apps/desktop/ui/src/modules/cards`) and look and behave like the rest of the app. The owner designs the visual family; this spec defines what a form *is*.

## 1. One primitive
A form is defined by a schema, and one renderer draws every form. The schema is **MCP elicitation's** (`requestedSchema`: a flat object of string, number, boolean and enum fields, with title, description, default, format, min/max) **plus hypotaxis extensions**. MCP servers' own forms then render natively, and agents and plugins use the same standard.

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
| `x-signin: {provider, flow: browser\|device}` | ext | a "Sign in" button that runs the OAuth flow in the host. The agent learns only that sign-in succeeded |
| `x-hold: true` (the submit) | ext | hold-to-approve (1 s), for consequential actions |

## 2. Kinds
Every form has a `kind`, which picks its template, defaults and where the result goes. New kinds are data (a template plus an effect), not new components.

| Kind | Example | Effect on submit |
|---|---|---|
| `credential` | "Add your OpenAI key" | secret saved to the OS keychain (local), or the control plane (cloud), referenced by the provider config. Hermes's `secret` requests and the plugin's secret source read it from there |
| `question` | "Keep `prorate` as a deprecated alias?" | the answer goes back to the agent mid-turn (as blanks are delivered) |
| `approval` | deploy to staging; a dangerous command; spending past the cap | `approval.respond` / the policy decision; the ledger records `approval.decided` |
| `permission` | "Allow `npm publish` in this project?" with once / session / always / deny | a permission rule written at the chosen scope (project, local, user) |
| `signin` | connect Linear; sign in to ChatGPT; `claude auth login` | an OAuth or CLI flow run by the host; tokens stored as credentials |
| `setup` | the gate command for this project; trust this repository; turn tool search off (ADR-0014); allow `api.example.com` | the config written at the right scope, with a diff shown before saving |
| `connector` | install an MCP server from the curated collection (`docs/CONNECTORS.md`) or a plugin found in a marketplace | the install flow (COMPAT §8), with its contents and pinned hash shown |
| `choice` | the model picker; pick a teammate; pick a folder for Remote Control | the selection |
| `plan` | approve the plan before work starts (plan mode) | the plan accepted, edited or rejected |
| `feedback` | "Was this result right?" | stored for the user only; feeds nothing automatically |

## 3. Secrets never reach the agent
- A secret field's value goes from the UI to the host to its store (OS keychain, Hermes's secret source, or the cloud control plane), never through the agent, the transcript, the ledger or a log. The agent receives `{saved: true, ref: "secret://<scope>/<name>"}`.
- Forms with secret fields are never mirrored to chat platforms. There, the user gets "Open hypotaxis to finish", with a deep link.
- The ledger records `form.submitted` with field names and `provided: true` for secrets. It never records values.

## 4. Who can send a form
- **The agent:** the plugin tool `request_input(kind, title, schema, …)`, plus convenience forms `request_credential(host|provider, …)` and `ask(question, options, …)`. Usable from `exec` too (`await harness.request_input(...)`). By default the call returns at once with a `form_id` and the agent keeps working on whatever doesn't depend on it (as with blanks). `wait=true` blocks until answered, with a timeout.
- **Teammates (Bots):** the same tool. Their forms queue in the Bots section and the dock, and on chat platforms when they carry no secret.
- **The plugin itself:** setup steps, compat trust, cost cap, a missing gate command, a missing price.
- **Hermes:** its native interactive requests are adapted onto forms:
  - `clarify` (including batches) becomes `question`;
  - `approval.request` becomes `approval`;
  - `secret` becomes `credential`;
  - `sudo` becomes a `credential` with a one-time scope;
  - `vault.*` becomes `credential`;
  - plugin `ask_choice` becomes `choice`.
  The answer goes back through Hermes's own respond method.
- **MCP servers:** elicitation requests render as forms, labelled with the server's name and its trust state.
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
- Forms the host itself sends (first-run setup) have `origin: "host"`. Hermes's `clarify` is adapted from the canonical `clarify.request` (`fromGatewayEvent`) and answered through `clarify.respond`; Hermes's `approval.request` keeps the approval card (the owner's hold to approve, in the thread and in the dock) and is answered through `approval.respond`. `secret`, `sudo`, `vault.*` and MCP elicitation are not adapted yet.
- Setup's models question (`setup.ladder`, kind `choice`) lists the free choices first and has the first as its `default`: "Free models (Nous free tier, no account)", then "OpenRouter free models" (a `credential` form for the key, then `setup.openrouter`, a multi-select of the catalogue's free rows). A choice Hermes cannot offer here is left out and the form says why in Hermes's terms. A free-tier limit (`error_surface.code` `free_tier_*`) raises a `choice` form from the host's adapter (`fromFreeTierLimit`): Hermes's own sentence, when it says the limit lifts, "choose another model" (asks the models question again, through `setup_reopen_models`) or wait. Nothing is invented: no allowance size, no time Hermes did not give.
- Controls that reach outside the page say so when this build cannot run them: sign-in (the host has no OAuth flow yet) and upload (no artifact store) are drawn disabled with a note; a folder picker uses the host's own dialog in the desktop app; the other pickers list teammates and models and nothing else.
- Open forms live in the plugin's memory: a plugin restart forgets them. `form.list` redraws the open ones when a session is resumed or the link returns.
- Recorded frames: `tests/e2e/record_ui_frames.py` has a `forms` scenario (`HX_REC_ONLY=forms` records it alone) over a real gateway and plugin, with a stand-in for the host's secret channel; the unit tests and the smoke replay them.

## 7. Rules for form authors (agents, teammates, plugin code)
- Ask only for what can't be inferred, and prefer one form with three fields over three forms.
- Every form says why it's needed and what happens on submit.
- Never ask for a secret in a question form or in chat. Use `credential`.
- Default to non-blocking: keep working on what doesn't depend on the answer.
- A form the user defers or ignores never silently stalls a run. At turn end it becomes a normal question, as a lapsed blank does.
