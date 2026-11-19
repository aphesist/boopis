# Mods

Status: plan, 2026-11-19. Evidence: `docs/research/mods.md` (Claude Code's mod docs). Decision: ADR-0022.

**Rule: a Claude Code mod installs and runs unchanged, and everything it draws is drawn by our design system, so it looks native.** A mod's behaviour runs wherever the session runs: the desktop app, plain Hermes on the command line, or a cloud session. It draws only where there's a screen, which is Claude Code's own model.

A Claude Code mod is a plugin whose `hooks/hooks.json` names a JavaScript or TypeScript module. That module registers hooks on Claude Code's events, calls the `$` API (interface, themes, commands, tools, prompts, turns, files, network, state), and draws **element trees** (`Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Link`, `Svg`, …) into surfaces: panes, a band above the prompt, toasts, a status line, transcript rows, a backdrop, and Claude Code's own message views. No public spec exists for running mods outside Claude Code, so hypotaxis implements the API, the event chain and the renderer from the docs, and keeps a conformance suite against real mods.

## 1. Architecture
- **Install:** a mod is a plugin, so it installs through COMPAT §9: pinned to a commit, hash-locked, with an install prompt. A `modules` key in `hooks/hooks.json` marks it as a mod. Before consent, the install prompt lists the mod's hooks and the `$` namespaces it calls, found by static analysis as `claude plugin validate` does.
- **Runtime: `hx-mods`**, a library in the `hx` binary.
  - It embeds a JavaScript engine and a TypeScript/JSX transform, so `.ts` and `.tsx` modules load with no build step.
  - All of a session's mods share one isolate, as in Claude Code's single hooks worker.
  - The isolate runs inside `hx-sandbox`, with no file or network access. The only way out is `$`.
  - The engine is chosen by spike M0: QuickJS through `rquickjs` plus `oxc` for the transform is the candidate.
- **Each `$` call** is a request from `hx` to the plugin (`mods.call`). The plugin decides it with `hypotaxis.policy.check`, then performs it through Hermes, the host or the store. There is one table of calls and one implementation each.
- **Events:** the plugin maps Hermes's hooks and the gateway's events onto mod events, through the same bridge as Claude Code's hooks (COMPAT §4). There is one bridge for both.
  - `tool.check` and `tool.call` map to `pre_tool_call` and its result.
  - `prompt.*`, `turn.*` and `session.*` map to the gateway's prompt, turn and session events.
  - `command.run` maps to slash commands (COMPAT §5.1).
- **The chain** follows the docs exactly:
  - tiers (built-in guard, `prependPlugins`, user mods with dependencies first, `appendPlugins`);
  - `next`, `next.to`, `.catch`;
  - frozen events;
  - budgets (10 s per event, 50 ms for `prompt.edit`, 1 s for `.catch`);
  - three crashes unload every user mod.
- **`e.surface` is `desktop`.** Mods take their Desktop path, which suits a desktop renderer. In headless sessions, as with `claude -p`, hooks run and nothing draws.
- **Version:** hypotaxis states which Claude Code mods version it implements. The conformance table (§7) maps each gated feature ("requires v2.1.xxx") to supported, partial or not yet.

## 2. One renderer: the design system
- **Transport:** element trees travel from the plugin to the UI as data, through session events. Handlers (`onPress`, `onSubmit`, `onSelect`, `onInput`) become ids, and the UI answers with `ui.press`, `ui.input` and `ui.select` events. The UI never runs mod code.
- **One component, `hx-mod-view`,** maps each element onto the v6 library:

| Element | Drawn as |
|---|---|
| `Box` | a layout container on the spacing scale. Borders use the hairline token, and `backgroundColor` uses surface tokens |
| `Text` | the type scale. `mono` uses IBM Plex Mono and `tabular` uses tabular figures |
| `Button` | the library's button. `variant` and `role` map to its variants. A `hotkey` that collides with the app's keymap is dropped, never stolen |
| `Input`, `Select` | the form fields from FORMS.md (the same implementation) |
| `Markdown`, `Code` | the session's own markdown and code renderers |
| `Link` | `https:` only, opened in the system browser through the host |
| `Svg` | sanitised inline SVG: no scripts, no `foreignObject`, no external references |
| `Client` | an isolated iframe (no same origin, strict CSP) that talks through `postMessage` as `ui.message`. Phase M2 |
| `Raster`, `Image` | terminal-only in Claude Code; phase M2 |

- **Colours look right:**
  - Claude Code's theme keys and colour names map onto semantic tokens: `claude` to the accent, `success` to ok, `error` to danger, `warning` to warn, `subtle` and `inactive` to the quiet text, `text` to text, the `diff*` keys to the diff tokens, and `'red'`, `'green'` and the other names to their semantic tokens.
  - A literal hex colour, for example in a mod's chart, is drawn as given if it has enough contrast on our surface. Otherwise the nearest token is used.
  - Default text and backgrounds always come from the active theme, so a mod follows light, dark and every preset.
- **Limits** follow the docs: 100,000 characters drawn, 20,000 elements, depth 32, and the per-prop caps. A tree that fails validation is skipped, the site falls back to our own drawing, and the mod gets a log line, as in Claude Code.

## 3. Where each surface lands
| Mod surface | In hypotaxis |
|---|---|
| Pane (`$.ui.open`) | a pane in the details panel, as its own tab (`placement: 'dock'`). In narrow windows, inline above the composer (`'inline'`). Our breakpoints replace the terminal column rules |
| Band above the prompt | a band above the composer, one collapsible row per mod (`AbovePrompt`, `AbovePromptList`) |
| Transcript row (`$.ui.place`) | a row in the conversation, gone on clear, rewind or compaction, and not kept on resume, as in Claude Code |
| Toast | the app's notices, at most three at a time |
| `$.ui.status` | the session's status line under the composer, prefixed with the mod's name |
| `$.ui.log` | a quiet line in the conversation that the model doesn't read |
| `$.ui.notify` | a desktop notification through the host, following the user's notification settings |
| `$.ui.ask` | a `choice` form (FORMS.md) with a new origin kind, `{kind: mod, plugin}` |
| Backdrop | behind the conversation, under the scrim |
| `$.theme.set({ colors })` | a theme layer. The mod's anchors go through our ramp generator into tokens. A card offers to keep it or reject it; one mod at a time, as in Claude Code |
| Terminal themes (`themes/*.json`) | importable as hypotaxis themes: each token maps onto our semantic tokens |
| Redraw sites | each maps to one of our components: `UserMessage` and `AssistantMessage` to messages; `ToolUse`, `ToolResult` and `ToolGroup` to tool rows; `Spinner` to the working indicator; `TurnDuration` to the turn footer; `InfoNotice` to notices; `SessionMode` to the mode chip; `PromptHint` to the composer hint; `CommandOutput` to the command block. A prop change applies to the documented props; a replacement tree draws inside the component's slot. `AskUserQuestion` keeps our question card (as VS Code does). Approval cards and forms are never redrawable, matching Claude Code's permission prompt |
| `$.command.register` | slash commands in the composer's `/` list and the palette, namespaced `plugin:name` |
| `$.tool.register` | model tools `mcp__<plugin>__<name>`, decided by the policy. Toolsets are fixed at `session.create` (prompt caching), so a tool registered later is offered as deferred, or appears in the next session |
| `outputStyles` | a system prompt section fixed at `session.create`. Phase M2 |
| The `statusLine` setting | the command runs with the documented JSON, filled from what the session knows (model, cost computed from the ledger, context window, workspace, session). Its ANSI colours map to tokens in the status line. Phase M1 |

## 4. Security: compatible, and stricter than Claude Code
- In Claude Code a mod runs with the user's permissions, and its `$` calls can skip permission rules and hooks. Here they can't. `$.fs`, `$.http`, `$.process`, `$.mcp` and `$.model` calls are capability decisions (AUTOMATION.md) with the mod as the principal:
  - grants are per mod;
  - an ask becomes a `permission` form;
  - the ledger records each call as `tool.called` with the tool `mod:<plugin>/<call>`.
- The isolate has no file, network or process access of its own (`hx-sandbox`).
- Mods can't redraw approval cards or forms, can't draw outside their surfaces, and can't put HTML or scripts in a tree. `Client` runs in an isolated iframe.
- In governed mode, `turn.step` model changes are refused: the plugin chooses models (AGENTS invariant 2). Mods can observe tool calls; they can change them only within what the policy allows.
- Kill switches: disable per mod; turn all mods off; safe mode starts with none.

## 5. Build order
| Phase | Work |
|---|---|
| M0 spike | The runtime choice. Run three mods we write (a pane with state and a clock, a command, a band) through `hx-mods`. Measure isolate start (budget 50 ms), per-event overhead (budget 1 ms) and memory |
| M1 | Runtime and chain. The core of `$`: `plugin`, `ui` (`open`, `close`, `invalidate`, `toast`, `status`, `log`, `notify`, `ask`), `state`, `store`, `clock`, `command`, `config`, `env`, `theme`. The renderer for `Box`, `Text`, `Button`, `Input`, `Select`, `Markdown`, `Code`, `Link` and `Svg`. Surfaces: pane, band, toast, status, log and ask. Theme mapping, the `statusLine` setting, and the install flow |
| M2 | `tool.check`, `tool.call` and `tool.register` through the bridge. `prompt.*`, `turn.*` and `session.*`. `fs`, `http`, `process`, `mcp` and `model` through the policy. Redraw sites, placed rows, backdrop and `Client` |
| M3 | Conformance. Public mods from marketplaces as pinned fixtures, a runner compatible with `claude plugin test`, and the feature table per Claude Code version |

## 6. Design work for the owner
The owner designs the new surfaces in v6 before the port, as with forms:
- the band above the composer;
- a mod pane tab in the details panel;
- the mod status line;
- the mod origin in cards and forms;
- placed rows.
Everything else reuses existing components.

## 7. Open questions
- **The licence of Claude Code's `claude-code.d.ts`.** If it isn't permissive, our types are written from the docs and nothing is copied. **[verify]**
- **Desktop colour anchors** beyond `surface-0`, `text-primary` and `text-muted`, which are not on a public page. **[verify]**
- **Strict permissions:** how often real mods expect unrestricted `$.fs` or `$.process`, and how the asks feel. The M3 conformance suite answers this.
- **Reporting `surface: 'desktop'`:** check against popular mods that this gives the best result.
