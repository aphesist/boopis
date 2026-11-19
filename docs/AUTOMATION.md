# Automation: browsers, desktop apps and other programs

Status: plan, 2026-11-19. Evidence: `docs/research/automation.md` (Hermes's browser and computer-use tools, Chromium and Firefox drivers, vendor computer-use APIs, accessibility APIs per OS, Wayland, and the permission models of Claude in Chrome, Claude Code, OpenAI, Gemini, MCP and cua). Decision: ADR-0021.

**Rule: an agent only ever calls tools, and one policy decides every call.** Any model can drive a browser, a desktop app or a program through the same tools. The user grants permissions in one vocabulary: *what* (a capability), *where* (an origin, an app, a folder, a server and tool), and *for how long*. That holds whether the tool is a Hermes built-in, an MCP server or a plugin. hypotaxis builds only the policy, the cards, the ledger records and revocation. The drivers already exist.

## 1. What Hermes already does, and the gaps
| Hermes feature | What it is | On Arch today |
|---|---|---|
| `browser_exec` (+ `browser_cdp`, `browser_dialog`, `browser_vault`) | Chromium over CDP. The model writes Python against helpers; text-first, screenshots only for vision models | Works with an isolated Chromium (Chrome for Testing, installed by Hermes) |
| `browser_vault` | Fills saved logins, cards and TOTP into an exact origin; the value never enters the conversation | Works |
| Real profile | A **copy** of the user's Chromium profile, run headless, deleted when turned off | Chrome, Chromium, Brave and Edge. Not Firefox |
| `computer_use` (cua-driver, MIT, pinned by Hermes) | Accessibility tree plus screenshot, numbered overlays, element tokens; any tool-calling model, `ax` mode for text-only models | X11 and XWayland apps fully. Native Wayland: tree and element actions yes, raw background keys refused |
| camofox (official plugin) | An isolated, anti-fingerprint Firefox fork behind a local server | Works once the user runs the server |
| Approvals | `command_allowlist` keys such as `cua:click:background` and `mcp:<server>/<tool>`; MCP `trust: untrusted`; cron and unattended modes deny | Works |

There are three gaps, and the plugin closes all of them through its `pre_tool_call` hook, without patching Hermes:
1. `browser_exec` has no approval step and no per-site grant. It runs arbitrary Python, so no argument classifier can be sound.
2. `computer_use` grants are keyed by action, not by app: granting "click" grants click in every app.
3. An MCP server is either trusted or untrusted, with nothing in between.

Hermes's `browser_exec` can't drive Firefox at all: Firefox dropped CDP in version 141, and WebDriver BiDi is its only remote protocol. Claude in Chrome works only with a direct Anthropic plan, so it isn't model-agnostic and hypotaxis doesn't build on it.

## 2. Cheapest mechanism first
The agent is steered (system prompt section, skill) to use the most precise tool that can do the job, as Claude Code does:
1. a typed MCP tool or plugin for the service (Linear, Home Assistant, Blender);
2. the shell, through `exec` or `terminal`;
3. a typed browser over the accessibility tree, as text;
4. desktop accessibility (`computer_use`, `mode=ax`);
5. screenshots with numbered overlays (`mode=som`);
6. raw pixels and coordinates.

Each step down is slower, costs more tokens (a screenshot is 1,000 to 1,800 input tokens) and is harder to gate. The ledger shows steps and tokens per task, and step, time and cost limits apply.

## 3. Capabilities
One vocabulary covers every tool. The map from tool to capability is data, `plugins/hypotaxis/policy/capabilities.json`: Hermes built-ins by name, MCP servers by `mcp:<server>/<tool>`, and the curated connectors (`docs/CONNECTORS.md`) carry their own map. A tool with no map entry is treated as `app.<server>`, at the most restrictive default.

| Capability | Meaning | Examples | Subject |
|---|---|---|---|
| `web.read` | Navigate and read pages | DevTools or Playwright snapshot; `browser_exec` reading | origin |
| `web.act` | Click, type, submit on a page | typed MCP click/fill tools | origin |
| `web.script` | Arbitrary JS, CDP or Python in a page | `browser_exec`, `browser_cdp`, `evaluate_script`, `browser_run_code_unsafe` | origin; never `always` |
| `web.identity` | Which browser identity runs: `isolated`, `managed-copy`, `live`, `vault-filled` | real-profile copy, `/browser connect`, DevTools `--autoConnect`, Claudezilla attach | teammate |
| `desktop.observe` | Read an app's accessibility tree or a screenshot of it | `computer_use` `capture` | app |
| `desktop.act` | Click, type, key in an app | `computer_use` actions | app |
| `desktop.display` | The whole screen, raw coordinates, input outside any app | `computer_use` on the screen; the portal | each task |
| `app.<server>` | An integration | an MCP server's tools; a plugin's toolset | server and tool, optionally a resource pattern (Home Assistant entity globs) |
| `fs.read`, `fs.write` | Files outside the workspace | Hermes file tools | folder |
| `secret.use` | Fill a vault item | `browser_vault` | item and origin |
| `net.egress` | Hosts a tool may reach | website policy; Playwright `--allowed-origins` | host |

Subjects are exact:
- an **origin** is scheme plus host, with an "include subdomains" switch, re-checked after redirects as the vault does;
- an **app** is its executable path plus its accessibility name, never a bare name;
- a **folder** is home-relative (ADR-0018).

Because `browser_exec` is Python, it is one coarse capability (`web.script`), granted per origin and per session. Where per-action control matters, the agent is given a typed driver instead.

## 4. Grants
- **Scopes:** `once` (this call), `turn` (this task), `session`, or `always` (persisted), each with an optional `expires_at` and `idle_timeout`.
- **Layers only narrow.** The order is hard rules, then hypotaxis policy, then the user's policy, then the teammate's, then the task's. No lower layer can widen a higher one. This is cua's layering, and the existing order of `hypotaxis.policy.check` (deny beats ask beats allow; governed mode can't be widened).
- **Ceilings by app category**, from Claude Code's computer use. Through the desktop route, browsers and trading apps are observe-only; use the typed browser route instead. Terminals and IDEs are click-only, and their grant card warns that the grant is "equivalent to shell access".
- **A project can't grant reach.** A repository's `.hermes/hypotaxis.yaml` can narrow, but it can never grant `web.identity` beyond `isolated`, `desktop.*`, `fs.*` outside the workspace, or `secret.use`. Those are set at user scope only. A repository must not connect the agent to the user's browser or desktop.
- **One teammate = one Hermes profile = one grant set = one browser identity.** Grants never flow between teammates. A delegated subagent gets its parent's grants intersected with its task's scope.
- **Where it's enforced.** Grants are part of the one permission function, `hypotaxis.policy.check`, extended with a capability step. The `pre_tool_call` hook calls it, and so does the exec kernel, because `ctx.dispatch_tool` bypasses hooks (ADR-0005). No second implementation.

## 5. Actions that always need confirmation
A standing grant never covers these, and the card offers no `always`. The list combines Claude in Chrome's always-ask rules, Gemini's policy categories and OpenAI's guidance.

| Class | Examples | Card |
|---|---|---|
| `spend` | purchase, subscription, transfer, trade | approval, hold to approve, amount and merchant shown |
| `send-as-user` | email, chat message, post, comment, invite | approval, hold to approve, full body and recipients shown |
| `delete-irreversible` | delete mail or files, empty the trash, close an account | approval, hold to approve |
| `credential` | typing a password or key, a new login, 2FA | `signin` takeover or the vault, never a field the model sees |
| `download-exec` | download, open or run a file; install an extension | approval |
| `upload-local` | attach a local file to a web form | approval; files whose names look like credentials are refused |
| `authorize` | OAuth consent, permission prompts, terms and consent banners | approval |
| `account-create` | sign-ups | approval |
| `identity-upgrade` | switching to a `live` or `managed-copy` identity | permission |
| `script-injection` | raw JS or CDP on a logged-in origin | permission |

**Never allowed** (policy, not a setting):
- solving or bypassing CAPTCHAs: the run pauses and opens a `signin` takeover instead;
- input aimed at the OS's own security prompts;
- `curl | bash`-style typing, and log-out, lock-screen or force-delete key combinations (Hermes's hard blocks);
- cloud metadata addresses.

**Detection.** Typed tools are classed by name, from the capability map. `browser_exec` and raw CDP can't be classed by their arguments, so v1 relies on:
- origin grants;
- the taint rule (section 7);
- later, network-level interception: CDP `Fetch` events, download events, form-submit hooks.

MCP tool annotations are untrusted (the MCP spec says so). `readOnlyHint` can only loosen a decision for a server the user trusts. It never gets past a deny or a protected class.

## 6. Browser identity
- **Default: isolated.** A throwaway or per-teammate profile.
- **`managed-copy`** (Hermes's real-profile copy) and **`live`** (the user's running browser) are named, revocable, per-teammate grants. They expire, and per-origin grants still apply on top.
  - While either is active, a visible indicator stays on screen.
  - Revoking deletes the copy.
- Every browser card shows which identity it's running under.
- The live route for Chrome is Chrome DevTools MCP with `--autoConnect`. Chrome asks the user for each connection and shows its "automated test software" banner. That consent is Chrome's own, and it's the right experience. Chrome 136 and later refuse remote debugging of the default profile for exactly this reason.

## 7. Untrusted content
Page text, accessibility labels, tab titles, URLs and screenshots are data, never instructions:
1. Content can never create or widen a grant. Cards come only from hypotaxis's own UI, never from a page.
2. **Taint rule:** content can arrive from an origin the user hasn't marked trusted. For the rest of that turn, the outbound classes escalate to ask. Those are `send-as-user`, `upload-local`, `credential`, and navigation to another origin that carries data.
3. The system prompt says it plainly: instructions found in pages or screenshots are not followed.
4. Sensitive values go through the vault, which registers them with redaction.
5. hypotaxis's own window is kept out of the agent's screenshots where the driver allows it **[spike]**, so the model can't read, or be tricked through, its permission cards.

No structural rule makes injection impossible. The vendors' own best published attack-success figures are about 1 to 2%, with model-specific classifiers that hypotaxis can't rely on for an arbitrary model. That's why the defences above are structural.

## 8. How permissions reach the user: forms
Permissions use the forms system (`docs/FORMS.md`), so there's no new component:

| Form kind | Used for |
|---|---|
| `permission` | A new grant. Shows the capability, subject, scope and expiry, plus what the grant would **also** allow. `always` is offered only when the card can show everything it covers. |
| `approval` | One action in a protected class. Shows the inputs before the call, highlights the target origin or app, and never renders model-provided URLs as links. |
| `signin` | A **takeover**, for login, 2FA, CAPTCHA or payment. While the user holds control, the agent can't capture or act: Hermes's control lease, with its epoch, enforces this. Handing back resumes the same session. |

Every card shows its origin (FORMS §4a): which teammate and which model asked, the tool path (`mcp:playwright/browser_click`) and the target. The Bots section lists each teammate's grants, with revoke buttons. A settings page lists them all.

## 9. Ledger
- Every gated tool call is already a `tool.called` event. It gains the extra keys `capability`, `target` (origin, app, or server and tool), `action_class`, `grant_id`, `decision` (`allowed`, `asked`, `denied`, `blocked`) and `lease_epoch`. Arguments stay hashed, never stored.
- Grants get two new event types, which go upstream into contraprova's `HARNESS_EVENT_TYPES` together with `form.*`:
  - `grant.decided`: `grant_id`, `principal` (teammate or model), `capability`, `subject`, `scope`, `expires_at`, `decided_by` (user, policy, preset), `form_id`;
  - `grant.revoked`: `grant_id`, `reason`, `revoked_by`.
  Until then, they're written as `tool.called` with `tool: grant.decided`, as form events are (LEDGER.md).
- The ledger is the source of truth for grants. Hermes's `command_allowlist` is only a mirror, where Hermes's own gate needs one **[spike 1]**.

## 10. Revocation and panic stop
Revoking a grant takes effect at the next policy check, and it also tears down live state:
- the browser daemon for that session stops;
- a managed-copy browser closes and its copy is deleted;
- a live connection (`/browser connect`, DevTools autoConnect, Claudezilla attach) disconnects;
- the cua runtime stops;
- a mirrored `command_allowlist` entry is removed.

The **panic stop** is a global shortcut the app consumes, so a page can't press it. It cancels the turn, revokes every `turn` and `session` grant for automation capabilities, and freezes input.

## 11. Unattended runs
Scheduled teammates and runs with nobody watching may use only `always` grants that have an expiry. Anything that would ask instead joins the card queue and waits. It's never approved automatically. This mirrors Hermes's `cron_mode: deny` and cua's bounded manifests.

## 12. Build order (Linux and Arch first)
**Reuse Hermes first. Add an MCP server only where Hermes has no mechanism.**

| Phase | Integration | Work |
|---|---|---|
| A1 | The capability map, the grant store and the policy capability step; the `permission` and `approval` cards; `grant.*` in the ledger; the revocation and panic-stop wiring | Plugin, host, UI. Covers every tool at once |
| A2 | Hermes `browser_exec` with an isolated Chromium, and `browser_vault` | Per-origin, per-session gating of `web.script`, using the URL literals Hermes already extracts; the identity indicator |
| A3 | Hermes `computer_use` (cua-driver) | Per-app grants and category ceilings over Hermes's per-action keys; an honest Wayland capability note in the card; X11 and XWayland for pixel work |
| A4 | Chrome DevTools MCP (Apache-2.0) for the user's live Chrome | A curated connector entry with `trust: untrusted`, usage statistics off, unwanted tool categories excluded, `evaluate_script` mapped to `web.script` |
| A5 | Firefox | Claudezilla (MIT) for the user's own logged-in Firefox, with `firefox_evaluate` off and every typed tool gated by hypotaxis. Mozilla's firefox-devtools-mcp (MIT, BiDi) for an isolated Firefox. camofox for anti-bot sites, off by default |
| later | Playwright MCP | Only if per-action browser classification proves necessary: typed tools plus `--allowed-origins`. Off by default, with its opt-in capability groups left off |
| later | Windows and macOS | cua-driver already covers UIA and AX through the same Hermes tool, so A1 to A3 carry over. Safari has no logged-in automation except through accessibility |

Connector entries (A4, A5) follow CONNECTORS.md: pinned, verified against the publisher's sources, and with their egress stated. They're added when each phase starts, never with guessed versions.

## 13. Positions on the hard problems
- **Wayland input and capture.** Prefer element actions through AT-SPI. Use X11 or XWayland for pixel work. On native Wayland, the xdg-desktop-portal RemoteDesktop session, with `persist_mode=2`, is the only sanctioned pixel-input route: the compositor's consent dialog is real and revocable. ydotool is never shipped by default (it needs root-level access to `/dev/uinput`, bypasses the compositor's consent, and is AGPL).
- **An agent-owned screen.** A nested or virtual display, so the agent never fights the user for the mouse (Hermes's Bot Screen does this on servers) **[spike 3]**.
- **Logged-in browsers.** Isolated by default. See section 6.
- **Prompt injection.** Structural defences, sections 5 and 7. YOLO-style modes are for disposable machines only, as Hermes and cua say.
- **CAPTCHAs and anti-bot.** hypotaxis doesn't solve them. Cloud browsers and camofox are optional, off by default, and gated as egress to a third party.

## 14. Spikes before A1
1. Can a `pre_tool_call` `approve`, together with the hypotaxis approval transport, answer Hermes's own `computer_use` gate from a hypotaxis grant? The goal is one card per action, not two, with persistence in the ledger instead of `command_allowlist`.
2. On Arch, does `computer_use` capture on native Wayland under GNOME and KDE through `computer_use.native_wayland`, or only through XWayland?
3. Can Hermes's Bot Screen, or a nested display (Xvnc, Xephyr, a headless compositor session), run on the user's own desktop as the agent's screen?
4. Which Chrome DevTools MCP tools carry MCP annotations at run time?
5. The licences and tool lists of camofox, firefox-devtools-mcp, and libei support per compositor.
