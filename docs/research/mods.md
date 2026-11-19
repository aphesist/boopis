# Claude Code mods: what they are, from the official docs

Researched 2026-11-19 from code.claude.com/docs (pages listed at the end). The authoritative API is Claude Code's TypeScript declarations (`mods/types/claude-code.d.ts` in the anthropics/claude-code repository, plus the copy Claude Code writes into a mod's `.claude-plugin/types/`). That file could not be read here, so the types below come from the docs' prose and tables. The docs gate features in prose ("requires Claude Code v2.1.xxx"); there is no machine-readable capability list. Nothing describes a protocol for a third-party app to load mods: a host that runs them must implement the `$` API, the event chain and the element renderer itself.

## 1. Format, packaging, install
- **A mod is a plugin** that changes how Claude Code looks and behaves (`plugins/mods/overview`).
- Layout (`mods/reference#files`, `mods/create`):
  - `.claude-plugin/plugin.json`: the plugin manifest; mods add no required fields (only `name` is required).
  - `hooks/hooks.json`: `"modules": ["./register.js"]`. A plugin with a `modules` key is a mod. The same file may hold settings hooks under `"hooks"`.
  - The hooks module: an ES module exporting `register(on, options)`; `.js .mjs .cjs .jsx .ts .mts .cts .tsx` load directly, with no build step. `options` holds the manifest's `userConfig` values with defaults filled in.
  - Optional `types/index.d.ts` (manifest `types` key) declares `PluginState` for `$.state`. Optional `*.test.ts(x)` files run with `claude plugin test`.
- Manifest keys a mod can use: `name`, `version`, `description`, `author`, `types`, `userConfig`, `dependencies`, `commands`, `agents`, `skills`, `mcpServers`, `lspServers`, `outputStyles`, `experimental` (`themes`, `monitors`, `evals`), `hooks`.
- Install: marketplaces (`/plugin install name@marketplace`), `claude --plugin-dir ./dir` (hot reload on save), `CLAUDE_CODE_PLUGIN_DIRS`. Claude-written mods go to `~/.claude/dev-mods/<session-id>/<name>/`; Desktop colour mods can live under `~/.claude/skills/<name>/`.
- Trust: a mod runs with the user's permissions and is **not sandboxed**. The first run in an untrusted directory asks; installed `plugin@marketplace` targets are trusted. `claude plugin validate <dir>` prints `hooks:` and `calls:` lines.
- On by default from v2.1.287 (terminal) and v2.1.286 (Desktop). Built-in mods ship with Claude Code (`cc-plugin-diff`, `cc-plugin-agents-md`, `cc-plugin-sec-default`).

## 2. Surfaces
A mod draws through the `ui.render` event, filtered by a matcher such as `{ component: 'Pane' }`, returning an element tree (`$.ui.resolve(e)`) or calling `next(e)` to keep Claude Code's drawing.

| Surface | API | Where |
|---|---|---|
| Pane (`Pane`) | `$.ui.open({ id, title, focus, closeOnEscape, holdToasts, rows, columns })`, `$.ui.close({ id })`; props `title, isFocused, bodyColumns, placement ('dock' or 'inline'), scroll, view` | terminal, Desktop, VS Code |
| Band above the prompt (`AbovePrompt`, `AbovePromptList` from 2.1.323) | return a tree; one row per mod; props `hasSurvey, isCollapsed, isWorking, maxRows, bodyColumns, scroll, view` | terminal, Desktop |
| Transcript row (`Placed`) | `$.ui.place({ id })`; at most 500 per mod; gone on `/clear`, rewind, compaction; not kept on resume | terminal (2.1.314+) |
| Backdrop (`Backdrop`) | `$.theme.set({ backdrop: { scene }, overrideColorScheme })`, `$.theme.clear()` | Desktop and mobile (2.1.319+) |
| Toast | `$.ui.toast(text, { timeoutMs })`, 4 s default, at most 3 at a time | terminal; VS Code panel stack |
| Mod status line | `$.ui.status(text)`, stays until changed, prefixed with the mod's name | all |
| Transcript log line | `$.ui.log(text)`, dim, not read by the model | all |
| OS notification | `$.ui.notify(text, { title })` → `{ isSent, channel }` or `{ isSent: false, reason }` | terminal |
| Dialog | `$.ui.ask(question, options)` → the chosen label | all |
| Redraw Claude Code's own parts | `ui.render` on `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `CommandOutput`, `AskUserQuestion`, `Spinner`, `ToolProgress`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`: change props with `next({...e, props})`, replace with a tree, or pass. The permission prompt cannot be changed. | per site |
| Commands | `$.command.register({ name, description, argumentHint, immediate })`; handle `command.run` | all |
| Tools for the model | `$.tool.register({ name, description, inputSchema, isDeferred })`, named `mcp__<plugin>__<name>`; handle `tool.call` | all |
| Output styles | `outputStyles` key or `output-styles/<name>.md` | terminal |

