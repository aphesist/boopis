# The store

Status: the design the store is built to (ADR-0038). It is the research report's sections 5.1 to 5.10, amended by the owner's decisions of 21 November 2026. Where this file and the report differ, this file wins. The contract it names is in `apps/shared/data/store.schema.json` (shapes), `store-sources.json` (sources), `store.fixtures.json` (realistic items), `crates/hx-proto/errors.json` (`hx.store.*`) and `docs/PROTOCOL.md` (sections 1a and 3, the methods). Three workstreams build against it: A (the host, Rust), B (the plugin, Python) and C (the UI, TypeScript).

The store is a browse, review and update layer over installers that already exist. It is not a new installer. It lists everything installable in one place, turns each install into one reviewable plan, and hands the install to the layer that already owns that kind of thing.

## 0. The owner's decisions that shape it

- "we also need to add a plugin/skill/connector store." and "hermes plugins should be added there too, and anything else really. github skills, anything installable. if we could centralize our things on a in-app marketplace with recommended/searchable stuff that would be super good" (21 November 2026).
- Everything installable is in the store: skills (any GitHub repository with `SKILL.md` files included), connectors (MCP servers, `.mcpb` bundles included), Claude Code plugins and marketplaces, mods, and engine plugins (Python ones included).
- Every source is searched by default, in one place. Each item shows its tier in plain words: "Recommended by boopis", "Verified by its source", "Not reviewed". An item nobody reviewed carries the stronger warning on its review card.
- "Recommended" is the front page, from boopis's own list: only items checked against their source, with no invented ratings or install counts.
- The store is its own full view, reachable from the command palette, the Connectors tab ("Browse the store") and the session details panel. It is composed from existing kit patterns for the owner's review; it adds no component set.
- Engine plugins run in every session, governed ones included, outside `hx-sandbox`, and `policy.check` does not see them. The review card says exactly that. Governed projects get a per-project switch, "no engine plugins and no plugin hooks", on by default for governed projects.
- Kept from the report's defaults: pinned or refused; `dangerous` scan verdicts are blocked; hold to approve for anything that runs code; "not known" for undeclared egress; no automatic code updates (updates are diffed, with rollback); per-bot installs with per-project trust; no project-scope skill files in v1; the boopis index is compiled in and signing comes later; installs take effect in the next session only.
- The governed connector gap is fixed for store installs and for the existing connector install path (5.5 step 7).
- In the UI the engine's plugins are never called "Hermes" (ADR-0031). They are "plugins", from "the engine's store". The engine's name may appear only inside an item's own content, marked `data-store-item`.

## 5.1 Principles

1. **Reuse, do not duplicate.** The store never implements MCP configuration, hook handling, skill registration or sandboxing. It calls the layer that does.
2. **One plan per install.** Kind, source, publisher, pinned reference, components, code that runs, hosts, secrets, files written, scope, consent items, warnings, and one hash (`InstallPlan`). The install names the hash; the layer that owns the install rebuilds the plan and refuses with `hx.store.plan_changed` when it differs.
3. **Pinned or refused.** A 40-hex commit, an archive sha256, a tree sha256 (a local folder), an OCI digest, an MCP bundle's `fileSha256`, or an exact registry version. A branch, a tag and "latest" are not pins. An item without a pin is listed, marked, and refused with `hx.store.unpinned`.
4. **Next session only.** An install never changes a running session (invariant 4). The card says how many sessions have a turn running; they keep what they started with.
5. **Fail closed, and say unknown.** Unknown egress, unknown tools, an unreachable source, an unscanned item: each is shown as unknown, never as none or safe (invariants 5 and 6).
6. **The host stages and verifies; the owner of the kind installs.** See 5.9.

## 5.2 Sources and item types

