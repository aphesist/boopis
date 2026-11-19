# How agents operate other programs: browsers, desktop apps, the OS

Research for boopis (desktop coding harness on unmodified Hermes Agent v0.23.2; Arch Linux first, then Windows and macOS). Goal: any model, many tools, one permission model the user controls.

Labels: **[V]** read in the vendored source or fetched from the primary page; **[I]** my inference; **[?]** not verified. `$H` = a checkout of hermes-agent v0.23.2 (`vendor/hermes-agent/` here), `$OP` = a checkout of the Hermes official plugins. Web sources were fetched 2026-11-19. Some vendor pages describe products by names I could not cross-check, so I quote them as written and avoid leaning on model names. I did not run Hermes, so "works" means "shipped and documented", not "tested on this machine".

---

## 1. What Hermes v0.23.2 already does

### 1.1 Summary table

| Capability | Mechanism | Perception | Action language | Linux today | Gating |
|---|---|---|---|---|---|
| `browser` toolset: `browser_exec` (+ `browser_cdp`, `browser_dialog`, `browser_vault`) | browser-harness (the Browser Use CLI engine) driving Chromium over CDP | Text first: `page_info()`, `js()`, raw CDP incl. `Accessibility.getFullAXTree`; screenshots attached natively only when the model has vision | Model-written **Python** with pre-imported helpers, one call can batch a whole procedure | Yes. Packaged Chrome for Testing via Hermes's package manager, headless by default | URL policy only (SSRF, metadata, blocklist). No per-action approval [V: grep] |
| `computer_use` | `cua-driver` over MCP stdio | `capture(mode=som\|vision\|ax)`: screenshot with numbered overlays plus AX tree, or AX tree alone | `computer_use(action=click\|type\|key\|...)` with element index or coordinates | Yes on glibc x86_64/arm64. X11 full; Wayland partial | Hermes approval gate, `cua:<action>:<mode>` grants, hard-blocked combos |
| `camofox` plugin (official) | Self-hosted Node server around Camoufox (Firefox fork), REST | Accessibility-tree text snapshot with `@eN` refs | `browser_navigate/click/type/...` typed tools | Yes, user runs the server | URL policy; optional JS denylist |
| `blender` plugin | Official Blender Lab MCP server over stdio, plus add-on on loopback 9876 | Scene queries | MCP tools (runs arbitrary Python inside Blender) | Yes | MCP trust tier only; README says "not a sandbox" |
| `homeassistant` plugin | REST + WebSocket | Entity state | `ha_call_service` etc. | Yes (network) | Blocked service domains hardcoded |
| `desktop_ui` toolset | Hermes Desktop renderer events | Preview pane element inventory | `drive_preview` click/type/scroll on the app's own pane | Desktop app only | Renders inside Hermes's own UI, not OS control |

### 1.2 Browser (`$H/tools/browser_use_cli.py`, `browser_session*.py`, `browser_launcher.py`, `website/docs/user-guide/features/browser.md`)

- **The old `browser_*` tools are gone.** `tools/browser_tool.py` is an 11-line compatibility stub: "The built-in browser_* tools and agent-browser are gone; `browser_exec` is the browser". Toolset `browser` is `browser_exec`, `browser_cdp`, `browser_dialog`, `browser_vault` (`toolsets.py:17-19,108-111`) [V].
- **How a page is perceived.** The tool description tells the model to work text-first when screenshots are not attached: `page_info()`, `js(expr)`, `fill_input`, and raw `cdp('Accessibility.getFullAXTree')` (thousands of nodes, filter in Python). With a vision-capable model, `capture_screenshot()` output is attached to the tool result (`_HEADER_VISION`). There is no set-of-marks and no ref system for the browser; the model writes selectors or CDP calls [V].
- **How actions are expressed.** `browser_exec(code, session, timeout_s)` runs model-written Python in a fresh interpreter per call; the browser session persists, Python variables do not. Helpers: `new_tab`, `goto_url`, `wait_for_load`, `page_info`, `js`, `fill_input`, `click_at_xy`, `capture_screenshot`, `cdp`, `ensure_real_tab`. It is only offered to sessions that also have the `terminal` toolset, because it executes model-written Python on the user's machine [V: browser.md "Note"].
- **Sessions.** `session="name"` gives its own harness daemon and its own browser (a separate Chromium locally, a separate cloud browser on cloud backends). Idle browsers are reaped after `browser.inactivity_timeout` (default 120 s). Headless by default; `browser.headed: true` keeps the window open between turns [V].
- **Where the browser comes from** (precedence in `browser_session*.py`):

| Source | Logged in? | Notes |
|---|---|---|
| Local packaged Chromium (default) | No, throwaway profile | `browser.user_data_dir` makes a persistent profile shared by all sessions |
| `browser.use_real_profile: true` | Yes, a **managed copy** of the user's active Chromium profile (Chrome, Edge, Brave, Brave Origin, Chromium) under `~/.hermes/browser-profile/`, launched with the real binary so OS-keychain cookies still decrypt; headless | Live profile never opened directly (profile lock, and Chrome 136+ blocks remote debugging of the default dir). Cookies are copied; locked password files skipped on Linux/macOS. Firefox default gets a fresh browser plus a message. Toggling off deletes the snapshot. Adds a `local` parameter to the tool schema only when consented (`_dynamic_schema_overrides`) |
| `/browser connect [ws://...]` | Yes, the user's running browser via CDP | Interactive-CLI slash command only |
| Cloud: Browserbase, Browser Use, Firecrawl, Nous gateway | Provider profiles | Stealth, residential proxies, CAPTCHA solving on some. Hybrid routing sends private URLs to a local sidecar |
| Lightpanda | No | No screenshots, one page per session |

- **Logged-in state and secrets.** `browser_vault` fills saved logins, cards, addresses and TOTP codes "without the secrets entering the conversation": opaque handles, origin must match exactly (pre-checked and re-asserted inside the fill script), injection over the supervisor CDP socket, value registered with the redaction boundary, result is only `{filled_fields, kind, origin, success}`. `save_login` prompts in a masked field. Cards require user confirmation. Ported from Merit-Systems/OpenInstinct (MIT) [V: `tools/browser_vault_tool.py` docstring, `credential-vault.md`].
- **Policy that exists.** `tools/browser_url_policy.py`: ordered floors. Cloud-metadata/IMDS refused always; private addresses refused unless the browser is local or the URL goes to the local sidecar; then `security.website_blocklist` (a **blocklist**, not an allowlist; `website_policy.py`). URL literals in the Python code are pre-scanned, so a URL built at runtime or a redirect is not caught (security.md "What allow_private_urls covers"). `browser_cdp` guards raw CDP calls against private pages. Hermes states real-profile mode "is a consent-gated convenience, not an isolation boundary" [V].
- **What does not exist.** I found no approval call in `browser_use_cli.py` or `browser_cdp_tool.py`. Clicking "Buy" or sending a message through `browser_exec` is not an approval event by itself [V: grep; I did not trace every registry-level gate]. There is no per-site allowlist and no action-class classifier. Because the action language is arbitrary Python, a classifier on the arguments cannot be sound [I].

### 1.3 `computer_use` and `cua-driver` (`$H/tools/computer_use/`, `plugins/computer_use/cua/`, `computer-use.md`, `pm/lock.json`)

