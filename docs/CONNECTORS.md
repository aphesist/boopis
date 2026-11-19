# Connectors

The **connector collection** (`apps/shared/data/connectors.json`, schema `connectors.schema.json`) is the curated list of MCP servers boopis knows how to install, configure and trust. Any MCP server still works without being listed (COMPAT §6); listing adds a one-click install, the right forms and verified settings.

## What an entry promises
- **Pinned.** An exact package version or image digest, never `latest`. Bumps are reviewed changes to the file.
- **Verified.** Checked against the publisher's own sources on the date in `verified`, with those sources listed. Nothing in an entry is guessed: a value we couldn't confirm becomes a setup field the user fills in.
- **Variants.** One connector can run several ways, for example local, hosted, or a package with a key. The default variant is the one that keeps the most on the user's machine.
- **Honest network.** Each variant states its egress: `loopback`, a host list, or `any`. The sandbox and the policy use it, and the install form shows it.
- **Credentials through forms.** Every key is a `credential` field of the review card (FORMS.md). The key goes to the keychain and reaches the server through Hermes's secret source (the config holds a `${VAR}` reference), never through config files or the transcript. OAuth variants use a `signin` form.

## How it's installed
Built: Settings > Connectors (`apps/desktop/ui/src/host/connectors.ts`), driven by the host (`apps/desktop/src-tauri/src/connectors/`). Hermes owns MCP configuration and tokens; the host drives Hermes's own mechanisms and never writes one of Hermes's files.

1. **Pick a source.** A collection entry (each variant is a row), a **URL** (a remote HTTP server: name, URL, a sign-in choice of none, a key or OAuth, other headers, an optional OAuth client), or a **command** (a local stdio program: name, command, arguments one per line, environment, an optional variable for a key). Agents can say "add Firecrawl" and the app opens the same flow; Grok Bot's Remote HTTPS and Command connectors are these two sources (COMPAT section 7).
2. **The inputs** are a `connector` form (the host builds it; `connector_inputs`). The host reads every value as text and validates it again (below).
3. **The review** is the `connector` card (`connector_review`): exactly what will be added.
   - the **command and its arguments**, or the URL;
   - the **hosts it reaches** (the entry's verified egress; for a URL its host; for a command, "not known", because a local program runs as the user and boopis cannot say what it connects to);
   - the **pinned version** (`package@version` for a stdio entry; "not pinned" for a hosted server, a URL or a command, and it says so);
   - the **keys it needs**, each a `credential` field with `x-secret-ref: secret://connector.<name>/<field>`;
   - the **config diff** (`mcp_servers.<name>.*`, and the `secrets.boopis_host.*` wiring when a key is given), where a key is only ever a `${BOOPIS_...}` reference;
   - a **hash** of all of it. The install names that hash and the host rebuilds the plan: if anything changed since the form was shown (the collection, the request), nothing is installed (`hx.connectors.plan_changed`).
   Submitting is a hold, like every consequential action.
4. **The install** (`connector_install`), in this order so a failure leaves nothing behind: Hermes adds the server (`mcp.servers.add`, which validates it again); each key goes to the OS keychain; the keys are wired to Hermes's secret source (`hermes config set secrets.boopis_host.env.<VAR> secret://...`, `secrets.boopis_host.enabled true`); Hermes restarts once so it reads them (it reads its secret sources once per process, and connects MCP servers as it starts); then **Hermes tests the connection** (`mcp.servers.test`) and the result is shown, with the tools it found or its own reason. A failure after the add removes the server and deletes the keys that call saved.
5. **Sign-in** (a `signin` form) follows when the server uses OAuth, or from the list's Sign in button (and the session details panel's).
6. **Switching off and on** is `hermes config set mcp_servers.<name>.enabled`. **Removing** is `hermes mcp remove`, which also drops an OAuth server's tokens (the gateway's `mcp.servers.remove` does not). Its keys stay in the keychain unless the user says to delete them, and the card asks when there are any.

**Restarting Hermes is never silent.** An install that gives a key restarts the gateway, which would end a turn running in any open session. The review card says "boopis restarts Hermes to load the key" and how many sessions have a turn running (`session.active_list`: any status but `idle`). When none does, it restarts at once, and without `--yes`, so Hermes itself refuses if work started in between (the host then waits instead). When some do, or Hermes cannot say, the card asks: **Install, restart when idle** (the default: the server and key are saved now and the host restarts Hermes the moment no session has a turn running, tests the connection and says so with a notice; one waiter serves every connector that waits, and it gives up after `Limits::restart_wait_max`) or **Install and restart now** (ends the turns). The host refuses a key install that does not say when while a turn runs (`hx.connectors.restart_choice`), before it changes anything.

Open sessions keep the tools they started with. Hermes can reload MCP into them (`reload.mcp`), but that resets the prompt cache (invariant 4), so boopis never does it for the user; new sessions use the change.