Five item kinds: **skill**, **connector** (an MCP server), **plugin** (a Claude Code plugin; it may hold skills, hooks, MCP servers and agents), **mod** (a plugin whose hooks name `modules`) and **engine-plugin** (Python that runs inside the engine; this reverses the report's decision 4). A plugin's contents appear as components on its page.

The built-in sources are `apps/shared/data/store-sources.json`, with their labels in boopis's words:

| Source id | Label | Items | Fetch | Default tier | On by default |
|---|---|---|---|---|---|
| `boopis` | Recommended by boopis | skills, connectors, plugins, mods | compiled in (`apps/shared/data/*.json`); a signed hosted index comes later | recommended | yes |
| `engine-plugins` | From the engine's store | engine plugins (and Agent Plugin packages) | the engine's catalogue, every tier, through the gateway (`plugins.catalog.lookup`, `plugins.manage inspect`) | not reviewed; its official and verified entries show "Verified by its source" | yes |
| `skills-hub` | Skills from the engine's hub | skills | the engine's skills hub through `skills.manage browse`, `search`, `inspect` | not reviewed; its trusted repositories show "Verified by its source" | yes |
| `anthropic` | Anthropic's plugins and skills | plugins, skills | git: `claude-plugins-official`'s `marketplace.json` and `anthropics/skills`, pinned at a commit the host resolves | verified for Anthropic's own, not reviewed for third-party entries | yes (terms checked, see below) |
| `mcp-registry` | The MCP Registry | connectors | the registry's `/v0.1/servers`, an hourly incremental sync into the cache | not reviewed | yes |
| `github` | GitHub | skills, plugins, mods, connectors | cached curated lists, "add from a GitHub URL", and live search when signed in | not reviewed | yes |
| `marketplace-url` | Added by you | any | a marketplace address or git repository the user adds | not reviewed | yes (empty until used) |
| `local` | From your computer | any | a folder or file the user picks | not reviewed | yes (empty until used) |

A user-added source is a `StoreSource` with `user_added: true` and an id `added-<8 hex>`; the user can remove it. A built-in one can be switched off, never removed. The switches are in the store itself, next to the search: no hidden Advanced section.

**Tiers.** The tier is derived, not claimed. Only boopis's own list produces `recommended`, and only for an item a person at boopis checked against its publisher's sources (the `verified` date is that check). A source's own mark (the engine's official and verified entries, its trusted skill repositories, Anthropic's marketplace) produces `verified`, shown as "Verified by its source", with the source's own word in `provenance.source_tier`; boopis does not repeat it as its own endorsement. Everything else is `not-reviewed`.

**Anthropic's catalogues (the owner's decision 7): the terms were checked on 21 November 2026**, with the owner's go-ahead (findings: `anthropic-terms/findings.md` of that session). Both repositories are Apache 2.0: `claude-plugins-official` at its root, `anthropics/skills` per skill (each skill has its own `LICENSE.txt`; the repository has no root licence file). Anthropic's Software Directory Policy governs developers who submit software to its directories; it does not address or restrict an app that reads the public repositories. So `anthropic` is on by default (`default_on: true`, `terms: "checked"`). Trademark: Apache 2.0 section 6 grants none, so the source is named only to say where items come from ("Anthropic's plugins and skills"), never to imply that Anthropic endorses boopis or an item.

**Tiers inside it.** Anthropic's own plugins (the `plugins/` paths of `claude-plugins-official`, and any repository of the `anthropics` account) and `anthropics/skills` are "Verified by its source". The third-party entries of `claude-plugins-official` (`external_plugins/`, and git-subdir or url sources outside Anthropic's repositories, and command sources) are "Not reviewed": its README says Anthropic "cannot verify that they will work as intended or that they won't change", and says the third-party part of the file is being phased out, so that part will shrink. **Licence**: an item shows the licence its own entry states; Anthropic's own `plugins/` entries take the repository's root licence (Apache-2.0); everything else is `not stated` until the item is staged and its own licence file is read.