- **What `cua-driver` is.** The `cua-driver-rs` driver from github.com/trycua/cua (MIT; the repo also holds Cua Spaces, Lume VMs, Cua Bench, CUA-S1 models, SDKs). Hermes pins release `cua-driver-rs-v0.21.0` for darwin-universal, linux-x64, linux-arm64, win32-x64, win32-arm64 with sha256s (`pm/lock.json:69-94`). It is a default PM package on every macOS, Windows and **glibc Linux** target; no musl or Android build [V].
- **How it sees and acts.** One call returns two sources: the accessibility tree (AX on macOS, UIA on Windows, **AT-SPI on Linux**) and a screenshot. Each element gets an `element_token`; element actions go through the tree (`AXPerformAction`, UIA Invoke, AT-SPI actions), so they work without moving the real cursor or raising the window ("no-foreground contract") [V: cua.ai/docs/explanation/the-no-foreground-contract]. Hermes wraps it as one tool with `action` discriminator (`capture, click, double_click, right_click, middle_click, drag, scroll, type, key, set_value, wait, list_apps, list_windows, focus_app`) and three capture modes: `som` (screenshot with numbered overlays, default), `vision` (plain), `ax` (tree only, for text-only models) (`tools/computer_use/schema.py`) [V].
- **Model-agnostic by design.** "Works with any tool-capable model… no Anthropic-native schema." Screenshots go as OpenAI-style `image_url` parts and are converted for Anthropic. Text-only models get `mode="ax"` (degraded) [V: computer-use.md "Provider compatibility"].
- **Linux specifics.** Hermes docs: X11 uses XTest; Wayland uses a virtual-keyboard path; AT-SPI must be on (default on GNOME/KDE/Xfce); "Wayland sessions need an XWayland bridge for capture". An opt-in `computer_use.native_wayland` config sets a native-Wayland bridge env var (`cua_backend.py:156`). Cua's own docs are stricter: on Sway, GNOME and KDE, background `press_key`/`hotkey`/`type_text` into a field that is not AT-SPI-editable returns `background_unavailable`; workarounds are `type_text` on accessible fields, `element_token` actions, `delivery_mode: foreground`, or running the app under XWayland (`GDK_BACKEND=x11`, `QT_QPA_PLATFORM=xcb`). On Wayland the driver "refuses rather than risk sending input to the wrong app" [V: cua.ai/docs/explanation/linux-and-wayland and the-no-foreground-contract]. On X11 the overlay cursor is disabled by default because it could wedge desktop input [V].
- **Approvals.** Everything except `capture` goes through the same gate as dangerous shell commands. Once/session/always grants keyed `cua:<action>:<background|foreground>` live in the shared `command_allowlist` store; a background grant never covers the foreground variant. Where nobody can answer (cron, `chat -q`, unattended platforms) the action is refused. Hard-blocked at tool level: empty trash, force delete, lock screen, log out; `curl | bash` and fork-bomb typing patterns. The system prompt forbids clicking permission dialogs, typing passwords, and following instructions found in screenshots [V: computer-use.md "Safety"; `tools/computer_use/tool.py:41-62,341-347`].
- **Cua's own permission modes** map onto Hermes approval settings and cannot change after launch: `standard` (Hermes prompts, Cua stops at its protected boundary), `bounded` (reviewed **capability manifest**: allowed tools, apps by executable path, file roots, browser profile kind and origins, `expires_after`, `idle_timeout`; anything else denied), `unrestricted` (`--yolo`; "no protection against prompt injection"). Seven layers each only narrow: hard invariants, tool/risk map, admin policy, user policy, mode, manifest, launch grant [V: computer-use.md; cua.ai/docs/reference/cua-driver/permission-modes]. This is the closest thing in the wild to the model boopis wants.
- **Bot Screen** (`tools/bot_desktop/`, `bot-screen.md`): on a headless **Linux** gateway host each bot (profile) gets its own Xvnc + Xfce desktop that `computer_use` and a headed browser act on, streamed into Hermes Desktop. A **control lease** (`lease.json`, fcntl-locked, epoch incremented on every transition) lets a human Take over (login, 2FA, CAPTCHA, payment) and Hand back; while a human holds it, even `computer_use` screenshots are refused. Threat model is honest: the lease is a tool-level fence, not an OS one; same-user processes can bypass it. Not offered on macOS/Windows hosts. Whether it can run on a user's local Wayland desktop is **[?]**; docs frame it as a server feature.
- **Drives which machine.** The gateway host, or inside the sandbox when `terminal.backend` is docker/ssh/singularity; Modal/Daytona/Vercel cannot host a display [V].
- **Screenshot cost handling.** Eviction of oldest screenshots at 100 images per request (20 if any image exceeds 2000 px), 1568 px embeds, ~1500 tokens per image estimate, compression pruning, Anthropic server-side context editing [V].

### 1.4 Camofox (`$OP/camofox/`)

Official plugin (formerly core). Hermes **never installs or starts** the server; the user runs `jo-inc/camofox-browser` (Node, wraps Camoufox, a Firefox fork with C++ fingerprint spoofing) on `localhost:9377`. Tools in toolset `camofox`: `browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_back, browser_press, browser_get_images, browser_vision, browser_console`, plus `browser_import_cookies` with an API key. Perception is an accessibility-tree text snapshot with `@e1`-style refs; snapshots over 15,000 chars are saved to a file and paged. Identity is a random Camofox `userId` per session unless `managed_persistence: true`, which derives one per Hermes profile (so a saved login survives; cookies hit disk only on `POST /stop` or graceful shutdown). Safety: URLs carrying Hermes secrets, cloud-metadata and blocklisted hosts refused; redirects not re-checked; optional `browser.restrict_evaluate` denylist for `browser_console`; typed secret-looking text masked. It lets `browser_vault` fill on the Camofox tab [V]. So Camofox is an **isolated, anti-fingerprint Firefox**, not the user's own profile. Licence of the plugin repo: LICENSE file present [?: not read]; Camoufox/camofox-browser licences [?].

### 1.5 `blender` and `homeassistant`: the two integration shapes

- **Blender** = an Agent Plugins v1 package: `plugin.json`, `mcp.json` (stdio, pinned git SHA of the Blender Lab MCP server, loopback 9876), a skill. No Python hooks. README: tools "execute arbitrary Python in Blender without protection against file deletion or data exfiltration… not a sandbox" [V: `$OP/blender/README.md`, `mcp.json`]. Shape: **MCP server + skill, consent equals installing it**.
- **Home Assistant** = a Python plugin registering four tools (`ha_list_entities`, `ha_get_state`, `ha_list_services`, `ha_call_service`) and a gateway platform. "HA has zero service-level access control; all safety lives here": hardcoded `_BLOCKED_DOMAINS` (`shell_command`, `command_line`, `python_script`, `pyscript`, `hassio`, `rest_command`), operator entity filters, post-call state verification (`tools.py:305-318,177,785`) [V]. Shape: **typed tools whose own code encodes the denylist**, with a resource scope (entity patterns) as the natural grant unit.
- Both show the two grant units boopis needs for app integrations: *server+tool* and *resource pattern inside the app*.

### 1.6 `desktop_ui` (`$H/tools/desktop_ui.py`, `toolsets.py:135-141`)

Not OS automation. GUI-session-only affordances: `read_terminal, close_terminal, desktop_preview, drive_preview, annotate_preview, read_window_below, focus_pane, react_to_message, gui_tour, show_tip, set_theme`. `drive_preview` clicks/types in the in-app browser preview using legible refs (`btn-sign-in`) via a `preview.act` request round-tripped to the renderer; `browser_vault` can fill into that preview (`target: "preview"`) bound to one window and page. Relevance: boopis owns the renderer, so it can show every action in its own pane and own the consent UI [V].