### Where it lives
Settings > Connectors: the servers Hermes has (a switch, Test, Remove, and Sign in where one is owed), then a row for each collection variant, then "From a URL" and "From a command". The v6 design system has no connectors view (its mock has the session details panel's switch rows and the `connector` and `signin` cards), so the tab is **composed from those patterns for the owner's review** (settings rows, the form cards, no new component). The details panel's Connectors section now works too: its switch and Sign in go through the same host commands.

### What the host refuses (before Hermes sees anything)
- **Names**: `a-z`, `0-9`, `-`, `_`, up to 48. They become a config key and part of every tool name.
- **URLs**: `https` only; plain `http` only for `127.0.0.1`, `localhost` or `::1` (a server being developed); no user name or password; no `#` fragment; no credential in the query (`token=`, `api_key=`, `key=`, ...). The reason says where the key goes instead.
- **Commands**: one program, never a shell string. No spaces or shell characters in it; not a shell (`sh`, `bash`, `cmd`, `powershell`, ...) and not a wrapper that runs another program (`env`, `sudo`, `xargs`, `nohup`, ...); arguments are a vector (one per line, bounded, no line breaks or NUL), and an interpreter (`python`, `node`, ...) is refused any flag that takes program text (`-c`, `-e`, `--eval`, ...).
- **Environment and headers**: names are plain; a variable that changes how programs start (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, ...) is refused; a value in a variable or header that reads as a key (`*KEY*`, `*TOKEN*`, `Authorization`, `Bearer ...`) must be a `${VAR}` reference, so **a key is never a literal in anything boopis writes**.

### Sign-in
- **A remote server with OAuth uses Hermes's own flow** (`mcp.servers.oauth.start`, `.poll`, `.cancel`), so Hermes's token store holds the result (`<hermes home>/mcp-tokens/<server>*.json`, which the host never reads). Hermes starts a loopback listener of its own on `127.0.0.1` with a random port; the listener takes one callback, checks `state`, and closes with the flow. Hermes does discovery, registration, PKCE and the exchange. The host opens the page Hermes names, but only after it checks it: `https`, no credentials in the address, a `state`, and a `redirect_uri`, if present, that is loopback with a port. It then polls, cancels at the user's request, and cancels at the timeout (which closes Hermes's listener).
- **A provider's own `login` command is the host's, never a form's.** An `x-signin` field names a **provider id**; the host looks it up in its own table (`apps/shared/data/logins.json`, reviewed data shipped with the app, plus the `login` a curated collection entry may name for itself) and runs exactly that program and argument vector, as a vector with no shell, in an allowlisted environment, with a timeout and an output cap. Whoever writes a form's schema (an agent through `request_input`, a teammate, a mod's `$.ui.ask`) can name a provider and nothing more: a `command` or `args` in the field is ignored and makes the card say "This sign-in is not one boopis knows" with the control disabled, as does a provider outside the table, and `connector_login` refuses an id it does not have (`hx.connectors.unknown_login`). Governed mode removed `terminal` so the model cannot run host programs; this keeps a form from putting one back. The card shows the line it will run, and the host reports the exit status and the end of the output with anything that reads as a credential masked. Output shows when the command ends and stdin is closed, so a command that needs the user to read a code while it runs does not belong in the table.
  The table today: `gcloud auth login --brief` (browser flow that returns to localhost, checked against `gcloud auth login --help`) and `claude-code`, `claude auth login --claudeai` (the official Claude Code's own subscription sign-in: it opens a loopback link and needs no code at the terminal; see `apps/desktop/AGENTS.md`, "A provider's login command", for what was and was not observed). Not here yet: every login that prints a one-time code to read while it runs, such as `gh auth login`; they join the table when the host streams a command's output as it runs. Model sign-ins are not table entries: the ChatGPT subscription is boopis's own device-code sign-in run by the host (ADR-0030, `apps/desktop/src-tauri/src/chatgpt/`), and the engine's own `hermes auth` logins are never run (ADR-0030). The Claude form in setup uses the `claude-code` entry. Every entry is checked by a test (a plain program, no shell, no wrapper, no inline program text) and cites its sources and date. To add one: read the tool's own `--help` and docs, add the entry, and bump nothing else.
- Not built: Hermes's **device flow** for MCP servers (`oauth.flow: device`) has no gateway method, so only the browser flow runs; and `client_redirect_uri` (the client hosts the loopback, for a gateway on another machine) is the seam for a Remote endpoint, which does not exist yet.

## Adding an entry
- Read the publisher's README, docs and releases.
- Pin the version.
- Fill `verified` with the date and the sources.
- Validate against the schema. CI validates the file.

## Entries
| Connector | Variants | Notes |
|---|---|---|
| Firecrawl | **local** (Firecrawl Local, default), hosted (OAuth, or a key), package with a key | Firecrawl Local (announced 2026-11-18) runs scrape, crawl and map as Rust primitives on the user's machine. The MCP server talks to it through `FIRECRAWL_API_URL`. Hermes's own web tools also use Firecrawl, and pointing them at the same local instance is a follow-up **[verify]** |