**GitHub, and its limits.** Unauthenticated GitHub API limits are low (60 requests an hour per address). boopis has no GitHub sign-in today. So v1 does this: (1) **cached curated lists**: the boopis index carries the GitHub skill and plugin repositories boopis knows, already resolved to a commit, searched locally; (2) **"add from a GitHub URL"**: the user pastes `github.com/owner/repo` (optionally a path or a ref), the host resolves the ref to a commit (one or two API calls, or `git ls-remote` against the HTTPS remote when the API is limited), reads `SKILL.md` files, `.claude-plugin/plugin.json` or `marketplace.json`, and creates an item that is pinned or refused. (3) **live search** (repository and code search for `SKILL.md`, `.claude-plugin/marketplace.json`) turns on only when boopis has a GitHub sign-in: it then uses that token (kept in the keychain like every credential; the webview never sees it) and the 5,000 requests an hour that comes with it. Until then the GitHub source says so in its `note`, and a rate-limited call fails with `hx.store.rate_limited` and `retry_after_s`, never silently. Building the sign-in is not in v1.

## 5.3 Catalogue and search

- **The host owns the catalogue.** A `store` module in the Tauri host (`src-tauri/src/store/`) fetches over the same `ureq` and rustls stack as the ChatGPT sign-in, with the connector validator's URL rules (https only, no credentials in a URL), size and time caps, and redirect allowlists like the engine's own catalogue loader. It normalises every source to a `StoreItem` and caches to `<app data>/store/` with an ETag or `updated_since`. The webview never fetches (CSP `connect-src ipc:`): browse, search and detail are host commands.
- **Engine-backed sources go through the engine.** The host never reads the engine's files. For `engine-plugins` and `skills-hub` it asks the engine over the gateway (`plugins.catalog.lookup`, `plugins.manage` actions `list`, `inspect`; `skills.manage` actions `list`, `search`, `browse`, `inspect`) and normalises the answers into the cache. When the engine is not running those sources serve their cached copy and say how old it is.
- **Search is local.** Name, summary, tags, publisher, kind, tier and source filters over the cached, normalised index (a few thousand items fit in memory). No query leaves the machine. The host returns pages (`StoreBrowse`); the UI never holds the whole catalogue.
- **Reading is visible and honest.** A source a read reaches (`refreshable`: not boopis's built-in list, not GitHub, not the two empty placeholders) is due a read (`stale`) when it is on and was never read, failed last time, or is older than its period. The store reads the due sources each time it opens, and every one on "Read the sources again", one at a time (`store_refresh(source)`); each row says it is waiting, being read, then "n items. Read just now." or the host's plain reason (`store/reasons.rs`): could not reach the named host (never the engine's address), the engine is not running yet (the hub is read through it), a rate limit and when to try again, a proxy or sign-in page in place of a list, a list too large, or boopis's own failure. Raw words go to Diagnostics. Browse's "This list is out of date" names the source and its reason, or how many were not read yet, with the button to read again. `tests/live_store.rs` reads every source live through this code (`live-store.yml`, Linux and Windows).
- **Order.** Relevance first within a search; then the tier; then an item's place in boopis's own list, which is ordered by a cited popularity signal (docs/CONNECTORS.md, "The order"), so with no query boopis's list leads, most popular first; then the title. The front page shows up to 24 of boopis's items in that order.
- **Stale while offline.** A refresh failure keeps the last good cache and sets `stale` and `offline`; the UI shows the cache with its age. A command that needs the network and has no cache to fall back on fails with `hx.store.offline`.
- **Kill list.** Merged from the engine's removed list (read through the engine), the MCP Registry's `deleted` status (the entry is dropped; `deprecated` is flagged), and a boopis list. An item on it has `removed`; it cannot be installed (`hx.store.removed`); an installed one is flagged with the reason and a one-click removal, and is switched off at the next session. The host pushes the merged list to the plugin (`plugin.boopis.store.removed.set`) so the plugin can do that.
- **Caps (defaults, held as data in `config::Limits`).** A catalogue response 16 MiB; an archive 64 MiB; at most 10,000 entries and depth 32 in a tree; one file 16 MiB; a connect timeout 10 s and a whole-request timeout 60 s; refresh every 6 hours, the registry hourly; staging expires after 1 hour. Over a cap: `hx.store.too_large`.
- **Ids.** `source:name`, where the name is the source's own (a registry's reverse-DNS name, `owner/repo` or `owner/repo/path` for GitHub, a marketplace's plugin name). Two sources listing the same thing are two items; the UI may group them by publisher and name, never merge their trust.

## 5.4 The detail page

Everything the user needs to decide, from data and never from the item's own marketing (`StoreDetail`, then the plan): what it adds (counts by component, from the catalogue's summary; exact after staging), what runs (every hook command, server command or package, script and Python file, with where it runs), where it reaches (declared hosts, labelled "declared by the publisher, not enforced", "verified by boopis on a date", "this computer only" or "not known"), what it needs (keys, other plugins), provenance (source, publisher, how the namespace was proved, pinned reference, tree hash, scan verdict, last updated, licence), cost (tools and context estimate; the engine's tool search is off in boopis sessions, ADR-0014, so every tool is eager), what governed mode does with it, the scopes it can take, and any update or kill-list state. A licence is always shown; `not stated` is shown as it is.

## 5.5 The install flow and the permission review

1. **Open an item.** Never from a link or a model's request directly: a link or a request opens the item's page and nothing else.
2. **Stage (host, `store_stage`).** Fetch into a staging folder under the store's cache: the caps of 5.3, no path outside the root, no link that leaves the tree, no device node, FIFO or setuid, setgid or sticky bit (the rules of the runtime unpack in `runtime.rs`). Check the pin: the commit, the archive sha256, the bundle's `fileSha256`, the image digest. A mismatch deletes the staging folder and fails with `hx.store.digest_mismatch`. Compute `tree_sha256` with the compat trust store's function. A remote connector has nothing to stage; its stage holds the listing only. Hub skills and engine plugins are fetched by the engine itself (5.9): their stage is the engine's `inspect`, and the host cross-checks the commit the engine read against the catalogue's pin.
3. **Analyse without running anything (`store_plan`).** Skills: frontmatter checked against the agentskills format, the file list, scripts present. Plugins and mods: the plugin's component scan (`plugin.boopis.store.prepare`: components, hook commands with script hashes, MCP entries, agents, and for mods `hx mods.analyze`). Connectors: the existing `connectors::plan`. Engine plugins: the engine's `plugins.manage inspect` (which halves it ships, its declared capabilities, its install scan) plus the plugin's governed check. The result is one `InstallPlan`. A scan verdict of `dangerous` is never installable and has no override (`hx.store.dangerous_verdict`); `caution` shows its findings on the card.
4. **Review card.** A `connector`-style form card (see `docs/FORMS.md`): the plan's sections, the scope choice (this bot, or this bot with trust for this project), the consent items, the plan hash, and a hold to approve for one second. A card that has a consent item with `runs_code` cannot be approved by a click. An item whose tier is `not-reviewed` carries the stronger warning (`unreviewed`, level `strong`): nobody reviewed it, so read what it runs first.
5. **Install, by the owning layer** (`store_install`), in the order that leaves nothing behind on failure: files first into a staging location, trust and lock records, configuration last. The host passes the plan hash; the layer rebuilds its plan from the staged tree and refuses on a difference (`hx.store.plan_changed`). A failure after the plan was accepted removes what was written and fails with `hx.store.install_failed` and the step.
6. **Activation.** New sessions get it. The card shows "N sessions have a turn running; they keep what they started with" (from the engine, as the connector flow asks). An install that must restart the engine uses the connector flow's never-silent rule: `restart` is `now` or `when-idle`, and without a choice the call fails with `hx.connectors.restart_choice`.
7. **Governed follow-through (the owner's decision 8).** Nothing writes `plugins.entries.boopis.mcp_allowlist`, so a connector is unreachable from governed `exec` (`ctx.call_mcp` is denied by default). The fix covers both paths: the existing connector install in `connectors/engine.rs` and a store install of a connector add the server's name to that list through the engine's own configuration (the same route as the secret wiring: `hermes config set` through the host's CLI wrapper), and removal takes it out; the host never writes the engine's files. The card says: "In governed mode this server is reachable only through exec, and each call is decided by your permissions." A test installs a stdio test server and asserts that governed `exec` can call it, on a real engine (`tests/connectors_live.rs` pattern). Whether an MCP call counts as a network tool under ADR-0005 is checked in that test.

## 5.6 Scope

- **A bot is the install scope, and for code the only one.** A bot is an engine profile; the words in the UI are "bot", never "profile". Connectors already are per bot; a plugin or mod install lives under the bot's folder (`<bot home>/boopis/compat/plugins/<slug>/`); skills and engine plugins live in the bot's engine folders.
- **Per-project trust, not per-project install,** for the parts of a plugin that run code: install once per bot and approve per project through the existing `trust.json`, keyed by project and the content hash (a changed hook asks again). The plan's scope is `bot` or `bot-project` (with the project).
- **No project-scope skill files in v1.** That would write the workspace, which invariant 2 reserves to `ship`. The detail page says where a skill is and offers "copy it into the project yourself".

## 5.7 Updates, rollback and uninstall

- **Update check** (`store_update_check`) is a catalogue diff: the pinned reference changed, the version changed, the item was removed, or it lost its pin. Nothing installs by itself. An `UpdateDiff` names every added, removed and changed component, and `new_hosts`, `new_secrets` and `new_code`. `widened` is true when any of those is non-empty: the update then needs the whole review card again, not a shortcut.
- **Update** (`store_update`) is the install flow on the new pin: stage, plan, review, hold, install. The previous version and its lock entry are kept one step back.
- **On and off** (`store_set_enabled`) switches an installed item for the bot, effective in the next session. The layer that owns the item does it: a connector through the connector flow's switch (and the host's record follows); a plugin, mod, skill the plugin installed or engine plugin through `plugin.boopis.store.set_enabled`, which asks the engine's own `plugins enable` or `plugins disable` and updates the plugin's record, so the engine's flag stays the single truth. A refusal changes nothing, a taken-down item cannot be switched on, and a skill from the engine's hub has no switch of its own (remove it).
- **Rollback** (`store_rollback`) swaps back to the kept version atomically and re-checks trust: a content hash that matches an earlier approval stays approved. The engine keeps no earlier copy of an engine plugin, so rolling one back re-installs its previous pin through the same review (the plugin's record holds it).
- **Uninstall** (`store_uninstall`), by layer: a connector through the connector flow's remove (with its keys question: the keys stay unless the user says delete); a plugin or mod through the plugin (the install folder, the lock, the trust records); an engine plugin through the engine's remove, then the plugin's record; a hub skill through the engine's own uninstall, which is not a gateway action, so the host runs the engine CLI as the connector flow does for `mcp remove`.
- **A kill-listed installed item** shows a banner and is switched off from the next session.

## 5.8 Governed mode

Installing in a governed project is allowed: it only affects later sessions. The card states what a governed session will and will not do with the item.

| Item | Allowed in governed mode? | How |
|---|---|---|
| Skill | Yes | In the session's `skills` list at create; scripts are reachable only through `exec` and `ship` because `terminal` is removed |
| Connector | Yes, through `exec` only | `mcp.<server>.<tool>` under `policy.check`; needs `mcp_allowlist` (5.5 step 7); MCP tools do not join `toolsets: ["boopis"]` |
| Claude plugin, no hooks | Yes | Skills and agents as above |
| Claude plugin with hooks | Yes, if trusted, and unless the project's switch is on | Hooks run unsandboxed after content-hash trust (ADR-0013); the card says so |
| Mod | Yes | Observes, can only tighten; model changes refused; workspace writes refused |
| Engine plugin | **Yes. The card says it runs in every session, outside the sandbox, and permission rules do not see it. A governed project has a per-project off switch, on by default.** | Python inside the engine, active through its hooks and middleware in every session of the bot, governed ones included; `hx-sandbox` cannot contain it and `policy.check` does not see it |

**The switch.** Per project, "no engine plugins and no plugin hooks" (`ProjectPolicy`). It is stored by the plugin next to the project's trust record and is read through `plugin.boopis.store.policy.get` and `.set`. Its default is on for a governed project and off for an ungoverned one; an explicit choice wins (`explicit`). Ungoverned projects allow engine plugins once approved. When it is on:
- the project's Claude plugin hooks are inert: the plugin treats their trust as not granted for that project (the compat trust gate already does that for an unapproved hook);
- an engine plugin cannot be loaded per project (the engine loads plugins per process), so the switch is enforced at the one place the plugin controls, session start: a governed session in that project whose bot has an enabled engine plugin is refused at its first prompt with `hx.store.governed_refused`, naming the plugins and the two ways out (switch the plugin off for the bot, or turn the project's switch off). Fail closed (invariant 6);
- installing an engine plugin while a governed project's switch is on is allowed (the plan's `governed.switch_blocks` says it will not run there), so a bot used in several projects can be set up once.

The owner can change this enforcement point; the data (the plan's `governed` note, `ProjectPolicy`) does not depend on it.

## 5.9 Layer ownership

| Concern | Owner | Why |
|---|---|---|
| Catalogue fetch, cache, search index, kill list, digest checks, staging bytes | **Host (Rust)** | the only layer with a network stack, the OS trust store, the keychain and CSP rules; works when the engine is down; the pattern of the sign-in and the runtime unpack |
| Plan and hash for connectors, MCP configuration, keys, OAuth, the governed allowlist | **Host and engine** (as today) | `connectors::plan` and the engine's `mcp.servers.*`; the host never writes the engine's files |
| Plan, trust, lock and component analysis for Claude plugins, mods, and skills that are not from the hub; the project switch; the kill-list effect; the store's record for plugin, mod and engine-plugin installs | **Plugin (Python)** `compat/`, `mods/`, `store/`, `policy/` | the trust store, scanner and ledger live there; `hx mods.analyze` is reachable there; one permission function |
| Hub skills and engine plugins: fetching, scanning, quarantine, lock, install | **Engine**, driven by the host through `skills.manage` and `plugins.manage` | one layer per mechanism; its scanner, quarantine, lock and consent already exist |
| The review card, browse, detail, installed and sources screens | **UI** | forms are one card family; the host and the plugin return data only |

The routes, by kind and source:

| Kind (source) | Plan | Install | Record of what is installed |
|---|---|---|---|
| connector (any) | host `connectors::plan` | host connector engine, `mcp.servers.add` | the engine's configuration; the host's store record |
| plugin, mod (any) | host stages; plugin `store.prepare` | plugin `store.confirm` | the plugin's lock and the store record |
| skill (`skills-hub`) | host, from the engine's `skills.manage inspect` | engine `skills.manage install` | the engine's lock; the host's store record |
| skill (any other source) | host stages; plugin `store.prepare` (kind `skill`) | plugin `store.confirm`, as a skill-only package registered as `<slug>:<skill>` | the plugin's lock and the store record |
| engine-plugin (any) | host, from `plugins.manage inspect`; plugin `store.prepare` (kind `engine-plugin`) for the governed policy | engine `plugins.manage install` with `ref` and `inspected_sha` (the commit `inspect` read); then plugin `store.confirm` | the engine's `.install-metadata.json`; the plugin's store record |

For an engine plugin the plugin installs nothing: `prepare` applies governed policy and returns the consent items and warnings, and `confirm` records the receipt after the engine reports the install. The engine refuses a different commit than the one `inspect` read, which is what pins it. The plugin's code stays engine-agnostic where it also runs in plain Hermes (the CLI case); the store is a host feature, so the plugin's store module may assume the host.

The installed list is the merge of two records, so no layer reads another's files: the plugin's (`plugin.boopis.store.list`: plugins, mods, plugin-installed skills, engine plugins) and the host's (connectors and hub skills, `<app data>/store/installed.json`).

## 5.10 How it reuses what exists

- **Connectors**: unchanged. The store adds sources that produce the same collection entry shape: a registry `server.json` maps to variants (each `remotes[]` entry a URL variant; each `packages[]` entry a command variant: `npx -y <id>@<version>`, `uvx <id>==<version>`, `docker run <image@digest>`; `fileSha256` for a bundle). A field the registry cannot fill (egress, tools) is "not known" and the review says so. Entries boopis did not curate carry no `verified` date.
- **Compat**: the marketplace reader and the trust store. The store implements the missing install steps of `docs/COMPAT.md` section 9 (resolve, pin, fetch, generated plugin, enable) instead of a second plugin system. The plugin refuses `command` sources, an `archive` without a sha256, and npm packages that would run install scripts.
- **Mods**: `mod.install.prepare` and `.confirm` stay the mod install; the store feeds `prepare` a staged folder in place of a typed path, and the hash lock is the same.
- **Forms**: the review is a card of the existing family. Keys are `credential` fields; their values go UI to host to keychain and never into a plan, a receipt or a log.
- **Sandbox**: only where the mods worker already uses it. Sandboxing a stdio connector is a later spike; the card never claims isolation the sandbox does not enforce.

## 6. The contract in one place

- **Shapes**: `store.schema.json`. Rust types in `src-tauri/src/store/types.rs`, TypeScript in `ui/src/data/types.ts` (the store section). The fixture file is validated against the schema by `ui/src/data/store-schema.test.ts` and round-tripped by the Rust types.
- **Plan hash**: sha256 of the plan's canonical JSON: keys sorted, no whitespace, UTF-8, `plan_hash` and `sessions_open` removed. The Rust test `the_fixture_plan_hashes_follow_the_documented_rule` is the reference; the plugin's `plugin_hash` follows the same rule over a `PluginPlan` without `plugin_hash` and gets a golden-vector test against the same fixture style.
- **Tree hash**: the compat trust store's `tree_hash`, computed by the host on the staged tree and recomputed by the plugin before it copies; they must agree (golden vectors).
- **Methods**: `docs/PROTOCOL.md` section 1a (host commands) and section 3 (plugin RPCs).
- **Errors**: `hx.store.*` in `errors.json`. A catalogue entry has a `user` sentence; the UI shows that and keeps the engine's raw words for Diagnostics (ADR-0031's mapper). Connector failures during a connector install keep their `hx.connectors.*` codes.
- **Data files**: `store-sources.json` is compiled into the host. The boopis list (`apps/shared/data/connectors.json` today; skills, plugins and mods join it as their own files, each against its own schema) is the recommended front page: an entry is added only after someone read it from its source.
- **The mock**: `ui/src/data/mock-store.ts` implements the UI's `StoreProvider` over the fixture items and rejects with the same codes, so the UI is built without the host.

## 7. What is not in v1

- Project-scope skill files (5.6).
- A boopis signing key and a hosted, signed index: the index is compiled in (a later phase; the owner creates the key, ADR-0023).
- Automatic code updates, and update-all.
- Ratings, install counts and reviews: shown only when a source supplies them, labelled with that source.
- Sandboxing local connectors with `hx-sandbox` (a later spike).
- A GitHub sign-in, and so live GitHub search (5.2).
- Installing from a deep link or a model's request without opening the item's page and the review card.
- Windows mods (the worker is not built there; `hx.mods.unavailable`), and the secret channel on Windows: the store degrades the same way and says so (`hx.store.kind_unsupported`).

## 8. Left open, and who decides

- Where the engine-plugin switch is enforced (5.8): the owner may prefer a different point than session start.

## 9. What the host's build found (workstream A, 21 November 2026)

Where the build read the real thing, and what it changed or settled:

- **The engine's catalogue is listed from its published JSON, not through the gateway.** The gateway has `plugins.catalog.lookup` (one entry by name) and no listing, and the engine's CLI prints a table, not data. The host reads the same file the engine's own loader reads (`hermes-agent.nousresearch.com/docs/api/plugin-catalog.json`, a 301 to `nousresearch.github.io`, both on the host list, 16 MiB cap, `ETag`), and uses the gateway for what it does have: `plugins.manage inspect` at stage (the commit it read must equal the catalogue's pin, else `hx.store.digest_mismatch`) and `plugins.manage install` with `ref` and `inspected_sha`. The catalogue's own `removed` list is the engine's part of the kill list.
- **The engine's skills hub gives no commit before it installs.** `skills.manage browse` rows are `{name, description, source, trust, identifier}` and `inspect` adds tags and a preview; the tree sha is computed at install. So hub skills are listed with no pin and `store_stage` refuses them with `hx.store.unpinned`; the item's page links its repository, and the same skill added from its GitHub address is pinned (the host resolves the commit). The install route through `skills.manage install` exists for a pinned hub item, which the hub does not produce today.
- **The pinned engine release has both CLI verbs the report flagged:** `hermes skills update [name]` and `hermes skills uninstall <name> --yes` (`hermes_cli/subcommands/skills.py`). Uninstall of a hub skill the store installed uses the second.
- **`server.json` fields** (schema 2025-12-11): `packages[].environmentVariables[]` and `remotes[].headers[]` are `{name, description, isRequired, isSecret, default, value, format}`; arguments are `packageArguments[]` and `runtimeArguments[]` (`positional` with `value` or `valueHint`, `named` with `name`); `fileSha256` is required for `mcpb`. A secret becomes a connector key; a fixed or default value becomes plain environment; a required value with neither is listed on the card as something boopis cannot ask for yet, never invented.
- **A hosted (remote) registry connector has no digest to pin.** Its pin is `{type: version, repo: "remote:<url>"}`, the exact version the registry lists, and its plan carries a standing caution that the publisher can change what it does. An image tag is not a digest: an `oci` package is pinned only by an `@sha256:` in its identifier; a `npm` or `pypi` package only by an exact version (no range, no `latest`).
- **A connector from boopis's own list is installed through its collection entry**, in the first way of running it that is pinned and needs no setting the store cannot ask for (Firecrawl: the package with a key). A variant that needs a setting (a URL, say) is installed from Settings, Connectors.
- **GitHub without its API.** A commit is read from the repository's smart-HTTP advertisement (`info/refs`), which `git ls-remote` reads and which is not subject to the API's 60-an-hour limit; the tree comes from `codeload.github.com` at that commit, and the tarball's own header must name the same commit. Live search is still not built. Git hosts other than GitHub are `hx.store.invalid_source` in v1.
- **An MCP bundle** (a registry `mcpb` package with its `fileSha256`, or a `.mcpb` file the user adds, pinned by the file's hash) is unpacked by the host's own zip reader (stored and deflate, no zip64, no encryption) into staging, checked for a manifest, and installed by copying the tree to `<app data>/store/bundles/<hash16>/` and adding a server that runs from there (`node`, `python` or a binary; `uv` is `kind_unsupported`). `${user_config.KEY}` becomes a key only when the manifest says `sensitive`.
- **Stage layout.** `staging/<id>/meta.json` (the item as it was when staged, its route, the plan's hash) and `staging/<id>/tree/` (the bytes; the plugin is given this folder). The plan and the install work from the snapshot, not the live cache.
- **Not done in v1:** rollback of a connector or an engine plugin (the host keeps no earlier copy; `hx.store.no_previous` names the pin to install again), an atomic connector update (the old server is removed, then the new one added, and the card says so), and a governed `exec` call in the live test (see `tests/connectors_live.rs`: it shows the engine reads the allowlist back as a list; the call itself needs a session with the fake model).

