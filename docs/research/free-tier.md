# Hermes's free models in boopis: how the Nous free tier works, what `HERMES_DESKTOP` does, and whether we may use it

Date of research: 2026-11-19. Source read: Hermes v0.23.2 (the tag boopis bundles, ADR-0023), unpacked at `harness/vendor-src/hermes-agent-v0.23.2/` (paths below are inside it), and `https://portal.nousresearch.com/terms`, fetched the same day (the page carries no revision date in its text). No call was made to the account service, the welcome host or the inference API; everything here is from source, docs and the Terms page.

Labels: **[V]** verified in source or in the fetched page, **[I]** inference from verified facts, **[?]** not found, so not decided.

---

## 0. Answer first

1. **The free tier is one model for an anonymous identity, not a menu.** Hermes mints an `anon_` credential from Nous's account service, exchanges it for a 15 minute JWT, and sends it to a separate "welcome" host, which serves exactly one model, `nous/welcome`. There is no catalogue, no price and no usage gauge for it. [V] So the governed ladder has one tier at every level (section 6).
2. **Hermes offers it only to the Hermes Desktop app, on a first install, once per OS user.** The claim is refused unless the request comes from a connection that declared itself "the Desktop on this machine", unless nobody on this computer has used Hermes before, and unless no provider and no Nous identity exist yet. [V] A user who has ever run Hermes on this computer will see the choice and be told it is not available. That is Hermes's rule, not ours, and we show it as it is.
3. **`HERMES_DESKTOP=1` is not how Hermes decides any of this, and we must not set it.** Setting it changes the session platform, the toolsets every session gets and the system prompt hint (all fixed at `session.create`, invariant 4), plus ten smaller things (section 3). The free tier keys on a per-connection declaration, `client.capabilities {desktop_local: true}`, on a connection that holds a ticket minted over the gateway's private control socket. boopis already holds such tickets. That is the narrowest correct mechanism and it is what we use. [V]
4. **Terms: unclear. Not decided here.** The Terms cover "the Nous Research Services" and forbid "programs that send them automatic enquiries or requests, unless such program has been made available by Nous Research". Hermes Desktop itself shows a permanent link to those Terms to free-tier users ("Use of Hermes Agent is subject to our Terms of Service and Privacy Policy"). Nothing in the Hermes repository or its docs says whether a third-party distribution of the unmodified Hermes may use the anonymous tier. Quotes and what is missing are in section 5. The owner decides; until then the choice is the default only because it is the zero-configuration path, and the form says whose service it is and links the Terms.

---

## 1. How the free tier works

### 1.1 Identity: `POST /api/anonymous/create` [V]

`hermes_cli/anon_auth.py`. The portal (`https://portal.nousresearch.com`, `DEFAULT_NOUS_PORTAL_URL`; override `HERMES_PORTAL_BASE_URL` or `NOUS_PORTAL_BASE_URL`) answers `{user_id, org_id, token, idle_ttl_days}`. The token, which starts with `anon_`, is shown once (`mint_guest`, line 368). Hermes stores it as the singleton `providers.nous` in the auth store with `auth_method: anonymous`, `account_tier: anonymous`, `client_id: nas-anonymous`, and in the shared Nous store (`_mint_locked`). The credential is written before the first exchange, so a failed exchange never loses a credential the service still honours.

Two kinds of guest exist. A guest made by the first hosted *connector* action serves connectors and managed tools only. A guest stamped with `welcome_claim: true` (`WELCOME_CLAIM_FLAG`) also carries inference (`free_inference_active`). The stamp is written in the mint's own save by the welcome-trial claim, and only that claim carries inference. "Users are never shown the words guest / anonymous / account for this state: surfaces say 'Nous · free tier'" (module docstring); the label is `FREE_TIER_LABEL = "Nous · free tier"`.

An identity is never created as a side effect of reading status, resolving a provider or fetching a bearer (`ensure_portal_identity` docstring). `nous.guest: false` in the config switches guests off.

### 1.2 Who may claim it: `hermes_cli/welcome_trial.py` [V]

The docstring: "The desktop's welcome trial: free inference on `nous/welcome` for a first install, once per OS user. Only the backend the desktop spawned on this machine can claim it, only when this OS user has never used Hermes here (`install_state`), and only with no provider and no Nous identity yet." And: "Enforcement is client-side; the account service's own entitlement check follows separately."

