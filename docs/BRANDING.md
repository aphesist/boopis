# boopis is the product; its engine is invisible

The owner's decision of 19 November 2026 (ADR-0031): the app is 100% boopis. Hermes stays the engine inside, bundled and unmodified (ADR-0023), but the person using the app never reads its name.

**Where "Hermes" may appear:**
- the repository: README credits, docs, code identifiers, licences and `NOTICE`;
- an item the user downloads from the Hermes plugin store, where the item's own name or publisher is Hermes's (the one in-app exception: components mark it with `data-store-item`, `apps/desktop/ui/src/core/engine-words.ts`).

**Guards** (each fails the build on a new mention):

| Guard | What it reads |
|---|---|
| `apps/desktop/ui/src/engine-words.test.ts` (vitest) | every UI source literal a person can read; the rendered-text check `engineWordsIn` (store items excepted) |
| `apps/desktop/src-tauri/src/engine_words.rs` (Rust test) | every host source literal outside logs, error detail and tests |
| `apps/desktop/src-tauri/src/cli/tests.rs` `no_command_names_the_engine` | `boopis --version`, `doctor`, `--help` |
| `apps/desktop/src-tauri/src/error.rs` tests | every error variant reaches the UI as a catalog sentence; no catalog sentence names the engine |
| `scripts/test-brand.sh` | the installers' output, the menu entry, the Arch package's description and install messages |