### 1.7 Approvals and policy: what Hermes gives and where the gap is

| Mechanism | Scope | Persistence | Source |
|---|---|---|---|
| `approvals.mode` manual / smart / off; `cron_mode`, `single_query_mode`, `unattended_mode` = deny | Dangerous terminal patterns, `computer_use` actions, vault payment, MCP trust | once / session / always (`command_allowlist` in config.yaml) | `security.md` |
| `approvals.deny` globs | Terminal commands, even before YOLO | config | security.md:169 |
| MCP `trust: untrusted` | Any MCP tool without `readOnlyHint: true` needs approval; Allow once / Session (that tool) / Always (`mcp:<server>/<tool>`) | session or config | `mcp-config-reference.md:72`, `mcp_tool_handlers.py:54-55` |
| MCP `tools.include/exclude`, `tool_costs` + `spend_limit` | Per-tool filter, per-chat budget | config | mcp-config-reference |
| MCP elicitation | Form-mode requests routed through the approval surface; URL-mode declined | per request | mcp-config-reference:70, `mcp_elicitation_form.py` |
| `security.website_blocklist`, `allow_private_urls` | URL tools incl. browser | config | security.md:801-870 |
| Hooks `pre_tool_call` returning `{"action":"block"\|"approve","message","rule_key"}` | **Any tool**; `approve` escalates to the human gate, `rule_key` chooses the "always" grain; block beats approve; timeouts fail closed | n/a | `hermes_cli/plugins.py:1132-1146`, VALID_HOOKS comments |
| `pre_approval_request` / `post_approval_response` observers, `register_approval_transport(name, present_fn)` | Custom presenter selected by `security.approval.transport`; receives redacted `ApprovalRequest`, returns correlated decision; surface names include `mcp-trust/<server>`, `mcp-elicitation/<server>`, `vault-payment` | host-owned | `plugins_context.py:246-261`, plugins.py:150-153 |
| `/yolo`, `--yolo`, `approvals.mode: off` | Skips MCP trust prompt too; escalates cua to `unrestricted` | per chat / process / profile | security.md:96, computer-use.md |

**Gap:** `browser_exec` has no approval event and no per-origin grant; MCP tools have only an untrusted/trusted binary; `computer_use` grants are keyed by action (`cua:click:background`), not by app, so granting "click" is granting click in **every** app. boopis's unified model must close these three holes, and the hook surface above lets it do so without patching Hermes [I].

### 1.7a What works on Linux/Arch today (Hermes only)

| Feature | Arch status |
|---|---|
| `browser_exec`, isolated Chromium | Works. PM installs Chrome for Testing (~170 MB); `needs_chromium_sandbox_bypass()` adds `--no-sandbox` only for root/Docker/AppArmor userns denial. System `chromium` on PATH is a fallback [V] |
| Real-profile copy | Works for Chrome/Chromium/Brave/Edge; cookies copy while the browser is open; password files are skipped while it is open [V] |
| `/browser connect` | Works; Chrome 136+ ignores `--remote-debugging-port` on the default data dir, so the user must launch with `--user-data-dir` or use Chrome for Testing (developer.chrome.com/blog/remote-debugging-port) |
| `computer_use` on X11 (incl. XWayland apps) | Works; AT-SPI tree + X11 window-addressed input |
| `computer_use` on native Wayland | Perception via AT-SPI and element-token actions work; raw background keys refused; capture needs XWayland bridge or `native_wayland` opt-in **[?: not tested]** |
| camofox | Works once the user runs the Node server |
| Firefox via `browser_exec` | **No.** Chromium/CDP only; Firefox removed CDP in 141 |
| Bot Screen | Server-style Xvnc + Xfce; local-desktop use **[?]** |

---

## 2. Browser automation options

### 2.1 Chromium family