`_CLAIM_BLOCKERS`, cheapest first (each is a reason the claim is refused):

1. "not the desktop's local backend": `anon_auth.on_local_desktop_backend()`, which is `process_identity.serves_local_desktop_now()`, a context variable set for the duration of a request or turn that came from a connection that declared `desktop_local` (section 2).
2. "guests are switched off" (`nous.guest`).
3. "a Nous identity exists" (profile store or shared store).
4. "a provider is configured": the resolver ladder with the free rung hidden (`provider_configured`): an env key, a `model.provider` pin, a sign-in, a host credential.
5. "Hermes was used on this machine" (`install_state.probe()`).

`install_state.py`: "This is product gating, not security: the inference API's limits stop abuse. So it reads only small known files... and treats doubt as 'used'". It looks at every Hermes root the machine names (`~/.hermes*`, channel and package roots, gateway-service homes, the `hermes` launcher's root) and at a machine marker (`$XDG_STATE_HOME/nous-research/.machine` or `~/.local/state/nous-research/.machine`; `~/Library/Application Support/Nous Research/.machine`; `%LOCALAPPDATA%/Nous Research/.machine`) that no Hermes setting can move. Evidence of use is: `onboarding.run: false`, a named profile, a `model.provider` pin other than `auto`, a provider/tool/messaging/skill key in `.env`, a login or guest in `auth.json`, or a message in `state.db`. A claim "that is lost later... is never made again: that user lands on provider setup and sign-in like anyone else."

`claim_desktop_free_tier` takes the OS user's claim lock, re-checks, mints with `welcome_claim=True`, then writes the machine marker.

On the desktop's first boot `latch_first_install()` (`onboarding_run.py`) writes `onboarding.run: true` into the root config and `reserve_trial()` into the marker, so a chat or a key added before onboarding does not cost the user the trial. It runs from `begin_local_desktop_boot` (section 2).

### 1.3 Token mint, keepalive and renewal [V]

- **Exchange:** `POST {portal}/api/anonymous/token {token: anon_..., client: {name: "hermes-agent", version, surface, platform, capabilities: ["browser-v1"]}, purpose: "inference"|"connectors"}` (`exchange_anon_jwt`, line 407). The answer carries `access_token`, `expires_in`, `inference_base_url`. The JWT is the bearer. Lifetimes seen by the keepalive code: "~3594s and ~899s observed"; a comment in `agent/turn_recovery.py` calls it "the 15-minute free-tier JWT". The `client` block "sorts honest clients (which surface, which challenge primitives) for the service's rules; it proves nothing, by design" (`client_info`).
- **Routing:** the JWT goes to the welcome host, `https://welcome-api.nousresearch.com/v1` (`DEFAULT_NOUS_WELCOME_URL`, `WELCOME_HOSTS`). `route_is_welcome_host` is keyed on the resolved endpoint: "the welcome host serves exactly `nous/welcome`". A free-tier JWT sent to the paid host, or a paid credential sent to the welcome host, is refused with a 400 or 403 that Hermes maps to copy and heals where it can (`welcome_route_refusal`, `_recover_welcome_tier`).
- **No keepalive, no refresh token:** `start_nous_auth_keepalive` returns early for a guest ("Nous auth keepalive skipped: free tier has no refresh token", line 220), and `refresh_nous_auth_keepalive_once` returns `False` for a guest "its tokens are minted on demand". The request path re-exchanges the `anon_` credential when the JWT is within 120 s of expiry (`ACCESS_TOKEN_REFRESH_SKEW_SECONDS`, `ensure_usable_access_token`).
- **Renewal limits:** 404 `unknown_token` or any 401 means the credential was reaped or claimed into an account: Hermes retires it and "a new one is set up on next use" (`clear_dead_guest`), but a *trial* guest is not re-claimed, because the machine marker says the trial was used. `idle_ttl_days` (value sent by the service, not in the source) is the idle reap horizon. [?] the number.
- **Failures** (`ANON_*` codes, each with copy and a `retryable` flag): 404 gate closed (terminal), 503 breaker (retry, at least 60 s), 429 with `Retry-After` (wait it out), 428 `pow_*` (proof of work: not implemented, terminal, sign in), 428 `challenge_required` (next section), 403 `signin_required` or `access_denied` (terminal), 403 `account_locked`.

### 1.4 The browser challenge: `hermes_cli/anon_challenge.py` [V]

The service may answer the token exchange with **428 `challenge_required`** and `challenges: [{type: "browser", url, required, expires_in, interval}]`. Hermes implements one primitive, `browser-v1`: "open this portal URL, poll until it clears, exchange again". "Everything the page does (bot detection, an in-browser proof of work, an interactive fallback, its copy) belongs to the portal and changes without a Hermes release."

- The URL must be on the portal origin (`_same_origin`, same scheme and host). `expires_in` is clamped to 30..900 s (default 600), `interval` to 1..5 s, the message to 300 printable characters.
- Hermes polls `POST {portal}/api/anonymous/challenge/status {token}` until the status leaves `pending`/`needs_interaction`, for at most `CHALLENGE_WAIT_SECONDS = 120` or the ticket's life. A 4xx other than 429 ends the wait. The exchange that follows is the authority; a late status never grants anything.
- A second 428 after the wait starts a 30 s fail-fast cooldown (`_GAVE_UP_COOLDOWN_SECONDS`) and surfaces "Finish the quick check in your browser, then try again." (retryable).
- A background caller (the keepalive tick, a catalogue read, a status paint: `background_caller()`) never waits, prints or opens a browser; it only announces the challenge to a desktop client.
- An *optional* challenge (`required: false` on a **successful** exchange: "the service is measuring, not enforcing") is announced to a desktop client only, run hidden, never revealed, never opened in a user's browser.
- **Who opens the URL depends on the surface** (`present`, line 361): the `desktop` surface publishes it (`free_tier.challenge` global event, and the `challenge` field of `free_tier.status`) and opens nothing; the terminal prints it and opens the system browser when there is one; a `gateway` surface (the process holding the messaging gateway's runtime lock) only logs it. So with any other surface than `desktop`, a challenge nobody can see never clears.

### 1.5 What Hermes Desktop does with it (Electron, `apps/desktop/`) [V]

`electron/challenge-window.ts` is "Desktop's whole job": load the page in a **hidden** window, reveal it only if the page asks for a human, close it when the page says it finished. The page talks through its **URL fragment**, readable with no bridge into the page:

| fragment | meaning | window |
|---|---|---|
| `#working` | nothing to show | stays hidden |
| `#interactive` | needs the human | reveal (only when `required`; an optional challenge ends `failed`) |
| `#done` | passed | close (1.5 s linger when it had been revealed) |
| `#failed` | ended without a pass | close (20 s linger when revealed) |

Hardening: sandboxed, context-isolated, own partition (`persist:hermes-challenge`), no permissions, no downloads, no popups, audio muted; navigations *and server redirects* off the portal origin are cancelled; a main-frame commit off the portal ends the run; only `<portal>/challenge...` URLs load, and a phase is read only from a portal URL. Deadlines: 90 s while hidden, the ticket's life (30 s..15 min) once revealed. One window per URL; a settled URL is remembered for 10 minutes (a window the user closed must not come back for the same ticket) except after `timeout` or `error`. It reports `free_tier.challenge_result {url, attempt, outcome}` with outcome `done|failed|closed|timeout|refused|error|unsupported` as "a presentation hint, never a verdict": it wakes the waiting backend to re-mint.

The renderer half (`store/free-tier-challenge.ts`, `gateway-event/free-tier.ts`) is a relay: on the global event `free_tier.challenge` it calls the shell's window, then `free_tier.challenge_result`. It also acts on `free_tier.status.challenge` for a client that connected after the event.

### 1.6 Limits and when they reset [V]

- The welcome host answers a request it will not serve with a structured **429** `{status, message, reason, retry_after, alternates?, upgrade_url?}` (`parse_welcome_refusal`). `reason` is one of `model_not_free`, `feature_not_free`, `at_capacity`, `admission_closed`, `rate_limited` (`WELCOME_REFUSAL_REASONS`). `welcome_refusal_copy` words each ("You've used up the allowance for chatting without signing in. It refreshes in about 5 minutes. Sign in for a bigger allowance, it's free."). **No number of messages or tokens is published anywhere in the source**; the only quantities are `retry_after` and the model's id. [?] allowance size.
- `docs/user-guide/configuration.md` (line 1396): "on the free Nous tier (no sign-in), a session someone is watching ... does not sit through a cooldown longer than 60 s, because the free tier's pause covers the whole service and a retry before the reset only meets the same refusal. The turn ends at once and says when the limit lifts; a configured fallback runs first." (`free_tier_cooldown_ends_turn`.)
- A failed free-tier turn carries `free_tier: {kind, message}`; `agent/error_surface.py` turns that into `error_surface.code = "free_tier_<kind>"` (`rate_limited`, `at_capacity`, `outage` retryable) with `message` and, when the provider named when the limit lifts, `resets_at` (epoch seconds). The desktop's error card offers the sign-in; Hermes "never switches model on its own" (`agent/plan_limits.py`).
- **Usage gauges do not exist for this tier.** `agent/usage_gauges.py` documents the paid *window plans* (`day`, `week`, `month`, `top_tier`; `used_bp` 0..10000, `resets_at_ms`) and says "Free models draw on nothing". For the free-tier identity `billing.state` is "answered locally (`free_tier_account` set, `logged_in` false) without a portal" (`methods_session.py`), the picker row is `free_tier_row` with "the free tier's one model [that] has no Portal pricing and no entitlement to read" (`inventory.py`), and `deriveBillingView` shows "notice + one Sign in, Plan/Model/Connectors summary, no payment or usage rows" (`apps/desktop/src/AGENTS.md`). Gauges arrive in `billing.state.plan_usage`, `model.options[].plan_usage` and the usage frame's `plan_gauge` only for a signed-in plan.

### 1.7 Which models [V]

- **Anonymous free tier: one,** `GUEST_MODEL = "nous/welcome"`. `pin_model_for_route` rewrites any other model to it on the welcome host, "Hermes uses {serves} for now". `free_tier.status.model` reports it.
- A signed-in **Free plan** account has more (`freeRecommendedModels`, `partition_nous_models_by_tier`, `_is_model_free`: zero-priced or subscription-billed rows; the docs' example is `nvidia/nemotron-3-ultra:free`). That needs a Nous Portal OAuth sign-in (a device-code flow in a browser), which the boopis host does not have yet (`docs/FORMS.md`: "the host has no OAuth flow yet"). Out of scope here.
- **OpenRouter `:free` models:** `fetch_openrouter_models` marks a curated row "free" when `pricing.prompt` and `pricing.completion` are zero and hides models without tool support; the key is `OPENROUTER_API_KEY`. OpenRouter keys are free to create; OpenRouter's own rate limits are not reported by Hermes. [?] their size (not looked up).

### 1.8 Plugin boundary [V]

Nothing here is Hermes's public plugin API: the identity and the claim are Hermes internals. The host therefore uses only gateway methods that Hermes publishes in its generated contract (`apps/shared/src/gateway-contract.generated.ts`, vendored in `ui/src/vendor/hermes-shared`) and never edits a Hermes file.

---

## 2. Gateway events and methods a desktop client uses

| name | kind | what it is | boopis |
|---|---|---|---|
| `client.capabilities {desktop_local: true}` | method | "The client is the Desktop app connected to a backend on its own machine. Counted only on a connection that redeemed a native ticket minted over this machine's private control socket." Sets `transport.desktop_local`; on `true` calls `begin_local_desktop_boot()` (latch the install, settle a half claim, start the setup record, compute the onboarding-due answer, once per process). Every later request on that connection runs inside `serving_local_desktop(True)` (`tui_gateway/ws.py::_dispatch_request`), and chats it creates with `source: gui` are marked `desktop_local` so their turns do too (`stage_local_session`, `local_desktop_turn`). | declared by the host, only after the user chose the free tier |
| `free_tier.status` | method | `{has_guest, enabled, available, notice_pending, model, label, error?, error_code?, retryable?, retry_after?, challenge?, nudge_due_in?}`. Zero network, zero side effects. `available`: an identity that carries inference. `enabled`: available, or claimable now. | read by setup and by the plan view |
| `free_tier.provision` | method | The user's retry of a claim: claims when nothing blocks it (`claim_desktop_free_tier(force=True)`). The one network call (`/api/anonymous/create`). | called once, after the user chose |
| `free_tier.challenge` | global event | `{type: "browser", url, required, expires_in, message, attempt}`; also optional challenges after a successful exchange. | handled by the host (hidden window) |
| `free_tier.challenge_result` | method | `{url, attempt, outcome}`, a hint. | sent by the host |
| `free_tier.ack_notice`, `free_tier.claim_nudge` | methods | the one-time notice flag; the "sign in" offer after a finished task. | not used (they offer a Nous sign-in we cannot run) |
| `setup.ready` | global event | `SetupRecord`: `provider_configured`, `inference_provider`, `free_tier_account`, `free_tier_route`, `has_identity`, `other_providers`, `error`, `error_code`, `retryable`, `retry_after`. | not used yet |
| `setup.status`, `setup.runtime_check` | methods | the same record; `free_tier_route` says the selected route is the welcome host. | not used yet |
| `onboarding.state`, `onboarding.start`, `onboarding.set_run` | methods | Hermes Desktop's first run: `start` "starts only in the Desktop app on this machine", sets `onboarding.run: true`, claims, opens an onboarding chat. | not used (setup is ours) |
| `model.options` | method | provider rows: `models`, `pricing[id].free`, `free_tier_row`, `plan_usage.gauges`, `limit {scope, resets_at}`, `usage`. | the catalogue for the OpenRouter choice; the Models plan view |
| `billing.state` | method | for the free tier: `free_tier_account: true`, `free_tier_model`, no usage. | plan view |
| `message.complete.error_surface` | event field | `{layer, code, retryable, resets_at?, usage_limit?, message?}`; free-tier codes `free_tier_rate_limited`, `free_tier_at_capacity`, `free_tier_outage`, `free_tier_model_not_free`, ... | the limit notice |
| usage frame `plan_gauge` | event field | `{id, label, used_bp, resets_at_ms}` for a window plan | shown when present |

Native tickets: `gateway/run_api.py` mints grants with `native_bootstrap: True` for the control socket's `session-ticket`; `local_desktop_client` needs that and `provider: "local"`. The boopis host's `hermes/control.rs` asks that socket, so its connections qualify. A WebSocket from anywhere else (a browser, a remote device) does not.

---

## 3. What `HERMES_DESKTOP=1` does, all of it [V]

Searched every file for `HERMES_DESKTOP` as a whole word (not the `HERMES_DESKTOP_*` family) and for every caller of `is_desktop_owned_backend()`.

**A. The variable alone**

1. `tui_gateway/agent_factory.py::_resolve_session_platform` (line 29): with `HERMES_DESKTOP=1` and no `HERMES_DESKTOP_TERMINAL`, every gateway session's `platform` and `source` is `"desktop"`, not `"tui"`. Consequences: the platform hint in the system prompt changes (the agent "then suggests TUI-only slash commands" otherwise); `_gui_surface_toolsets(platform)` adds `CLIENT_SURFACE_TOOLSETS = {project, desktop_ui, catalog}` (instead of `{project}`) to every session's toolsets. Both are fixed at `session.create`: they change what a governed boopis session is, and the prompt-cache prefix with it (invariant 4). **Unwanted.**
2. `hermes_cli/observability/shared_metrics_consent.py::offer_consent_before_chat` (167): the terminal's one-time shared-metrics offer is skipped ("a Desktop-spawned pane; the app shows its own strip"). We show no strip. Skipping the offer is the safe direction, but it is a decision about telemetry taken by an environment variable. **Unwanted.**
3. `gateway/hosted_room_peer.py::catalog_mapping` (262): `persistent_process` is forced false for a hosted-room catalog ("A Desktop-managed gateway exits with the app"). Not true of our gateway, which "keeps running after you quit". **Unwanted.**

**B. The variable plus a spawn credential (`is_desktop_owned_backend`, `process_identity.py:383`)**

`HERMES_DESKTOP=1` alone is explicitly not ownership proof ("inherited by every shell and agent child the app launches"); the process also needs `HERMES_DASHBOARD_SESSION_TOKEN` in its environment, or a token file on argv for the SSH spawn. Setting both on a gateway would make:

4. `anon_challenge.client_surface()` return `"desktop"` for that whole process, after the per-request check (`serves_local_desktop_now()`) and the gateway-lock check. [V] (the one thing we want).
5. `shared_metrics_setup.web_setup_surface()` name the surface `desktop`.
6. In `hermes serve` / `hermes dashboard` only (a process we do not run): the host-lock role `ROLE_DESKTOP_SERVE`, orphan reaping of desktop serves and MCP helpers, eager MCP discovery, the code-skew self-retirement watchdog, `record_launch_scope(desktop_owned=True)`, the in-process cron ticker (`web_server.py::_start_desktop_cron_ticker`, "the desktop spawns a `hermes dashboard` backend, not a gateway"), stripping `HERMES_WEB_DIST`/`HERMES_SERVE_HEADLESS` from a standalone launch (`main.py::_dashboard_sanitize_desktop_env`), and the loopback auth-gate exemption (`web_server_boundary.py::_desktop_loopback_auth_exempt`, which needs the token too).

**C. Set by Hermes itself:** `gateway_connections_ssh_remote.py` (536) spawns a remote Desktop backend with `env HERMES_DESKTOP=1 hermes serve --isolated ...`.

**Conclusion.** `HERMES_DESKTOP=1` is Electron's "I spawned this backend" flag. The only thing the free tier needs from "desktop" is `client_surface() == "desktop"` for the duration of a request or turn, and that has its own, narrower door: the per-connection `desktop_local` declaration (section 2), which touches only (a) the claim blockers, (b) `client_surface`, (c) a boot that records the install and computes setup records, (d) EC2 metadata lookups being skipped (`auth.py`, "a laptop: no EC2 metadata lookup"). It leaves the session platform, the toolsets and the prompt alone. **boopis sets `desktop_local` on its gateway link only when the user has chosen the free tier, and never sets `HERMES_DESKTOP`.** [I] about (c): `latch_first_install` writes `onboarding.run: true` and the trial reservation into the private Hermes home only when the machine looks fresh, which nothing in boopis reads.

Trade-off, written down: with `desktop_local` the account service sees `client.surface = "desktop"` and `name = "hermes-agent"` from a client that is not Hermes Desktop. The block is self-reported and "proves nothing, by design", but the service cannot tell boopis from Hermes Desktop. Whether Nous means third-party desktop apps to present like this is the question in section 5.

---

## 4. Not patched, nothing set, nothing faked

The host adds no Hermes file, no monkeypatch and no import; it adds one capability declaration and uses published methods. A gateway that does not accept `desktop_local` (an older Hermes) refuses only that call (the contract says so) and the link continues; the free choice then reports it is unavailable.

---

## 5. Do Nous's terms or Hermes's docs allow a third-party distribution to use the free tier?

**Unclear. I did not decide it.** What exists:

**What Hermes says about itself (MIT).** `LICENSE`: "MIT License. Copyright (c) 2025 Nous Research. Permission is hereby granted... to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software". ADR-0023 relies on it to bundle Hermes. The licence covers the *software*. It says nothing about the hosted service the software can call.

**What Hermes Desktop tells free-tier users.** `apps/desktop/src/app/shell/terms-butterbar.tsx`: "Accountless free-tier users get a persistent link to the Terms and Privacy Policy. Not closeable: it stands for as long as they use the free tier." The copy (`en_notices.ts`): "Use of Hermes Agent is subject to our Terms of Service and Privacy Policy." linking `https://portal.nousresearch.com/terms` and `/privacy`. So Nous treats use of the anonymous tier as use of "the Nous Research Services" under those Terms.

**The Terms (`portal.nousresearch.com/terms`, fetched 2026-11-19).** Relevant text, verbatim:

- Preamble: "BY REGISTERING FOR, ACCESSING, BROWSING, AND/OR OTHERWISE USING THE NOUS RESEARCH SERVICES, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS."
- Definition: "Platform: the Nous Portal application; the Nous Inference API; the Nous Forge application; the Nous Research chat interface available at http://hermes.nousresearch.com/ ; and the Nous Research merchandise store". The welcome host `welcome-api.nousresearch.com` is not named. [?]
- 10.1 Prohibited: "use the Nous Research Services or any part or element thereof unless they have agreed to these Terms"; "create Accounts by automated means or using false or misleading information; create, control or use multiple Accounts to obtain additional Free Trials, credits or capacity, to circumvent any Plan, usage or rate limit or any suspension, or for any other purpose Nous Research determines to be abusive; or circumvent or attempt to circumvent any usage limit, rate limit or access control of the Nous Research Services."
- 10.2 "Certain Uses Require Nous Research Consent. You or your Users may not, without Nous Research's prior express written consent...: sell, resell, lease, license, sublicense, distribute, provide, disclose, divulge, exploit or otherwise grant Access or make the Nous Research Services available in whole or in part to any third persons, unless such third person is another authorized User of yours; use the Nous Research Services or any part or element thereof in a scope, with means or for purposes other than those for which their functionality was created; use the Nous Research Services or any part or element thereof by means of programs that send them automatic enquiries or requests, unless such program has been made available by Nous Research;"
- 5.6 Free Trial: "Free Trials and promotional credits are limited to one per person or entity unless we state otherwise. Nous Research may require identity or payment-method verification before granting a Free Trial or credits, and may revoke or reverse any Free Trial, credits or other benefit obtained through multiple Accounts, automated sign-ups or other conduct inconsistent with their intended purpose."
- Limits: "Nous Research may set and change limits on use of the Nous Research Services and may throttle, suspend or restrict access to the Nous Research Services or any Account immediately and without prior notice".
- Changes: "Nous Research reserves the right, at its sole discretion, to change, modify, add, or remove portions of the Terms at any time".

**How this bears on boopis.** [I] Reading 10.2 two ways:

- *Allowed:* boopis ships Nous's own, unmodified Hermes; the program that calls the service "has been made available by Nous Research" (the MIT licence is Nous's own permission to distribute it), and Hermes itself decides when to call (the claim is gated on the Hermes rule "once per OS user, first install").
- *Not allowed / not covered:* the anonymous tier is built for "the Desktop app" (the code says so in a dozen places: "Only the backend the desktop spawned on this machine can claim it"); boopis is a different desktop app distributed by someone else; and by declaring `desktop_local` it presents the surface `desktop`. Section 10.2's "made available by Nous Research" can be read to mean *that app*, not the library.

**What I did not find:** no sentence in the repository, the docs or the Terms that mentions third-party apps, redistributions, rebrands or `desktop_local` in connection with the free tier. The "Plugin Catalogue" clause (13.3) covers plugins, not hosts. `skills/autonomous-ai-agents/hermes-agent/references/portal-auth-for-third-party-apps.md` covers *paid* Portal access by third-party apps and says nothing about the anonymous tier. [?]

**What the code does to keep us inside the part that is clear:** the claim is made only after the user picks it; it is Hermes's own claim path, with its own once-per-OS-user rule (we do not bypass it: no `assume_fresh`, no marker edits, no second identity); we never read or copy the credential; no call is made at build or test time; the choice form names Nous as the provider, links the Terms and Privacy Policy and states that the decision of terms is theirs; the host exposes a single switch in code (`FREE_TIER_ENABLED` in `apps/desktop/src-tauri/src/config.rs`, default `true`) so the owner can make the choice unavailable in a build without touching the rest.

**Recommendation to the owner, not a decision:** ask Nous (the Terms give no contact for this; `hermes-agent.nousresearch.com` and the Nous Discord are where Hermes points) whether a third-party desktop app that bundles Hermes may offer the anonymous tier, and in which surface it should present itself. Until answered, set `FREE_TIER_ENABLED` as you decide.

---

## 6. What this means for boopis

- **Setup:** "Free models (Nous free tier, no account)" is the first choice and the default when no key is present; "OpenRouter free models" asks for an OpenRouter key through a `credential` form, then offers the `:free` rows of the catalogue; the Claude ladder and the other named models stay. Choosing the free tier: the host connects a short-lived link, declares `desktop_local`, reads `free_tier.status`, calls `free_tier.provision` when it says claimable, and reads the status again. If Hermes says it is not claimable (the machine has been used, a provider exists, guests are off) the form says that and offers the other choices. Hermes writes the identity itself; the host writes **no** model config for it ("Never written to config.yaml, so it stops applying the moment the user configures a real model", `trial_model`) beyond the governed ladder.
- **Ladder:** the free tier has one model, so the ladder is one tier of `nous/<model>` where `<model>` is what `free_tier.status` reports at run time, at every level; setup says so. For OpenRouter the ladder is proposed from the catalogue's `:free` rows, ordered by the parameter count that the model id states (`8b`, `70b`), never from a list in the code; ids that state none are offered but not proposed.
- **Challenge:** `free_tier.challenge` reaches the host; a hidden webview window with no capability loads the page; the URL fragment drives reveal and close (1.5); the host reports `free_tier.challenge_result`.
- **Plan:** Settings and Diagnostics show what Hermes reports and nothing else: the plan ("Nous free tier"), the model, `retry_after`/`resets_at` after a refusal, and gauges only where Hermes sends `plan_usage`. For the anonymous tier there are no gauges, and the view says "Hermes reports no usage figures for this plan" rather than inventing a bar.
- **Cost:** the ledger prices from the user's price table; `nous/welcome` has none, so cost reads unknown. The host does not write a zero.