**Elements** (`mods/reference#elements`): `Box` (flex layout, spacing, borders, `backgroundColor`, `position`), `Text` (`color`, `bold`/`weight`, `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`, `wrap`, `size`, `mono`, `tabular`), `Button` (`onPress`, `hotkey`, `plain`, `variant`, `role`, `action`), `Input` (`onSubmit`, `onInput`, `rows`, `placeholder`, `value`, `submitLabel`), `Select` (`options`, `onSelect`), `Markdown` (`text`), `Code` (`source`, `language`, `path`, `startLine`, `format`, `wrap`), `Link` (`href`, `label`), `Svg` (up to 131,072 chars; Desktop and VS Code), `Client` (a second JS file posting to the mod through `ui.message`; terminal and Desktop), `Raster` (up to 512×256 cells; terminal), `Image` (PNG or RGBA up to 2 MiB; terminal). No HTML element. Colours are theme keys or names such as `'red'`.

**Updates:** no push into a tree. Claude Code re-runs `ui.render` when a site's props or the width change, or after `ui.fault`; a mod asks with `$.ui.invalidate('ui.render')` (10/s, 30/s for the visible pane, band and hint line; excess coalesces). `$.state` (`atom`, `read`, `update`) redraws the sites that read it. `$.clock.every(ms, fn)`. Module variables reset on reload; `$.state` lasts the session; `$.store` is JSON on disk shared by all sessions (4 MiB). `$.ui.blit` repaints one `Raster`.

**Sizing:** a docked pane needs ≥144 columns if opened without a user action (≥110 after the user opened it once); `columns` at most 45% of the width; `rows` default a third. Tree limits: 100,000 characters drawn, 20,000 elements, depth 32, 10,000-character caps on `Code.language`/`path`, `Select` values and `Client.module`, 2,048 on `Link.href`.

**Surfaces per app:** the terminal draws everything; Desktop draws all but terminal-only elements; VS Code stacks panes, band, toasts and status above the prompt and ignores some props; `claude -p`, the Agent SDK and cloud sessions run hooks but draw nothing.

## 3. The hooks module
- `export function register(on, options)`; `on(eventName, matcher?, hook)` returns a registration with `.catch(handler)`. Matchers compare event fields (value, array or regex).
- Hook: `async ($, e, next) => …`. `e` is deeply frozen; pass a changed copy to `next`. `next.signal`, `next.origin` (`{ plugin, tier }`), `next.budget`, `next.to(e, tier)`; in `.catch`, `next.error` (`throw` or `timeout`) and `next.called`.
- `$` namespaces: `plugin, ui, theme, command, tool, agent, model, prompt, turn, session, config, settings, env, fs, store, state, clock, http, process, mcp, audio, telemetry`. `$.ui`: `resolve, invalidate, open, close, panes, place, focus, scroll, toast, notify, status, log, notice, ask, copy, selection, blit, view`.
- No Node.js APIs, no `setTimeout`, no direct network or files; standard web APIs only (`URL`, `TextEncoder`, `AbortController`, `crypto.subtle`). All I/O goes through `$`, and every `$` call is itself an event other mods can observe, rewrite or refuse. Imports: static, relative inside the plugin, plus the bare `claude-code` module for types and helpers.
- **`$` calls can skip Claude Code's permission rules, `PreToolUse` hooks and auto-mode classification** (`mods/admin`); the built-in guard `sec-default@builtin` blocks some of this under managed settings.
- Events: tools (`tool.call`, `tool.check` with `isReadOnly`, `agentId`, `ceiling`; `tool.describe`), prompts (`prompt.submit` → `{ drop }`, `prompt.fill`, `.suggest`, `.edit`, `.autocomplete`, `.compose`, `.section`, `.context`, `.attachment`, `.mention`, `skill.prompt`, `attribution.text`), commands and config (`command.run`, `command.describe`, `config.set`, `config.describe`, `settings.read`), turns (`turn.start`, `turn.step` as an async generator that can change the model, `turn.complete` with `isAborted`, `answer`, `usage`), session (`session.start`, `.end`, `.compact`, `.receive`, `.send`, `.append`, `.attach`, `.detach`, `.measure`), subagents (`agent.offer`, `agent.spawn`), interface (`ui.render`, `.resolve`, `.press`, `.input`, `.select`, `.focus`, `.scroll`, `.close`, `.message`, `.fault`), other mods (`plugin.register`, `engine.create`), telemetry, and settings hooks as `classic.<Event>`.
- Chain: middleware. Tiers run in order: built-in guard, `prependPlugins`, user mods (dependencies first), `appendPlugins`, built-ins. Returning without `next` answers the event; a hook that throws or times out before `next` is skipped unless `.catch` answers.
- Limits: 10 s per event (50 ms for `prompt.edit`), `.catch` 1 s, `$.process.run` 30 s default (10 min max), `$.http.fetch` 30 s / 4 MiB / 5 redirects, `$.fs` 4 MiB per file, `$.session.messages()` newest 4,096.
- Lifecycle: installed mods share one worker thread; loading runs `register`; `session.start` fires once per mod before the first prompt and after a reload. Three worker crashes unload every user mod.