Both source guards hold a `PENDING` list: strings in the model sign-in flows (setup's models question, Settings > Models, the plan, the Claude subscription), which the sign-ins branch rewrites. Each entry must match the source exactly, so the list empties itself as those strings change.

## Errors

Raw engine errors never appear as they are. **One mapper**, `user_message` in `apps/desktop/src-tauri/src/error.rs`:
- every `HostError`, every error frame the host builds, the link-state event and every blocked setup step go through it;
- a code whose text is the engine's (`hx.engine.*`, `hx.setup.runtime_*`, `hx.setup.config_failed`, `hx.connectors.failed`, ...) always shows the catalog's `user` sentence; any other text that names the engine does too;
- the raw text goes to the log and to Settings, General, Diagnostics (the report's last section, "errors behind the messages shown").

The sentences live in `crates/hx-proto/errors.json` (`user`, synced to the plugin), so the host, the plugin and the UI share them. The engine's own JSON-RPC answers reach the UI byte for byte (the proxy never alters a frame), so `GatewayError.fromFrame` (`ui/src/host/gateway.ts`) applies the same catalog's `hx.engine.refused` sentence to an answer that carries no `hx.*` code of ours, and keeps the words for Diagnostics (`ui/src/host/errors.ts`).

Codes renamed so the code a person reads never names the engine: `hx.hermes.unavailable` → `hx.engine.unavailable`, `hx.hermes.incompatible` → `hx.engine.incompatible`, `hx.setup.hermes_missing` → `hx.setup.engine_missing`, `hx.bots.hermes_failed` → `hx.bots.engine_failed`. New: `hx.engine.refused`, and the runtime step's five codes (`hx.setup.runtime_missing`, `_manifest_invalid`, `_hash_mismatch`, `_corrupt`, `_unpack_failed`), which the host raised before the catalog listed them.

## Paths

The private engine home was `<app data>/hermes-home/`; a bot's folder (shown when a bot is made) lived in it. It is now `<app data>/engine/`, with the engine's own layout inside (`engine/profiles/<bot>`: the engine has no profile-root override, and it is never patched). `migrate::engine_home` moves an existing install once (see ADR-0031).

## Inventory

Counts: **UI** 79 literals in 21 files, plus the "Use my own Hermes" setting (8 literals; the module is removed); **host** 50 literals that reach the UI (setup, connectors, runtime, lifecycle, commands) and 5 in the command line; **plugin** 27 messages that reach the user or the model; **installers and packaging** 5. All fixed. Pending (the sign-ins branch's flows, listed in both guards): 7 host literals, 9 UI literals.

### UI (`apps/desktop/ui/src`)

| Where | The text | The replacement |
|---|---|---|
| `host/first-run.ts` intro | "It asks before it changes any Hermes setting." | "It asks before it changes any setting." |
| `host/first-run.ts` intro | "Setup gets Hermes, the agent that does the work, ready for boopis." | "Setup gets boopis's engine, the part that does the work, ready." |
| `host/first-run.ts` intro | "boopis comes with its own Hermes, the agent that does the work. Setup unpacks it into boopis's own folder, then sets it up with the boopis plugin. It never touches another Hermes on this computer." | "boopis comes with its own engine, the part that does the work. Setup unpacks it into boopis's own folder and sets it up. Nothing else on this computer is touched." |
| `host/first-run.ts` intro | "boopis uses the Hermes already on this computer. Setup installs the boopis plugin into its profile." | "boopis runs on the engine already installed on this computer, as you started it. Setup adds what boopis needs to it." |
| `host/first-run.ts` progress | "Checking the Hermes runtime", "Unpacking Hermes" | "Checking boopis's engine", "Unpacking boopis's engine" |
| `host/first-run.ts` missing engine | "Install Hermes by running this in a terminal. boopis never runs it for you." and the installer command | removed; the step says what to do, "Check again" stays |
| `host/first-run.ts` stopped step | the detail alone | the detail and its stable code, "(hx.setup.…)" |
| `host/hermes-source.ts` (removed) | "Use my own Hermes", "the Hermes boopis carries", "the Hermes on this computer", "This build carries no Hermes of its own…", "boopis runs the Hermes it carries, in a folder of its own…" | the setting is gone; `boopis --engine existing` / `BOOPIS_HERMES=existing`, in `docs/ENGINE.md` |
| `modules/shell/dialogs.ts` | Settings > General > Advanced mount; "Connectors are added to Hermes by the desktop app. This page has no Hermes to ask." | removed; "Connectors are added in the desktop app. This page cannot reach boopis's engine." |
| `host/notice.ts` | "boopis could not reach Hermes" | "boopis could not reach its engine" |
| `host/connect.ts` | "…this page has no host to reach Hermes through." | "…this page cannot reach boopis's engine." |
| `host/connectors.ts` | "Hermes connected and found N tools" | "Connected and found N tools" |
| `host/connectors.ts` | "Hermes could not connect: <reason>" | "It did not connect: <reason>" (a reason that names the engine becomes the catalog sentence) |
| `host/connectors.ts` | "Hermes has no MCP servers. Add one below." | "boopis has no connectors yet. Add one below." |
| `host/connectors.ts` | "Hermes could not be asked, so the list is not shown: …" | "boopis could not read the list, so it is not shown: …" |
| `host/connectors.ts` | "Hermes drops it from its configuration (and its sign-in tokens, if it had any)." | "boopis drops it from its connectors (and its sign-in tokens, if it had any)." |
| `host/connectors-notice.ts` | "Hermes restarted.", "Hermes was not restarted." | "boopis restarted to read the key.", "boopis did not restart. The key is saved; restart boopis to use it." |
| `host/forms.ts` question | "Hermes has a question" | "A question for you" |
| `host/forms.ts` secret | "Hermes needs <VAR>", "Hermes needs a value to continue.", "Hermes saves it in this profile's `.env`.", "Send to Hermes" | "boopis needs <VAR>", "boopis needs a value to continue.", "boopis saves it in this bot's own `.env` file.", "Send it" |
| `host/forms.ts` sudo | "Hermes needs your sudo password", "Hermes did not say which command this is for…", "Hermes uses it to run the command…", "Send to Hermes" | "boopis needs your sudo password", "The request did not say which command this is for…", "boopis uses it to run the command…", "Send it" |
| `host/forms.ts` vault | "Hermes wants to sign into a site…", "Hermes reached a sign-in page…", "It goes to Hermes's vault…", "Hermes types it into the page." | "boopis wants to sign into a site…", "boopis reached a sign-in page…", "It goes to boopis's vault…", "boopis types it into the page." |
| `host/forms.ts` receipt | "Sent to Hermes", "Sending to Hermes" | "Sent", "Sending" |
| `host/forms.ts` sign-in card | "Hermes signs in for you: it opens <host>… boopis never sees them." | "boopis signs in for you: it opens <host>… where nobody reads them." |
| `host/live/details.ts` | "The boopis plugin is not loaded in this Hermes…", "Not available on this Hermes: …", "This Hermes has no session.branch…", "This Hermes has no session.compress…", "This Hermes cannot complete file names…" | "boopis's own part is not loaded in its engine…", "Not available in this version of boopis's engine: …", "…cannot fork a session.", "…cannot compact on request…", "…cannot complete file names." |
| `host/live/bots.ts` | "Hermes has no way to run a routine on demand from here yet." | "A routine cannot be run on demand from here yet." |
| `host/live/bots.ts` | "This Hermes has no profile methods, so teammates cannot be listed.", "The teammates could not be read from Hermes: …" | "This version of boopis's engine cannot list bots.", "The bots could not be read: …" |
| `host/live/bots.ts` | "Hermes did not describe this profile: …", "Hermes said: …" | "boopis could not read this bot's details: …", "The schedule could not be read: …" |
| `host/live/bots.ts` new bot | "…Hermes names a profile with lower case letters…", "No model provider is configured in Hermes yet…" | "…a bot's folder is named with lower case letters…", "No model provider is set up yet…" |
| `host/live/bots.ts` | "Hermes asks you to confirm this model.", "Hermes did not save X. The rest was saved." | "Confirm this model before it is saved.", "X could not be saved. The rest was saved." |
| `host/live/map-details.ts` | "Hermes has not reported this session's context window yet.", runtime "Hermes 0.23.2" | "This session's context window is not known yet.", "boopis engine 0.23.2" |
| `host/replay.ts` | "… not available on this Hermes backend" | "… is not available in this recording" |
| `modules/bots/new-bot.ts` | "This makes a Hermes profile for jabuti, a folder of its own." | "This makes jabuti a folder of its own." |
| `modules/bots/new-bot.ts` | "From the providers Hermes has keys for.", "Hermes did not make it: …" | "From the providers boopis has keys for.", "It was not made: …" |
| `modules/bots/settings-live.ts` | "Hermes keeps it as the profile's description; other teammates read it…" | "Kept as the bot's description; other bots read it…" |
| `modules/bots/settings-live.ts` | "Reading SOUL.md from Hermes…", "Hermes has not sent it yet." | "Reading SOUL.md…", "It has not been read yet." |
| `modules/bots/settings-live.ts` | "The model Hermes runs this profile on.", "Hermes has no model pinned for this profile." | "The model jabuti runs on.", "No model is pinned for this bot." |
| `modules/bots/settings-live.ts` | "Hermes did not answer.", "Hermes did not pause it: …" | "boopis could not read its schedule.", "It was not paused: …" |
| `modules/bots/settings-live.ts` | "…a job in this profile's own cron store.", "Hermes's own lists for this profile. Change them with `hermes -p X tools`…" | "…a job in this bot's own schedule.", "The tools and skills this bot has. boopis shows them here; changing them is not offered here yet." |
| `modules/bots/settings-live.ts` | "Save to Hermes", "These are the files Hermes keeps for X.", "Everything in its Hermes profile…", "Hermes did not delete it: …" | "Save changes", "These are the files boopis keeps for X.", "Everything in its folder…", "It was not deleted: …" |
| `modules/bots/outside.ts` | "Made outside boopis, for example with the hermes command." | "Made outside boopis, for example on the command line." |
| `modules/bots/room.ts` | "…not connected to Hermes yet." | "…not connected to boopis yet." |
| `modules/cards/parts.ts` | card origin "Hermes" | "Session" |
| `modules/session/right.ts` | "No MCP servers are configured in Hermes." | "No connectors are set up yet." |
| `data/mods-model.ts` | "…the slash commands of Hermes list it" | "…the slash commands list it" |
| `data/mock-data.ts` | "hermes-agent v0.23.2 (pinned)" | "boopis engine v0.23.2 (pinned)" |
| `host/gateway.ts` | the engine's raw JSON-RPC error message | the `hx.engine.refused` sentence; the words go to Diagnostics |
| `host/renderer.ts` Diagnostics | — | a last section: the engine's own words behind the messages shown |
| Pending: `host/models-tab.ts`, `host/free-tier.ts`, `host/plan-view.ts` | "…through Hermes's official plugin…", "Installed in Hermes", "Hermes says it lifts…", "Hermes reports no usage figures…", "Hermes is not connected, so the plan cannot be read." | the sign-ins branch (`w12/codex-gemini`) |

### Host (`apps/desktop/src-tauri/src`), text that reaches the UI

| Where | The text | The replacement |
|---|---|---|
| `setup/mod.rs` check | "the bundled Hermes has not been unpacked yet", "Hermes is not installed" | "boopis's engine has not been unpacked yet", "no engine was found on this computer" |
| `setup/mod.rs` step titles | "Hermes runtime", "Hermes", "Hermes settings" | "boopis engine", "Engine", "Settings boopis needs" |
| `setup/mod.rs` engine step | "Hermes 0.23.2", "Hermes is not installed. Run this in a terminal, then choose Check again: <installer>" | "version 0.23.2", "No engine was found on this computer. Install it as the boopis docs describe, then choose Check again; or start boopis without --engine existing to use the engine it carries." |
| `setup/mod.rs` runtime step | "Hermes 0.23.2 is unpacked", "unpacked Hermes 0.23.2 (Python 3.x) into the app's own folder; it never touches another Hermes" | "version 0.23.2, unpacked", "unpacked version 0.23.2 into boopis's own folder; nothing else on this computer is touched" |
| `setup/mod.rs` consent | "Change three Hermes settings?", "These settings are written with `hermes config set`; nothing else is touched.", "N settings changed through Hermes" | "Change three settings boopis needs?", "Only these three settings are written; nothing else is touched.", "N settings changed" |
| `setup/mod.rs` declined | "…behind Hermes's tool search… or use a dedicated Hermes profile for boopis." | "…behind tool search… Choose Review again to change your mind." |
| `setup/mod.rs` receipt | "Hermes runs with the plugin", "You declined the Hermes settings…", "Windows: API keys… cannot reach Hermes yet…" | "boopis is ready", "You declined the settings boopis needs…", "…cannot reach boopis's engine yet…" |
| `setup/mod.rs` blocked steps | the error's own text | `user_message`: the catalog sentence when the text is the engine's |
| `connectors/engine.rs` | "…Installing the key restarts Hermes, which would end it…", "Hermes could not say whether a turn is running…" | "…Installing the key needs a restart, which would end it…", "boopis could not tell whether a turn is running…" |
| `connectors/engine.rs` steps | "Added to Hermes" / "mcp_servers.x in Hermes's configuration, through Hermes", "…Hermes reads them by reference" | "Added" / "as x, with boopis's connectors", "…boopis reads them from there when the connector starts" |
| `connectors/engine.rs` steps | "Hermes restarted", "Hermes restart" | "Restarted", "Restart" |
| `connectors/engine.rs` notes | "Hermes could not be restarted…", "…Hermes reads it at its next start…", "…until Hermes reloads MCP, which resets the prompt cache." | "boopis could not restart, so the key is not read yet. Restart boopis, then test the connector.", "…It is read at the next restart…", "…sessions you start now see the change." |
| `connectors/engine.rs` restart notice | "Hermes restarted to read the key.", "Hermes was not restarted (<why>)…" | "Restarted to read the key.", "Not restarted. The key is saved; restart boopis to use it." (why: Diagnostics) |
| `connectors/engine.rs` sign-in | "Hermes's own token store", "There is no Hermes to run this sign-in with." | "boopis's own token store", "boopis's engine is not available to run this sign-in." |
| `connectors/plan.rs` | "OAuth in your browser, run by Hermes. Hermes keeps the tokens in its own store" | "OAuth in your browser. boopis keeps the tokens in its own store and never shows them" |
| `connectors/plan.rs` | "boopis restarts Hermes to load the key.", "…could not ask Hermes whether…", "Restart Hermes", "…boopis restarts Hermes the moment…" | "boopis restarts to load the key.", "…could not tell whether…", "Restart", "…boopis restarts the moment…" |
| `connectors/plan.rs` | "Adds it to Hermes's MCP servers through Hermes…", "How it appears in Hermes and in tool names." | "Adds it to boopis's connectors…", "How it appears in Connectors and in tool names." |
| `connectors/validate.rs` | "…use Hermes's own `hermes config set`" | dropped |
| `hermes/lifecycle.rs` | "Hermes has live work, so it was not restarted" | "a turn is still running, so boopis did not restart" |
| `commands.rs` | `hermes_source_get` / `hermes_source_set` ("Use my own Hermes") | `engine_source_get` (read-only) |
| `error.rs`, `gateway/frame.rs`, `gateway/actor.rs` | every message the engine wrote | the catalog sentence, raw text to Diagnostics |
| Pending: `setup/providers.rs` | the free tier's and the Claude subscription's texts | the sign-ins branch |

### Command line (`cli.rs`)

| Where | The text | The replacement |
|---|---|---|
| `--version` | "hermes     0.23.2, bundled" | "engine     0.23.2, bundled" |
| `doctor` runtime | "hermes  0.23.2, bundled (python …)", "…because your choice (BOOPIS_HERMES or the setting)" | "engine  0.23.2, bundled (python …)", "…because you chose it (--engine existing)" |
| `doctor` folders | "hermes home" | "engine home" |
| `doctor` broken runtime | the raw reason | the catalog sentence when the reason names the engine |

### Plugin (`plugins/boopis`), messages to the user or the model

| Where | The text | The replacement |
|---|---|---|
| `prompt.py` (the model) | "Hermes tools that only read: …" | "Tools that only read: …" |
| `policy/governed.py` (block reason) | "…and read-only Hermes tools are available." | "…and read-only tools are available." |
| `tools/schemas.json` (the model) | "a Hermes provider such as anthropic", "The Hermes provider the key is for" | "a provider such as anthropic", "The provider the key is for" |
| `exec/calls.py` | "…Hermes's language-server integration…" | "…the language-server integration…" |
| `forms/effects.py` | "hermes refused <key>", "Hermes has no provider called …", "could not write Hermes's configuration", "when the Hermes gateway next starts" | "the configuration refused <key>", "boopis has no provider called …", "could not write the configuration", "after boopis next restarts" |
| `governance/engine.py` | "Hermes routes delegated children by delegation.backend…", "Hermes refused to start the worker: …" | "Delegated work is routed by delegation.backend…", "the worker did not start: …" |
| `governance/ladder.py` | "…a `providers:` entry in Hermes's config…", "…which Hermes has no configuration for" | "…a `providers:` entry in the configuration…", "…which is not configured" |
| `bots/service.py` | "hermes could not delete X", "hermes could not rename X to Y" | "could not delete X", "could not rename X to Y" |
| `mods/install.py` | "the Hermes plugin generated from this source, and `hermes plugins enable`…" | "the plugin generated from this source, and enabling it…" |
| `compat/*.py` (inventory reasons) | "no Hermes hook carries this event", "Hermes cannot remove an argument…", "…cannot block X on Hermes", "its Hermes surface…", "Hermes loads ./CLAUDE.md itself…", "Hermes reports the generated plugin disabled", "…have no Hermes surface", "owned by hermes import-agent" (×4) | "the engine has no hook for this event", "an argument cannot be removed…", "…cannot block X here", "what it maps to…", "the engine loads ./CLAUDE.md itself…", "the generated plugin is disabled", "…have nothing to map to", "owned by the engine's own importer" |
| `prompt.py` (development error) | "…Hermes allows N" | "…a plugin section may have N" |

Kept in the plugin, because the app never shows them: `plugin.yaml` (the engine's own plugin list reads it), `hostsecrets/source.py` (the engine's secret-source status), and the engine-mapping notes in `compat/data/hook_events.json` (the app shows only a connector's status from the inventory; the rendered-text check catches them if a screen ever draws them).

### Installers and packaging

| Where | The text | The replacement |
|---|---|---|
| `scripts/install.sh` menu entry | Keywords "coding;agent;hermes;ai;" | "coding;agent;ai;" |
| `packaging/arch/boopis.desktop` | Comment "A desktop coding harness on Hermes Agent", Keywords "…hermes…" | "A desktop app for AI coding agents", "coding;agent;ai;" |
| `packaging/arch/PKGBUILD` | pkgdesc "Desktop coding harness on Hermes Agent, built on the system WebKitGTK" | "A desktop app for AI coding agents, built on the system WebKitGTK" |
| `src-tauri/tauri.conf.json` (AppImage entry) | shortDescription "A desktop coding harness on Hermes Agent" | "A desktop app for AI coding agents" |

Kept: the engine's licence file in the Arch package (`hermes-agent-LICENSE`, a legal notice) and the runtime archive's file name (never shown).

Window titles ("boopis", "Quick check", "WebKit GPU information"), notifications and menus named the engine nowhere; there is no tray menu.