| Option | Connects how | Perceives | Acts | Profile | Security model | Any model? | Licence |
|---|---|---|---|---|---|---|---|
| **Claude in Chrome** | Chrome extension (`debugger`, `tabs`, `webNavigation` permissions) plus a native-messaging host (`com.anthropic.claude_code_browser_extension.json`) and a bridge at `bridge.claudeusercontent.com`; in Claude Code appears as MCP server `claude-in-chrome` | Screenshots, DOM/read tools, console, network | Typed tools (click, type, navigate, upload, GIF record, batch) | **User's real logged-in Chrome/Edge**; new tabs grouped in a tab group; also Brave, Arc, Vivaldi, Opera | Site permissions, action confirmations, classifiers; see 4.1 | **No.** Needs a direct Anthropic plan and `/login`; off with API keys, Bedrock, Vertex, Foundry, ZDR | Proprietary |
| **Chrome DevTools MCP** (github.com/ChromeDevTools/chrome-devtools-mcp) | Launches Chrome itself (dedicated profile) or `--autoConnect` to the running Chrome after the user turns on `chrome://inspect/#remote-debugging` (Chrome 144+); Chrome shows a per-connection permission dialog and an "automated test software" banner | `take_snapshot` (a11y tree with `uid`), `take_screenshot`, console, network, perf traces | ~60 typed tools across categories (many opt-in): click, fill, fill_form, upload_file, navigate_page, evaluate_script, emulate, lighthouse, heap snapshots; opt-in categories (network mocks, extensions, WebAuthn, WebMCP) | Isolated by default (`--isolated`, `--headless`, `--slim`); live profile only via autoConnect | "Exposes browser content to MCP clients"; no allowlist; usage statistics and update checks on by default (`--no-usage-statistics`); only Chrome and Chrome for Testing supported; no read-only annotations on tools | **Yes (MCP)** | Apache-2.0 |
| **Playwright MCP** (github.com/microsoft/playwright-mcp) | Launches browser; `--extension` connects to a running Chrome/Edge through the Playwright extension (user's tabs and logins); `--cdp-endpoint` attaches over CDP | Default: **accessibility snapshot with refs** ("better than screenshot"); `--caps=vision` adds coordinate tools | Typed: `browser_click(target)`, `browser_type`, `browser_tabs`, forms, dialogs; opt-in groups `network, storage, devtools, pdf, testing`; `browser_run_code_unsafe` is RCE-equivalent | Persistent per-workspace profile by default; `--isolated` in-memory; `--storage-state` preload | **`--allowed-origins`, `--blocked-origins`**, `--allowed-hosts` (DNS rebinding), file access limited to workspace roots, `--secrets` masking (convenience only). "Playwright MCP is not a security boundary" | **Yes (MCP)** | Apache-2.0 |
| **browser-use** (github.com/browser-use/browser-use) | Python library/CLI; drives Chrome over CDP; `Browser('chrome')` attaches to open Chrome, `profile='Work'` uses a temp copy; the same engine as Hermes's `browser_exec` | Indexed elements (`click(41)`), JS, screenshots | Model writes Python in a persistent REPL, plus custom `@tools.action` | Real, copied, own, or cloud profile | `sensitive_data` placeholders domain-scoped; `allowed_domains`/`prohibited_domains` are "a guard for an aligned model, not a sandbox"; local debug port unauthenticated on 127.0.0.1 | **Yes**, any OpenAI-compatible base_url, Anthropic, Google | MIT |
| **Stagehand** (github.com/browserbase/stagehand) | SDK (TS/Python/Go); local Chrome or Browserbase | Trimmed accessibility tree | `act` (natural language, self-healing), `observe` (returns selectors), `extract` (schema), agent; hosted MCP needs a Browserbase key | Local or Browserbase contexts | Delegated to host | Yes (configure model) | MIT |
| **Chrome/Edge/Brave/Arc/Vivaldi/Opera** | All Chromium: CDP works as above. Claude Code detects the extension in Brave, Arc, Vivaldi, Opera; Hermes real-profile supports Chrome, Edge, Brave, Brave Origin, Chromium | | | | Pre-release channels (Beta/Dev/Canary) unsupported by Hermes real-profile | | |

Notes:
- Chrome 136 stopped honouring `--remote-debugging-port/-pipe` on the default user-data dir, because infostealers used it to take cookies; Google recommends Chrome for Testing for automation (developer.chrome.com/blog/remote-debugging-port) [V]. Every live-profile route therefore trades off: extension (Claude in Chrome, Playwright extension), consent-toggle autoConnect (DevTools MCP), or a **copy** of the profile (Hermes, browser-use `profile=`).
- Claude Code's own ladder is instructive: MCP server for the service, then Bash, then Claude in Chrome, then computer use; "computer use is the broadest and slowest, so Claude tries the most precise tool first" (code.claude.com/docs/en/computer-use) [V].

### 2.2 Firefox

| Option | Mechanism | Perception / action | Profile | Notes | Licence |
|---|---|---|---|---|---|
| **Claudezilla** (github.com/boot-industries/claudezilla, v0.7.7 badge) | MCP server (Node) to Unix socket/named pipe to a native-messaging host to a Firefox extension (also on addons.mozilla.org) | 35 tools. Compact **accessibility snapshot** with `[ref_N]`, page state, 20K-char text paging, screenshots (1568 px default, annotated mode); click/type/press/scroll/find; console and network; `firefox_evaluate` is opt-in and off the default allow-list | Operates in the user's **running Firefox** (`firefox_attach_tab`, lists tabs not yet controlled); the Linux installer can also create a headless profile `~/.mozilla/firefox/claudezilla-headless` plus a systemd user unit | Local only, no page data to servers. Per-agent `allowedDomains` allow-list checked only on navigate/create-window, agent can clear it: "not a sandbox". Blocks `javascript:` and `data:` URLs. Pool tabs owner-checked with 128-bit agent IDs; multi-agent slots (12 tabs, 30 s reservations); idle tabs closed after 10 min. No confirmation step. Needs Firefox 140+, Node 18.17+. **Lists Hermes Agent among clients** | MIT |
| **Mozilla firefox-devtools-mcp** (github.com/mozilla/firefox-devtools-mcp) | MCP server over **WebDriver BiDi** via Selenium; attach to existing Firefox needs both `--marionette` and `--remote-debugging-port` | Typed tools **[?: tool list not read]** | Launches its own Firefox profile; Marionette changes bot-detection signals | Official Mozilla repo, last push reported April 2026 (from search results, not the repo) | MIT |
| **WebDriver BiDi** (w3c.github.io/webdriver-bidi) | WebSocket, JSON-RPC-like; modules `session, browser, browsingContext, emulation, network, script, storage, log, input, webExtension`; Editor's Draft 13 Nov 2026 | Events pushed to the client | n/a | **The only remote protocol Firefox has**: CDP support removed in Firefox 141 (fxdx.dev/cdp-retirement-in-firefox/); `remote.active-protocols` pref gone except in 128 ESR | W3C |
| **Marionette / geckodriver** | Firefox-internal protocol underpinning geckodriver's WebDriver HTTP (firefox-source-docs.mozilla.org/remote) | Selenium-style | Fresh profile | Needed for chrome-context features BiDi lacks | [?] |
| **Playwright Firefox** | Playwright's patched Firefox build; "doesn't work with the branded version of Firefox since it relies on patches" (playwright.dev/docs/browsers) | Same as Playwright MCP (`--browser firefox`) | Playwright-managed profile, never the user's own Firefox | Fine for isolation, useless for logged-in use | Apache-2.0 |
| **Camofox** (Hermes official plugin) | See 1.4 | Accessibility text snapshot + refs | Own identity, persistent per Hermes profile | Anti-fingerprint, anti-bot; not the user's profile | see 1.4 |

Implication: **Hermes's `browser_exec` cannot drive Firefox at all** (CDP only), and `use_real_profile` falls back with a message when the default browser is Firefox. Any Firefox route is a separate mechanism, so it enters through MCP or the camofox plugin.

### 2.3 Safari

Safari WebDriver (`safaridriver`, macOS only): off by default (Develop menu, "Allow Remote Automation", authenticate `safaridriver` once). Runs in special **automation windows isolated from normal browsing**, like Private Browsing: clean state, no history or AutoFill. **One session at a time.** A "glass pane" blocks stray user input and the user can "break the glass" to sever the test (webkit.org/blog/6900/webdriver-support-in-safari-10/) [V]. Consequence: no logged-in Safari automation through WebDriver, by design; the real Safari requires AX/computer use. BiDi support status [?]. WebKit via Playwright is its own patched build, not Safari.

---

## 3. Desktop and OS automation

### 3.1 Vendor computer-use APIs (screenshot in, pixel actions out)

| Vendor | Tool | Loop and coordinates | Actions | Safety hooks in the API | Locked-in? |
|---|---|---|---|---|---|
| **Anthropic** (platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | Current `computer_toolset_20260801` (17 member tools); earlier `computer_20251124` (beta header `computer-use-2025-11-24`, zoom) and `computer_20250124` | Client-side loop: you take screenshots and execute actions; coordinates are in screenshot pixels; recommended 1024x768 to 1280x800, never above 1920x1080; image cap 2,576 px/4,784 tokens on newer models, 1,568 px/~1.15 MP earlier; oversized images rejected, not downscaled | screenshot, zoom, left/right/middle/double/triple click, drag, mouse_move, mouse down/up, scroll, type, key (+repeat), hold_key, wait, cursor_position | Anthropic runs classifiers on tool-returned screenshots and flags likely injection; docs advise a dedicated VM, no credentials, a domain allowlist, a human for consequential actions | Schema trained into Claude, but the **executor is yours**; boopis can drive it only for Claude models |
| **OpenAI** (developers.openai.com/api/docs/guides/tools-computer-use) | `{type:"computer"}` in the Responses API | `computer_call` with an ordered `actions` array, return `computer_screenshot` with `detail:"original"`, loop with `previous_response_id`. For one newer model the docs recommend code execution instead and keep `computer` "as an alternative" | click, double_click, drag, move, scroll, keypress, type, wait, screenshot | Pending API safety checks stop the sample; docs: isolated browser/VM, fresh profile, allow-list, "treat screen content as untrusted, and never let it grant permission", confirm at the point of risk (purchases, data transmission; typing sensitive data counts as transmission), step/time/cost limits | Vendor schema; Responses API only on that page |
| **Google Gemini** (aistudio.google.com/docs/computer-use) | `computer_use` tool with environment `browser`, `mobile` or `desktop` | `function_call` with an `intent` field; **coordinates normalised 0-999**; you convert to the viewport | browser: click variants, mouse down/up, move, type, drag_and_drop, press_key/key_down/up, hotkey, scroll, go_back/forward, navigate, take_screenshot | **`safety_decision` per call** (`require_confirmation` or blocked, acknowledged with `safety_acknowledgement`); policy categories: financial transactions, sensitive data modification, communication, account creation, data modification, user-consent management, legal terms; `enable_prompt_injection_detection` scans screenshots (off by default, newer models); the sample system prompt stops for purchases, messages, terms, CAPTCHAs | Vendor schema |
| **UI-TARS** (github.com/bytedance/UI-TARS-desktop) | Open model family plus a desktop app; Agent TARS stack is built on MCP | Screenshot recognition plus mouse/keyboard control; local and remote computer/browser operators; Windows, macOS, browser | Own action vocabulary (not read) | None documented | Open: repo Apache-2.0 (weights licence not stated on the page), repo **archived 9 Nov 2026** |
| **Qwen3-VL** (github.com/QwenLM/Qwen3-VL) | Open VLM "Visual Agent"; cookbook `computer_use.ipynb`, `mobile_agent`, grounding with relative coordinates | Screenshots | Tool calls defined by the host | None | Open, Apache-2.0 |
| **cua-driver / Hermes `computer_use`** | MCP/tool over **AX tree + screenshot** | `som` indices or element tokens, coordinates optional | Listed in 1.3 | Cua modes and manifest (1.3) | **No.** Any tool-calling model |

Reading: the vendor tools are pixel loops with different coordinate conventions and model-specific training; the *executor* (screenshot, click, key, scroll) is the same everywhere. A model-agnostic layer needs only: capture, element-addressed actions, pixel actions as a fallback, and an adapter per vendor schema if boopis ever wants a vendor's native tool [I]. Hermes's choice (one `computer_use` tool with SOM indices) is what makes weak or text-only models usable.

### 3.2 Accessibility-API automation per OS

| OS | API | What it gives | Constraints |
|---|---|---|---|
| **Linux** | **AT-SPI2** over D-Bus; `DoAction` on elements; GTK/Qt/Electron expose trees | Roles, names, states, actions, text, without pixels | Chrome/Chromium trees are empty unless launched with `--force-renderer-accessibility` (from computer-use-linux's notes, secondary). Some toolkits expose nothing (Cua: Cinnamon). **Wayland:** clients cannot know global coordinates; widgets report window-relative extents, only the compositor knows absolute window position (wiki.freedesktop.org/www/Accessibility/GTK-a11y-revamp/ via search; at-spi2-core issue 158). GTK4 coordinate reports have been wrong (gtk issues 5896, 6343). A new surface-relative protocol is in progress. The coordinate-free route, AT-SPI actions, is what automation falls back to |
| **Windows** | **UI Automation** (COM): element tree rooted at the desktop, control types, control patterns (Invoke, Value, ExpandCollapse), events | Rich and stable | No communication across processes started by different users via "Run as" (Microsoft Learn); elevated-window limits [?: not in the page]; the driver daemon must run in the interactive session, not Session 0 (Cua WINDOWS.md via Hermes docs) |
| **macOS** | **AX API** (`AXUIElement`) | Tree and actions; Hermes/Cua use `AXPerformAction` plus pid-scoped CGEvent/SkyLight posting | TCC grants: **Accessibility** and **Screen Recording**, attached to the driver's own identity `com.trycua.driver`; stale grants after driver updates (trycua/cua#3170) |

**Wayland screenshot and input injection** (the Arch case):

| Path | What it is | Consent and persistence | Caveats |
|---|---|---|---|
| **xdg-desktop-portal RemoteDesktop** (+ ScreenCast) | Create session, SelectDevices (keyboard=1, pointer=2, touch=4), Start, `NotifyPointer*`, `NotifyKeyboardKeycode/Keysym` | `Start()` shows a dialog; `persist_mode` 0/1/2 and a single-use `restore_token` give "ask once, remember until revoked" (flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html) | Needs a portal backend per compositor; consent is a compositor-owned dialog the agent cannot skip |
| **libei via `ConnectToEIS()`** | Returns an fd to a libei sender; afterwards `Notify*` calls error | Same session consent | Compositor support varies **[?: libei page was blocked by bot protection; not verified]** |
| **ydotool** | Kernel `uinput` virtual device through a mandatory `ydotoold` daemon | None: needs `/dev/uinput` access (usually root); works on Wayland, X11, TTY | Keycodes only, no layout awareness; **AGPL-3.0**; bypasses every compositor-level consent |
| **XWayland + X11 tools** (XTest, xdotool) | Works for X clients only | None | What cua-driver relies on for capture and input on Wayland today |
| **Compositor virtual sessions** | e.g. `kwin-mcp` runs apps in an isolated KWin virtual session with AT-SPI and screenshots; a sibling to Hermes Bot Screen's Xvnc | Isolation is the consent | KDE-specific; young project (PyPI, not verified in repo) |

### 3.3 MCP servers for desktop control (all young; check before depending)

| Server | Platform | Perception | Licence / note |
|---|---|---|---|
| `cua-driver` MCP (`cua-driver mcp`) | mac/Win/Linux | AX tree + screenshot, element tokens | MIT; already a Hermes PM package |
| Windows-MCP (github.com/CursorTouch/Windows-MCP) | Windows 10/11 | UIA `Snapshot` with ids plus `Screenshot`; no custom vision models | MIT; "full system access"; has App, PowerShell, FileSystem, Registry tools; a desktop-control policy so the user can take the desktop back ("best-effort, not a security boundary"); telemetry on by default |
| computer-use-linux (agent-sh), linux-desktop-mcp, kwin-mcp, others | Linux | Screenshot + AT-SPI tree with stable indices; ydotool for input in some | Registry pages only; **[?]** repos unverified |
| Claude Code built-in `computer-use` MCP | macOS CLI; macOS and Windows in Claude Desktop | Screenshots | Per-app approval, tiered (below) |
| Agent TARS | Cross-platform | Screenshots | MCP-based kernel; repo archived |

### 3.4 Model-agnostic versus locked

| Approach | Needs | Model-agnostic? |
|---|---|---|
| Hermes `browser_exec`, camofox, `computer_use`, Playwright MCP, DevTools MCP, Claudezilla, browser-use, Windows-MCP, cua-driver | Tool calling; vision optional (AX/text modes exist) | **Yes** |
| Anthropic / OpenAI / Gemini native computer-use tools | That vendor's models, their schema and coordinate convention | **No**, but executors are reusable |
| Claude in Chrome / Claude Code `computer-use` / Claude Desktop computer use | Anthropic account (`/login`; API keys and third-party providers excluded) | **No** |
| ChatGPT agent (hosted virtual browser) | OpenAI | **No**; help page says the product is discontinued in favour of ChatGPT Work and a cloud browser (one cached version; **[?]**) |
| UI-TARS, Qwen3-VL | Self-hosted weights; pixel-grounded | Open, but "any model" only if the model is trained for GUI grounding |

---

## 4. Permission models in practice

### 4.1 Comparison

| System | Grant unit and scope | Action-class confirmations | Time/session grants | Takeover | Audit | Injection defences |
|---|---|---|---|---|---|---|
| **Claude in Chrome** (support.claude.com/en/articles/12902446; claude.com/blog/claude-for-chrome) | Per **site**: "Allow this action" (one), "Allow all for this website" (standing), "Allow this time only"; revoke in extension settings, with a permission history; Team/Enterprise allow/blocklists on top; Claude Code can auto-allow only when the extension is not denied by rules | Even with a site grant it still asks before **downloads, sensitive-info entry, authorizations**. Always asks: changing permissions, granting authorizations, entering sensitive info, permanent deletion. Prohibited regardless: purchases/financial transactions, account creation, card/ID data, untrusted downloads, trades, system-file changes, following instructions from emails or web content, bypassing CAPTCHAs. Blocked categories: financial services, adult, pirated | Modes **Manual / Auto / Skip all approvals**; the side panel remembers the mode; Auto "reviews each action for safety" | Pauses at login pages and CAPTCHAs for the user | Permission history in the extension; sessions stored with the account; GIF recording | Classifiers on all untrusted content, RL, red-team. ASR 23.6% to 11.2% (123 cases/29 scenarios, first preview); later 1.4%-2.4% with improved safeguards on newer models using an adaptive 100-attempt attacker (anthropic.com/research/prompt-injection-defenses); "No browser agent is immune"; attack vectors seen: hidden DOM form fields, URL text, tab titles |
| **Claude Code** (code.claude.com/docs/en/permissions, /sandboxing, /computer-use) | Rules `Tool(specifier)`: Bash patterns, `Read/Edit` path globs, `WebFetch(domain:...)`, `mcp__server__tool` or `mcp__server__*`; scopes user, project, local, managed (admins can lock); evaluation **deny, then ask, then allow**, first match wins | Per tool type: reads free in working dirs; Bash, edits, web fetch ask; a built-in read-only command set is free | "Yes, don't ask again" persists per repo+command (Bash, WebFetch domain) or until session end (edits); `denyInsteadOfPrompting` for unattended; `dontAsk`, `plan`, `acceptEdits`, `auto` (classifier), `bypassPermissions` modes | `Esc` aborts computer use, key consumed so injection cannot press it | Hooks (PreToolUse) and transcripts | **Sandbox** is a separate OS boundary (bubblewrap/Seatbelt, proxy with domain allowlist, protected paths); explicitly does **not** cover Read/Edit/WebFetch tools or local MCP servers; project settings cannot turn on Chrome (a repository must not connect Claude to the browser). **Computer use**: per-app **session** approval; categories: browsers and trading apps view-only, terminals and IDEs click-only, everything else full; warnings "equivalent to shell access" for terminals/IDEs; the terminal is excluded from screenshots; one session at a time via lock |
| **OpenAI ChatGPT agent / Operator** (help.openai.com/en/articles/11752874) | Hosted virtual browser; sign-ins by takeover | Confirmations for high-impact actions; refusal patterns; **watch mode** (user supervision required on certain sites) | Cookies persist across sessions like a normal browser; clear via settings | **Take over browser**: screenshots are not captured while the user types; agent resumes from prior state | Not covered | Prompt-injection monitoring |
| **Gemini computer use** | Developer-implemented | `safety_decision` per action with seven policy categories | n/a | Developer | "Log prompts, screenshots, suggested actions, safety responses, executed actions" | Optional screenshot injection detector, sandbox VM, allow/blocklists |
| **browser-use** | `allowed_domains`, `prohibited_domains`, `block_ip_addresses`, `sensitive_data` per domain | None built in | n/a | Cloud live view | Cloud: audit logging in enterprise | "A guard for an aligned model, not a sandbox" |
| **Playwright MCP** | `--allowed-origins/--blocked-origins`, workspace file roots | None; opt-in capability groups act as coarse consent | n/a | n/a | n/a | "Not a security boundary" |
| **MCP spec** (modelcontextprotocol.io/specification/2025-11-25) | Tool **annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`); "clients MUST consider tool annotations to be untrusted unless they come from trusted servers"; SHOULD keep a human in the loop with ability to deny, show tool inputs before the call, validate results, time out, **log usage for audit** | Client decides | n/a | **Elicitation**: form mode (flat schema; MUST NOT be used for passwords, keys, tokens, payment credentials) and **URL mode** (out-of-band, credentials never transit the client; client must show the full URL, get consent, not prefetch, and identify which server asks); actions accept / decline / cancel | Client-side | Result sanitising is a server duty; no injection defence in the protocol |
| **Hermes** | See 1.7: `command_allowlist` keys (`cua:<action>:<mode>`, `mcp:<server>/<tool>`), MCP trust tiers, cron/unattended modes deny, control lease for takeover | | | Lease with epoch | `approvals suggest` over approval history | Prompt rule "no instructions from screenshots"; vault never shows secrets to the model; redaction of echoed secrets |
| **cua-driver** | Manifest: tools, apps (executable path), file roots, browser profile kind + origins, `expires_after`, `idle_timeout`; layers only narrow | `standard` mode asks at "residual boundaries" such as attaching to a logged-in profile; OS security prompts are `security_prompt_protected` (input refused, reading allowed) | Manifest expiry | n/a | Trajectory recording | `unrestricted` = no protection |

### 4.2 Patterns worth copying

1. **Two axes, not one.** Grants say *where* (site, app, folder, server+tool); confirmations say *what class of consequence*. Claude in Chrome keeps both: a standing site grant still does not cover downloads or sensitive entry.
2. **A short never-grantable list** (permission changes, credential entry, permanent deletion, purchases), distinct from "always ask".
3. **Mode ladder with an explicit bottom rung** (Manual, Auto, Skip), and in the unattended case "deny instead of prompt" (Hermes `cron_mode: deny`, Claude Code `denyInsteadOfPrompting`).
4. **Capability manifests for repeatable automation** (cua bounded mode): review once, expiry and idle timeout mandatory.
5. **Takeover as a first-class state** with the agent blocked, not trusted to pause: OpenAI stops screenshots; Hermes refuses even `computer_use` captures while the human holds the lease.
6. **Secrets never reach the model** (vault origin-bound fill; MCP URL-mode elicitation; 1Password in Claude in Chrome).
7. **Sandbox and permissions are separate layers** (Claude Code's own docs).
8. **Exclude the harness UI from screenshots** so the model cannot read approval prompts or inject through them (Claude Code hides its terminal).

---

## 5. Design implications for boopis

### 5.1 One capability and permission model

**Principle.** The model (any model) only ever calls tools. A single policy layer in boopis decides each tool call into `allow`, `ask`, or `deny`, using one vocabulary regardless of whether the tool is a Hermes built-in, an MCP server, or a plugin. Enforcement point: Hermes's `pre_tool_call` hook (returns `block` or `approve` with a `rule_key`; fails closed on timeout), plus `register_approval_transport` so the existing boopis card renders the prompt. Neither requires patching Hermes [V for the hook API, I for the end-to-end wiring; I did not build it]. MCP tool names are the cheap classifier: Playwright/DevTools/Claudezilla tools are typed, so `browser_click` versus `browser_navigate` versus `evaluate_script` is known without inspecting arguments. Hermes's `browser_exec` is Python, so it must be treated as **one coarse capability** (`web.script`) that can only be granted per origin and per session, never per action [I].

**Capability kinds**

| Kind | Meaning | Hermes/MCP realisation | Default class |
|---|---|---|---|
| `web.read` | Navigate and read pages in an isolated browser | `browser_exec` (URLs only), Playwright snapshot, DevTools snapshot | Grant per origin |
| `web.act` | Click/type/submit on an origin | Typed MCP tools; `browser_exec` with origin grant | Per origin, confirm action classes |
| `web.script` | Arbitrary JS/CDP/Python in a page | `browser_exec`, `browser_cdp`, `evaluate_script`, `browser_run_code_unsafe` | Ask per session per origin; never "always" |
| `web.identity` | Which browser identity: `isolated`, `managed-copy` (Hermes real profile), `live` (extension/autoConnect), `vault-filled` | Hermes `use_real_profile`, `/browser connect`, DevTools `--autoConnect`, Claudezilla attach | `live` and `managed-copy` need an explicit, revocable, named grant |
| `desktop.observe` | Screenshot/AX tree of app X | `computer_use capture` | Per app |
| `desktop.act` | Click/type/key in app X | `computer_use` actions | Per app, per session by default |
| `desktop.display` | Whole screen, raw coordinates, input outside any app | `app=screen`, ydotool/portal | Ask each task; confirmation |
| `app.<server>` | An integration (Blender, Home Assistant) | MCP server + tool, or plugin toolset | Per server+tool, optionally per resource pattern (HA entity globs) |
| `fs.read` / `fs.write` | Folder grants (Claude Code model) | Hermes terminal/file tools | Per folder |
| `secret.use` | Fill a vault item into an origin | `browser_vault` | Per item+origin; value never returned |
| `net.egress` | Domains reachable | Hermes website policy, Playwright `--allowed-origins` | Per domain |

**Grant scopes.** `once` (this call), `turn` (this task), `session`, `always` (persisted), each optionally with `expires_at` and `idle_timeout` (cua manifests make these mandatory in bounded mode). Subjects, in order of specificity: *origin* (scheme+host, with an "include subdomains" toggle; guard against redirect to another origin as Hermes vault does), *app* (executable path plus AT-SPI app name, not a bare name), *folder*, *server+tool*, *resource pattern*. Grants only **narrow** down a hierarchy (hard invariants > organisation/boopis policy > user policy > teammate > task), copied from cua's seven-layer rule. A tier ceiling per app category, taken from Claude Code: browsers and trading apps `observe` only via the desktop route (use the typed browser route instead), terminals and IDEs `click` only, with an "equivalent to shell access" warning card [V: code.claude.com/docs/en/computer-use].

**Action classes that always need confirmation** (a standing grant never covers them; `always` is not offered). These combine Claude in Chrome's always-ask list, Gemini's policy categories and OpenAI's guidance:

| Class | Examples | Card treatment |
|---|---|---|
| `spend` | Purchase, subscription, transfer, trade | Hold-to-approve; show amount and merchant |
| `send-as-user` | Email, chat message, post, comment, invite | Hold-to-approve; show full body and recipient |
| `delete-irreversible` | Delete mail/files, empty trash, account closure | Hold-to-approve |
| `credential` | Typing a password or key, vault fill, TOTP, new login | `signin` kind, takeover or vault flow; never a text field the model sees |
| `download-exec` | Download, open or run a file, install an extension | `approval` |
| `upload-local` | Attach a local file to a web form | `approval`; reuse Claude Code's rule that refuses credential-named files |
| `authorize` | OAuth consent, permission prompts, ToS and consent banners | `approval`; Hermes and Anthropic both say agents must not click OS permission dialogs |
| `account-create` | Sign-ups | `approval` |
| `identity-upgrade` | Switching to `live`/`managed-copy` profile | `permission` |
| `script-injection` | Raw JS or CDP on a logged-in origin | `permission` |

Hard-deny (policy, not configurable per task): bypassing CAPTCHAs (Claude in Chrome and Gemini examples), `curl | bash`-style typing and log-out/lock/force-delete key combos (Hermes hard blocks), IMDS/metadata URLs, input aimed at OS security prompts (cua `security_prompt_protected`).

**How classes are detected** (the hard part): typed tools map by name; `browser_exec` and raw CDP cannot, so v1 relies on (a) origin grants, (b) a conservative taint rule, and (c) network-level hooks (CDP `Fetch`/`Page.downloadWillBegin`, form-submit interception) in a later phase [I]. Respect MCP's warning that annotations are untrusted: use `readOnlyHint` only to **loosen** for trusted servers, never to bypass a deny (Hermes already treats a lying hint as limited to "skipping approval for calls the operator was already willing to run") [V].

**How grants surface.** Reuse the forms system:

| Form kind | Used for | Notes |
|---|---|---|
| `permission` | A new grant: capability kind, subject, scope (once / session / always, expiry), requested by a named bot or model | Shows what the grant would **also** allow (Claude Code only offers "always" when the prompt can show everything it covers) |
| `approval` | A single action in a protected class | Hold-to-approve for `spend`, `send-as-user`, `delete-irreversible`. Show the inputs before the call (MCP SHOULD), highlight the origin domain, never render model-provided URLs as clickable |
| `signin` | Takeover for login, 2FA, CAPTCHA, payment; also vault save | Starts a lease: while the human holds it, the agent cannot capture or act (Hermes lease semantics, OpenAI "no screenshots while you type"). Hand-back resumes with the same session |

Every card shows its **origin**: which bot (teammate) and which model asked, plus the tool path (`mcp:playwright/browser_click`) and the **target** (origin or app), so a card from a page-driven tool call is not confused with one the user triggered. Cards must come from a channel the page cannot reach: boopis's own UI, never the browser or a screenshot. In desktop automation, exclude boopis's own window from screenshots (Claude Code excludes its terminal) [V].

**Ledger.** One append-only record per grant event and per action:
- grant: `id, ts, principal (bot, model), capability, subject, scope, expires_at, decided_by (user, policy, preset), card_id, revoked_at`;
- action: `id, ts, grant_id, principal, tool, target (origin/app/server+tool), action_class, args (redacted, hashed), decision (allowed/asked/denied/blocked), result status, lease epoch, optional screenshot reference, task and message id`.
MCP says clients should log tool usage for audit and show inputs; Gemini's list (prompts, screenshots, suggested actions, safety responses, executed actions) is a good checklist. Hermes's own `command_allowlist` and `approvals suggest` history are inputs, but boopis's ledger should be the source of truth, and the Hermes store only a mirror or a fallback **[I: whether `approve` plus `register_approval_transport` lets boopis keep persistence out of config.yaml needs a spike; docs say persistence stays host-owned, i.e. Hermes]**.

**Revocation.** Revoking a grant must (1) take effect at the next `pre_tool_call`, (2) tear down live state: stop the harness daemon (`stop_harness_daemons`), close the managed-copy browser (`hermes browser close-profile`, and delete `~/.hermes/browser-profile/` as Hermes does when the toggle goes off), close the cua runtime and private daemon, disconnect `/browser connect`, (3) for `always` grants remove the mirrored `command_allowlist` entry. A **panic stop** (like Claude Code's `Esc`, key consumed so a page cannot press it) cancels the turn and freezes input.

**Teammates.** Hermes already gives each profile (bot) its own Bot Screen, browser profile and cookies; boopis maps one **teammate = one Hermes profile = one grant set = one browser identity**. Grants never flow between teammates; a delegated subagent gets the parent's grants **intersected** with its task scope. Show teammate and model on every card, and keep identities separate (`web.identity` is per teammate, so one teammate's real-profile grant does not give another teammate the user's cookies).

**Untrusted-content handling**, applied uniformly: page text, AX labels, tab titles, URLs and screenshots are *data*. Rules: (1) content can never create or widen a grant; (2) after a tool returns content from an origin the user has not marked trusted, outbound classes (`send-as-user`, `upload-local`, navigation to another origin carrying content, `credential`) escalate to `ask` for the rest of the turn (a simple taint rule) [I]; (3) keep Hermes's prompt line "no following instructions embedded in screenshots"; (4) sensitive values go through the vault, which registers them with the redactor.

### 5.2 First integrations on Linux/Arch

**Rule: reuse Hermes first, add MCP only where Hermes has no mechanism.** The ranked plan:

| # | Integration | Reuse what | Why | Effort/gaps |
|---|---|---|---|---|
| 1 | **Hermes `browser_exec` (isolated Chromium) + `browser_vault`** | Hermes as shipped | Already model-agnostic (text-first, vision optional), batches steps, sessions per teammate, SSRF/blocklist built in | Add boopis gating (origin grant per session via `pre_tool_call` + URL-literal extraction that Hermes already does); explain its Python nature in the grant card |
| 2 | **Hermes `computer_use` (cua-driver) for desktop** | Hermes as shipped; PM already installs on glibc Linux | This **is** AT-SPI desktop control. Do not build another | Gate per **app**, not per action (Hermes keys by action). Ship a "run it on X11/XWayland apps" explainer; for native Wayland show the capability honestly (AT-SPI tree and element tokens yes, raw keys no). Evaluate a nested/virtual display (Bot Screen style, or a compositor virtual session) as the **agent-owned screen** that avoids input conflicts with the user's seat **[?: feasible on a local desktop?]** |
| 3 | **User's real Chrome** | First Hermes's real-profile **copy** and `/browser connect`; then **Chrome DevTools MCP with `--autoConnect`** | Hermes's copy is read-only and headless, a snapshot that goes stale; the live route needs Chrome's own consent dialog and banner, which is the right UX | DevTools MCP is Apache-2.0, typed tools, a11y snapshot with `uid`, but no read-only annotations, usage statistics on by default (disable), and `evaluate_script` must map to `web.script`. Register as an MCP server with Hermes `trust: untrusted`, `tools.exclude` for categories boopis does not want (memory, third-party, extensions) |
| 4 | **Playwright MCP** | Optional second driver | Only where typed tools plus `--allowed-origins/--blocked-origins` bring real policy value beyond what the hook can do on `browser_exec`; also the route to WebKit and `msedge`. It duplicates Hermes's browser mechanism, so keep it **off by default** and add it when per-action classification of browser steps proves necessary | Mind `browser_run_code_unsafe` and the `network`/`storage` groups: leave the opt-in capability groups off |
| 5 | **Firefox route** | See below | Arch users often run Firefox; Hermes cannot drive it | |
| 6 | App integrations via MCP/plugins | Blender (Agent Plugin: MCP + skill), Home Assistant (plugin) | Already in Hermes official plugins; model after their two shapes; grant units are server+tool and resource pattern (HA entity globs) | Hermes `trust: untrusted` plus `tool_costs/spend_limit` for paid APIs |

**Firefox choice.** Order by what the user wants: 
- *User's own logged-in Firefox*: **Claudezilla** (MIT, MCP, accessibility snapshots with refs, extension plus native host, Linux installer, already lists Hermes as a client). Weaknesses: `allowedDomains` is not a sandbox and no confirmation step, so boopis must gate its typed tools itself; `firefox_evaluate` stays off.
- *Isolated or scripted Firefox*: **Mozilla firefox-devtools-mcp** (BiDi, MIT) for an official codebase, or Playwright Firefox for plain testing.
- *Anti-bot / fingerprint-hard sites*: **camofox** plugin (already official, persistent per teammate), user runs the server.
- Raw **WebDriver BiDi** is the foundation; do not build a client unless the above fail, since MCP servers over BiDi already exist.

**Windows and macOS later.** `cua-driver` already covers UIA and AX through the same Hermes tool; Chrome DevTools/Playwright MCP, `browser_exec` and the vault are cross-platform. Safari has no logged-in route except AX. Claude's own macOS-only CLI computer use and Windows Windows-MCP are alternatives rather than additions.

**Where not to build.** Browser driver, AX desktop driver, vault, SSRF policy and takeover lease all exist in Hermes; boopis builds only the **policy, ledger, card UI and revocation**, plus thin wrappers per MCP server.

### 5.3 Hard problems

| Problem | Facts | Position |
|---|---|---|
| **Wayland input and capture** | AT-SPI coordinates are window-relative; compositors do not expose global positions; cua refuses raw background keys on Sway/GNOME/KDE; portals need a consent dialog and give restorable tokens; ydotool is root-ish, AGPL, layout-blind | Prefer element actions; X11/XWayland for pixel work; portal RemoteDesktop with `persist_mode=2` as the **only** sanctioned pixel-input path on native Wayland (consent is real, revocable, and shows up in the compositor); never ship ydotool by default; offer an agent-owned virtual display |
| **Logged-in profile vs isolation** | Chrome 136 blocks remote debugging on the default dir for cookie-theft reasons; copy approach goes stale and copies credentials to a second location; extension/autoConnect gives full-account authority to the page and the agent; Claude's own docs recommend "a separate browser profile without access to sensitive accounts" | Default isolated. Treat `live` and `managed-copy` as high-impact grants per teammate with expiry, per-origin scoping on top, a visible indicator, and delete-on-revoke. Make "which identity" a first-class field on every browser card |
| **Prompt injection from pages and screenshots** | Anthropic's own best published figures are ~1-2% attack success with classifiers plus RL on an adaptive attacker, "meaningful risk" at 1%; no vendor classifier exists for an arbitrary model; vectors include hidden DOM fields, tab titles, URL text | Structural defences, not model trust: origin-bound grants, taint-escalation of outbound classes, confirmation of the protected classes, vault for secrets, never accept permission text from a page. Optionally call a screenshot-injection detector when the model provider offers one (Gemini flag, Anthropic classifiers). Treat YOLO as "disposable VM only" (Hermes/Cua wording) |
| **CAPTCHAs and anti-bot** | Claude in Chrome prohibits bypassing CAPTCHAs; Gemini's sample prompt stops at CAPTCHAs; cloud browser vendors sell solvers and residential proxies; camofox spoofs fingerprints; Marionette flags can trip bot detection | Policy: boopis does not solve CAPTCHAs. Pause and open a `signin` takeover. Cloud providers (Browser Use, Browserbase via Hermes plugins) and camofox are optional, off by default, and gated as network egress to a third party |
| **Cost and latency of screenshot models** | 1,000-1,800 input tokens per screenshot (Anthropic); Hermes estimates ~1,500, evicts at 100 images (20 if any image over 2000 px); loops accumulate; a `computer_use` step is a model round trip | Order mechanisms from cheapest to dearest, as Claude Code does: MCP/typed tool, shell, typed browser (text/AX), AX desktop (`mode=ax`), SOM screenshots, raw pixels. Let `browser_exec` batch many steps per call. Show per-task token and step counts in the ledger, with step/time/cost limits (OpenAI guidance) |
| **Gating a Python-shaped browser tool** | `browser_exec` takes arbitrary code; no sound per-action classifier | Origin-level consent plus network-level interception later; where per-action control matters, route through a typed MCP driver instead of `browser_exec` |
| **Unattended runs** | Hermes: cron/unattended modes deny; cua `bounded` manifests fail closed | Mirror: scheduled teammates may use only grants of scope `always` with expiry; anything needing `ask` is deferred to a card queue, never auto-approved |

### 5.4 Open questions for a spike (not answered by this research)

1. Can a `pre_tool_call` `approve` directive plus a registered approval transport fully replace Hermes's native card and keep grant persistence in boopis's ledger rather than `command_allowlist`? [source says persistence is host-owned]
2. Does `computer_use` on native Wayland under GNOME and KDE (Arch) deliver usable capture with `native_wayland` or only through XWayland?
3. Can Hermes's Bot Desktop (Xvnc + Xfce) run on a local desktop session, and is a nested display practical on Arch?
4. Which Chrome DevTools MCP tools carry MCP annotations at runtime (the reference page lists none)?
5. Camofox, Mozilla firefox-devtools-mcp and libei compositor support: licences and tool lists not verified here.