## 4. Themes
- Terminal themes: `~/.claude/themes/<slug>.json` or a plugin's `themes/<slug>.json` (`experimental.themes`), chosen as `custom:<slug>`. Fields: `name`, `base` (`dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`), `overrides` (token → colour as `#rrggbb`, `#rgb`, `rgb()`, `ansi256(n)`, `ansi:<name>`). Tokens include `claude`, `text`, `inverseText`, `inactive`, `subtle`, `suggestion`, `permission`, `remember`, `success`, `error`, `warning`, `merged`, `promptBorder`, `planMode`, `autoAccept`, `bashBorder`, `ide`, `fastMode`, `effortUltra`, the `diff*` family, message backgrounds, `rate_limit_*`, shimmer pairs, subagent colours and the `rainbow_*` gradient.
- Desktop colours: `$.theme.set({ colors })` with `makeColors({ label, light: { gray: { anchors } }, dark })`. Documented anchors: `surface-0`, `text-primary`, `text-muted`; the rest is in Claude Code's built-in `plugin-authoring` skill, not on a public page. One mod's `$.theme.set` wins at a time.

## 5. Compatibility
- Version gates are prose only (for example `$.ui.place` 2.1.314, Desktop colours 2.1.324, `AbovePromptList` 2.1.323). No capability handshake, no runtime feature query, no `engines` field.
- Degradation: `e.surface` is `terminal`, `desktop` or `vscode`, and mods branch on it. An unsupported prop is ignored; a tree that fails validation is skipped and the site falls back to Claude Code's drawing. `$.ui.open`, `$.ui.place` and `$.theme.set` return `isPlaced`/`isDrawn` plus a `reason`.
- Stop switches: `disableAllHooks`, `--safe-mode`, `--bare`, `allowManagedModsOnly`, `allowManagedHooksOnly`, `disableSideloadFlags`, `prependPlugins`, `appendPlugins`.

## 6. The `statusLine` setting (not a mod surface)
`{ "statusLine": { "type": "command", "command": "…", "padding": 2, "refreshInterval": 5, "hideVimModeIndicator": false } }`. The command gets a JSON object on stdin (`cwd`, `session_id`, `session_name`, `model{id, display_name}`, `workspace{…}`, `output_style`, `cost{…}`, `context_window{…}`, `prompt_cache{…}`, `effort`, `thinking`, `rate_limits{five_hour, seven_day, spend_limit}`, `vim`, `agent`, `pr`, `worktree`) and prints rows, with ANSI colours and OSC 8 links. Triggers: session start, a new assistant message, compaction, mode changes, the timer; debounced 300 ms.

## Not documented or not verified here
The exact TypeScript types and full `$.session`/`$.agent` method lists; the Desktop colour token schema beyond three anchors; the manifest and marketplace field tables; test API details; any embedding protocol; the licence of `claude-code.d.ts` (**[verify]** before copying anything from it).

## Sources
code.claude.com/docs/en/plugins/mods/{overview, create, reference, interface, events, api, troubleshoot, admin}.md; plugins/components.md; terminal-config.md; statusline.md; llms.txt.
