# Cloud sessions for coding agents: reference research for boopis

Scope: how Claude Code and Codex implement "cloud sessions", which sandbox providers a self-hoster could pick, what Hermes Agent v0.23.2 already offers, and what that means for a boopis "cloud session" next to "local session". Evidence levels: **[doc]** = read from the primary page during this research; **[src]** = read in the local Hermes checkout; **[bg]** = my background knowledge, not re-verified on a primary page (flagged so it can be checked before relying on it). Local Hermes root below: `vendor-src/hermes-agent-v0.23.2/`.

---

## 1. Claude Code on the web / cloud sessions

Primary pages: <https://code.claude.com/docs/en/claude-code-on-the-web>, <https://code.claude.com/docs/en/cloud-environments>, <https://code.claude.com/docs/en/remote-control>, <https://code.claude.com/docs/en/self-hosted-environments>.

### 1.1 What runs where

| Aspect | Finding | Ev. |
|---|---|---|
| Definition | "A cloud session is a Claude Code session that runs on cloud infrastructure instead of on your machine." Default: Anthropic-managed; optionally the org's own **self-hosted environment**. | doc |
| Isolation | "each session runs in an isolated, Anthropic-managed VM." Self-hosted: "isolation is your deployment's responsibility". | doc |
| Resources | Approx. ceilings: **4 vCPU, 16 GB RAM, 30 GB disk**, "may change". VM may kill tasks needing much more memory; for bigger work they point at Remote Control or self-hosted. | doc |
| Lifecycle | "After a few minutes without activity, a session's VM pauses with its files saved. Your next message restores the same VM and starts Claude Code again." A paused VM can later be **reclaimed**; reopening then provisions a **fresh VM**. | doc |
| What survives reclaim | Restored: conversation history. Not restored: background shell commands, subagents, session-scoped schedules/`/loop`. Claude Code tells the model which commands/subagents stopped so it can rerun them. | doc |
| Idle counting | A session waiting for an MCP-connector approval counts as inactive and can expire during the wait. | doc |
| Setup caching | Setup script runs on first session in an environment; if it finishes in about 5 min, Anthropic **snapshots the filesystem** and new sessions start from it. Cache is files only (no processes), rebuilt when script/hosts change and after about 7 days. Setup does not rerun on idle restore. | doc |
| Time limits | Foreground bash 2 min default, up to 10; on timeout the command moves to background and may run 30 more minutes. SessionStart hooks cancel at 600 s. | doc |
| Installed | Docker is available inside the VM (pull images follows the network level); `gh` preinstalled; common toolchains preinstalled, others via setup script. | doc |
| Billing | No separate VM charge; counts against plan usage; shares rate limits with all Claude use. | doc |

Pattern to note: the cloud VM is **pause/restore (snapshot)** for the same session, and **fresh provision + replay of conversation** after reclaim. The transcript lives in Anthropic's backend, not on the VM; only files + git state live on the VM.

### 1.2 Repo checkout and push

- "Cloud sessions start from a fresh clone of your repository." `claude --cloud` clones the GitHub remote at the **current branch from the remote**, not the local checkout (push first). **[doc]**
- Fallback "bundle" path: if there is no remote or the GitHub App is not installed, the CLI **uploads a git bundle** (all history + uncommitted changes to tracked files; <100 MB, else current branch only, else squashed snapshot). On macOS/Linux/WSL it excludes uncommitted changes to `.env`, `*.tfvars`, `id_rsa`, `*.pem`, LFS-filtered files; native Windows uploads them as-is. Needs git >= 2.31. Bundled sessions push back only if the GitHub connection has push access. **[doc]**
- Auth options: **GitHub App** (private repos where installed; enables Auto-fix) or `/web-setup` (sends the local `gh` token to the account). "your GitHub credentials stay encrypted on Anthropic's servers and never enter a session's VM." **[doc]**
- **GitHub proxy**: "all GitHub operations go through a dedicated proxy that keeps your real GitHub credentials outside the session's VM." The VM's git client holds a **scoped credential**; the proxy verifies it and swaps it for the real token. `GH_TOKEN`/`GITHUB_TOKEN` read as the placeholder `proxy-injected`. Proxy **rejects branch deletion and pushes of non-branches (tags)**, does not restrict which branch is updated (use GitHub branch protection), serves API only for repos attached to the session (403 otherwise), and **blocks GraphQL** (so `gh pr`/`gh issue` fail; `gh api` REST works). **[doc]**
- PRs: created from the web UI Changes card, or by Claude via built-in GitHub tools / `gh api`. **Auto-fix**: Claude subscribes to PR webhooks (CI failures, review comments) via the GitHub App and pushes fixes; replies are posted under the user's account but labelled as Claude Code. No webhook exists for base-branch conflicts. **[doc]**
- Non-GitHub hosts: not supported for clone/PR in Anthropic-hosted envs (bundle only, no push back); self-hosted envs can use other hosts via `--environment` dispatch. **[doc]**

### 1.3 Network

| Level | Behaviour | Ev. |
|---|---|---|
| None | No outbound through the session network (Anthropic API still reachable for Claude Code itself; docs warn this "may allow data to exit the VM"). | doc |
| Limited (default) | Default allowlist (package registries, GitHub, cloud SDKs, Docker Hub) while "Allow package managers" is on, plus user domains (`*.` wildcard allowed, one per line). | doc |
| Full | Any domain. | doc |

- All outbound traffic runs through an HTTP/HTTPS **security proxy**; level changes reach running sessions "within about a minute". No org-wide allowlist push; each environment has its own list. **[doc]**
- **Network secrets** (Anthropic-hosted only): API key stored on the environment, **"Anthropic's agent proxy adds the key to requests for the hosts you list, after each request leaves the session's VM, so the key itself stays outside the VM."** Secret types: bearer/custom header, username+password. Never injected for: GitHub (own proxy), `api.anthropic.com`, public registries (npm, jsr, pypi, crates, Go proxy), setup-script requests (proxy is attached only when Claude Code launches, after setup), telemetry export. Hosts listed on a secret become reachable even if the level would block them. Self-hosted environments have no network secrets. **[doc]**
- Plain environment variables are readable by everyone who uses the environment (docs say not to put secrets there). **[doc]**

### 1.4 Environments (config objects)

- An environment = **name + network level/allowlist + env vars (`.env` format) + setup script** (+ network secrets). Same environments apply across web, mobile, Desktop, `--cloud`, scheduled tasks, Claude Tag. **[doc]**
- **Personal** (listed under "Personal") vs **Organization** (Owner-created or a personal environment shared via "Who can use it"; keeps its ID). Org default environment set in admin settings; shared envs open read-only for members; Owners alone manage secrets on them. **[doc]**
- Repo config comes from the clone (`CLAUDE.md`, `.claude/settings.json` hooks/permissions, skills, agents, rules); user-level `~/.claude` does not travel (a setup script can write `~/.claude/CLAUDE.md`). Plugins declared in repo settings are not installed. Org policy arrives via server-managed settings at session start. **[doc]**
- Setup script vs SessionStart hook: script provisions the VM (cached); hook is for per-repo setup that should run everywhere. **[doc]**

### 1.5 Sessions, sharing, multi-device UX

- Sessions list at claude.ai/code, phone Code tab, Desktop app "Cloud" selector, CLI. The session keeps running when the laptop closes; steer it from any device. **[doc]**
- Transcript is stored server-side; reopening restores history. Auto-compaction applies; teleport copies only the post-compaction summary + later messages. **[doc]**
- Messages sent mid-turn queue (can be withdrawn before read). `claude -p "msg" --cloud <session-id>` **posts one follow-up** to an existing session from any machine, no local state sent (usable from CI). **[doc]**
- Sharing: Team = Private/Team; Pro/Max = Private/Public; recipients see the latest state, **not real-time**; optional repo-access verification. Archive / delete (delete is permanent). **[doc]**
- Diff view built from raw git blob content, inline comments sent with the next message, compare against any branch. **[doc]**
- Scheduled and triggered runs ("routines": schedule, API call, GitHub event) each run as a cloud session. **[doc, linked page not read]**

### 1.6 Remote Control (local session driven from web/phone)

- Direction is **opposite** to cloud: Claude Code keeps running **on the user's machine**; claude.ai/code or the mobile app is a remote UI. "Your local Claude Code session makes outbound HTTPS requests only and never opens inbound ports." It registers with the Anthropic API and **polls for work**; the server routes messages between clients and the local process over a streaming connection. Short-lived, single-purpose credentials. **[doc]**
- Transcript is stored on Anthropic servers while connected so devices stay in sync and the session reconnects after drops; execution and filesystem stay local. Reconnects automatically after sleep/network loss; server mode gives up after ~10 min offline. **[doc]**
- Modes: `claude remote-control` (**server mode**, up to `--capacity` 32 concurrent sessions, `--spawn same-dir|worktree|session`), `claude --remote-control` (interactive + remote), `/remote-control` in a running session (CLI, Desktop, VS Code). QR code / URL to attach a phone. Push notifications to the phone. **[doc]**
- Enterprise gating: trusted-device enrolment (credential per browser/phone, step-up auth, revocable at claude.ai/settings/account); `disableRemoteControl` setting; not available under ZDR/HIPAA. **[doc]**
- "Cloud session reaches your own computer": the cloud docs name Remote Control as the escape hatch for workloads beyond the VM (run on your hardware). In this very session's tool list there is also a "request a folder on the user's computer served through Remote Control" capability (`list_computer_folders` / `request_computer_folder`): a cloud session asks the user (approval card on a trusted device) to attach one folder/computer, after which Bash/Read/Edit run there via `_host`. That is observed from the tool surface, not from a doc page. **[observed]**

### 1.7 Handoff

| Direction | Mechanism | Ev. |
|---|---|---|
| Local -> cloud (new) | `claude --cloud "task"` (old `--remote` is a deprecated alias): new session from the pushed branch or a bundle. Not a transfer of the live local session. | doc |
| Local -> cloud (Desktop) | Desktop "Open in" menu can send a local Code-tab session to cloud. | doc |
| Cloud -> local | `claude --teleport [id]`, `/teleport`, `/tasks` then `t`, "Open in > Terminal". Requires clean git state (offers stash), **same repo (not a fork)**, branch pushed, same claude.ai account. Fetches and checks out the session's branch and loads the conversation. | doc |
| After teleport | The terminal gets **its own copy**: new local work does not appear in the cloud session; run `/remote-control` to keep driving it from the phone. Teleport rides the same Remote Control session infra (errors say "Remote Control session expired"). | doc |

Takeaway: handoff is **git branch + transcript copy**, not process migration. One-way from the CLI by design.

### 1.8 Security model (summary)

VM per session; egress proxy with allowlist; **credentials never in the VM** (git via GitHub proxy with scoped token, API keys via network secrets, Claude's own token session-scoped); push restrictions at the proxy; org policy via server-managed settings; prompt-injection exposure bounded by network level; sharing warns that transcripts may contain private-repo code; unavailable under ZDR/HIPAA/CMEK. Self-hosted: runner is outbound-only ("Anthropic never connects into your network"), polls a queue, lease lapses ~60 s, one **owner per runner** (locks to the first session's owner; exits when sessions finish so the orchestrator restarts it with a fresh disk), `--retire-at` for hosts that die on a timer. **[doc]**

### 1.9 Self-hosted environment architecture (most relevant to a self-hoster)

Three parts: **environment** (named queue in the control plane), **runner** (long-lived process in your network that polls, claims a session under a lease, **clones the repo, spawns a child Claude Code process**), **session**. The child streams events to `api.anthropic.com`; the control plane (queue, claude.ai UI, transcript store) stays hosted by Anthropic. Everything is outbound; autoscaling orchestrator starts runners as sessions queue. Repos/secrets/artifacts stay on your machines; the conversation goes to Anthropic. **[doc]** This is the closest published design to option (a) below, with the difference that the control plane is theirs.

---

## 2. OpenAI Codex cloud (brief; differences)

Primary pages (redirected from developers.openai.com/codex/cloud/* to learn.chatgpt.com): <https://learn.chatgpt.com/docs/cloud>, <https://learn.chatgpt.com/docs/environments/cloud-environment>, <https://learn.chatgpt.com/docs/cloud/internet-access>. Note: the pages I could read are labelled **"Codex Cloud (Legacy)"**, so details may have moved; treat as indicative.

| Topic | Codex cloud | Compared with Claude Code |
|---|---|---|
| Unit | A **task** with its own workspace; "can keep working while your computer is asleep"; parallel tasks from one environment. Follow-ups in the same chat. | Same idea; Claude adds a persistent, steerable session, teleport and PR auto-fix. |
| Container | Default image **`universal`** (common languages/tools; runtime versions pinnable). | Claude: VM with a fixed preinstalled set. |
| Scripts | **Setup script** at container creation (separate Bash session, `export` does not carry over) + optional **maintenance script** when a cached container resumes. | Claude has setup script + repo SessionStart hooks; no separate maintenance script. |
| Cache | Container state cached "up to **12 hours**"; invalidated by script/env/secret changes; Business/Enterprise caches shared across users. | Claude: filesystem snapshot, ~5 min build cap, ~7 day expiry. |
| Secrets | Env vars last the whole chat. **Secrets are available only to setup scripts and are removed before the agent phase starts.** | Differs: Codex hides secrets from the agent by **removing** them; Claude keeps them out by **injecting at the proxy**, so the agent can still *use* them. |
| Internet | **Off by default for the agent phase**; setup phase has internet. Per environment: Off / On with allowlist preset (None, Common dependencies, All) and optional **HTTP-method limit** (GET/HEAD/OPTIONS only). All traffic via an HTTP/HTTPS proxy. Page lists prompt injection, exfiltration, malware as risks. | Claude: Limited by default (registries allowed), None/Limited/Full, no method filter documented. Method filtering is a cheap, useful extra. |
| Repo | Environments select which repos Codex may access (GitHub; page also mentions GitLab); commit or open a PR from review. Branch naming not documented on the page I read. | Similar. |
| CLI | `codex cloud` starts a task from the terminal and lists recent cloud chats. `exec`/`apply` not covered on the page read. | Claude: `--cloud`, `--teleport`, follow-up posting. |
| Mobile | Start/continue from mobile; review from web/mobile/desktop. | Same. |

Not found on the readable pages: VM vs container wording, resource caps, idle timeout, sandbox-lifecycle details (the page links to "Sandbox lifecycle" pages not fetched).

---

## 3. Infrastructure layer a self-hoster could pick

Verified-from-source facts are marked; everything else is flagged [bg] when I did not confirm it on a primary page. Verify numbers and prices before committing.

| Provider | Isolation | Cold start | Persistence | Pricing (one line) | create / exec / stop / snapshot | Long-lived + ports |
|---|---|---|---|---|---|---|
| **E2B** (<https://docs.e2b.dev/docs/sandbox>, <https://github.com/e2b-dev/infra>) | **Firecracker microVM** per sandbox, own cgroup + netns (infra README) [doc]. Open source, Apache-2.0, Go. | ~150 ms [bg] | Timeout 1 h Hobby / **24 h Pro**; on timeout can auto-**pause** keeping state "indefinitely" [doc]. Snapshots/templates [bg]. | Per-second usage by vCPU/RAM [bg]; self-host "Embed" on one KVM host free, multi-node = Enterprise [doc] | `Sandbox.create(timeout)`, `kill()`, `set_timeout()`, `get_info()` [doc]; `commands.run`, pause/resume [bg]. In-VM `envd` API for processes, files, ports [doc] | Yes up to 24 h, then pause/resume. Ports through a client proxy that routes sandbox URLs [doc]. |
| **Daytona** (<https://www.daytona.io/docs/en/sandboxes>) | Linux **containers** by default, "own kernel, filesystem, network stack" per page text; also **VM sandboxes** (Linux/Windows), GPU, macOS [doc]. | Container "<90 ms" [doc] | start/stop/**archive**, pause/resume + **fork** (VM), auto-stop/archive/delete, TTL or run indefinitely; VM snapshots [doc]. Hermes uses stop/resume for persistence [src]. | Per vCPU/RAM/disk time [bg, page lacked pricing] | `daytona.create(snapshot, resources, env, region)`; SDKs Py/TS/Ruby/Go/Java + CLI + REST [doc]; process API for exec [doc, details not read] | Yes ("Running indefinitely"); preview URLs exist, page not read. |
| **Modal Sandboxes** (<https://modal.com/docs/guide/sandboxes>) | **gVisor** by default; optional **VM runtime** with own kernel (Docker, FUSE) [doc] | Not stated [doc]; fast, seconds [bg] | Default lifetime 5 min, max **24 h**; **filesystem snapshots** to carry state past it; no memory snapshots on that page [doc] | Billed `max(requested, actual)` CPU/mem [doc] | `Sandbox.create`, `sb.exec(...)`, `from_id` reattach, snapshot, terminate [doc] | Yes up to 24 h; **Tunnels** for ports (TCP activity counts as non-idle) [doc]. Hermes has a native Modal backend [src]. |
| **Fly Machines** (<https://docs.fly.io/machines/overview>) | Firecracker-based VMs [bg, page did not say] | Start of a stopped Machine "well under a second"; create "low double-digit seconds" [doc] | Ephemeral rootfs resets each boot; attach **volumes** for persistence [doc]; suspend/snapshot [bg] | Per-second VM time while running + volume GB [bg] | Machines REST API create/stop/start; exec endpoint [bg, not on page]; `fly machine run` [doc] | Yes (a Machine is a long-lived VM); public ports via Fly proxy/services [bg]; static egress IPs [doc]. A Hermes "sprites" plugin targets Fly [src]. |
| **Cloudflare Sandbox SDK / Containers** (<https://developers.cloudflare.com/sandbox/>) | Containers "run each instance as a microVM with its own kernel and network" [doc]; Durable Object fronts each sandbox [bg] | Not stated | **State exists only while the container is active**; files in `/workspace`, `/tmp`, `/home` are lost on stop; backups/restore API exists [doc] | Workers Paid plan + container usage [doc: linked pages, no figures] | `getSandbox(id)` (created on first reference), `exec`, `exposePort`, backups [partly doc: exec/lifetime shown, exposePort not] | `sleepAfter` default **10 min** idle, `keepAlive: true` heartbeats every 30 s [doc]; port exposure via preview URLs [bg]. |
| **GitHub Codespaces** (<https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces>) | Docker container on a GitHub-hosted VM, "limited access to the outer VM" [doc] | ~tens of seconds, prebuilds cut it [bg] | Idle timeout default **30 min**, settable 5-240 min; hard cap **12 h** total [doc]; retention days [bg] | Free monthly quota then per-core-hour + storage, billed monthly to user/org [doc] | REST API create/stop/delete [bg]; `gh codespace` CLI [bg] | Yes while active; **port forwarding** with visibility settings [bg]. Devcontainer config as the environment definition [doc]. No self-hosting. |
| **Plain Docker / Firecracker on a VPS** | Docker: namespaces + cgroups (Hermes hardens with cap-drop ALL, no-new-privileges, PID limits [src]). Firecracker: KVM microVM, needs bare metal or nested virt [bg]. | Docker ~1 s; Firecracker ~125 ms boot [bg] | Whatever you build: bind mounts, `docker commit`, Firecracker snapshot/restore [bg] | Fixed VPS price | Docker API/CLI; Firecracker REST over a unix socket [bg] | Yes, ports via published ports + reverse proxy / Tailscale. Cheapest, most work, you own egress. |
| **Coder** (<https://github.com/coder/coder>) | Whatever the Terraform template provisions: VM, Kubernetes pod, Docker container [doc]. Self-hosted, AGPL-3.0 [doc]. | Template-dependent | Workspace start/stop with autostop [bg] | Free OSS; paid enterprise tier [bg] | CLI + REST API; templates = Terraform [doc] | Yes; built-in port forwarding/apps [bg]. Page says it ships a native agent whose loop runs in the **control plane** so "no API keys are needed in workspaces" [doc]: same idea as the agent-outside-the-sandbox model. |
| **Ona (ex-Gitpod)** (<https://ona.com/docs/ona/runners/aws/setup>) | Environments on **runners deployed in your AWS VPC or GCP project** (EC2 / Compute Engine instances); code and credentials stay in your infra [doc, search summary] | Not read | Dev-container based [bg] | Per-seat/usage [bg] | Runner-based; API reference has `runners` resources [doc, search] | Yes. Caveat: one third-party page says Ona Cloud shut down in Oct 2026 and Ona is part of OpenAI; **unverified competitor claim**, check before depending on it. |

Pick guide for a self-hoster: **E2B (Apache-2.0, Firecracker, 24 h, pause/resume, self-hostable)** or **plain VPS with Firecracker/Docker** give full control and an open stack; **Modal/Daytona** are the easiest hosted APIs with snapshots and tunnels (and already have Hermes backends); **Coder** is the best "bring your own infra + Terraform" option; **Cloudflare** fits only if the whole stack is Workers-shaped (state is lost on stop); **Codespaces/Ona** are dev-environment products, not agent-session sandboxes.

---

## 4. Hermes Agent's own remote capabilities (v0.23.2, local checkout)

### 4.1 Terminal environments move **only tool execution**

`website/docs/user-guide/configuration.md` [src]: "Each [backend] determines where the agent's shell commands actually execute." `tools/environments/` has `local, docker, ssh, modal, managed_modal, daytona, vercel_sandbox` over a shared `BaseEnvironment` (`base.py`): "spawn-per-call: every command spawns a fresh `bash -c`", session env/cwd snapshot re-sourced per call, in-band cwd markers, `file_sync.py` to push cache/skill files into remote backends and sync back, `LongLivedProcessMixin`, and `sandbox_conformance.py`. Third-party backends plug in via `TerminalEnvironmentProvider` (`create_environment()`, `is_remote`, `is_container`, `strip_env_keys`, ...) selected by `terminal.backend` (`developer-guide/terminal-environment-plugin.md`). Official plugins: Singularity, **Sprites (Fly)**.

Properties:
- The **agent loop, LLM calls, state DB (`state.db`), memory, config and keys stay on the host**. Only `terminal`, `execute_code` and file tools run in the sandbox; Desktop/browser/computer_use can follow the terminal via `supports_streams`.
- Persistence: Docker `container_persistent` (default true; one shared container per profile); Modal stores snapshot ids in `modal_snapshots.json`; Daytona stops/resumes; Vercel Sandbox restores task-scoped snapshots [src].
- **Keys do reach the sandbox** unless the egress proxy is on: the docs' own threat model says a prompt-injected agent "can `printenv | grep -i key`".
- **Egress credential-injection proxy** (`hermes egress`, iron-proxy, Apache-2.0 Go): sandbox gets opaque proxy tokens and a trusted local CA; the proxy MITM-terminates TLS and swaps tokens for real keys per allowed host. **Wired to the Docker backend only**; Modal, Daytona, SSH, Singularity "do not receive proxy env vars or CA mounts yet" (`user-guide/egress/iron-proxy.md`). Same pattern as Claude's agent proxy.

### 4.2 Running a whole gateway in a container (reusable today)

`user-guide/docker.md` [src]: official image `nousresearch/hermes-agent`, state in a mounted volume (`-v ~/.hermes:/opt/data`), `gateway run` supervised by **s6-overlay** (restart on crash), optional supervised **dashboard** (`HERMES_DASHBOARD=1`, port 9119, binds `0.0.0.0` in-container) and OpenAI-compatible **API server** (`API_SERVER_ENABLED`, port 8642, `API_SERVER_HOST=0.0.0.0` + `API_SERVER_KEY` >= 8 chars). This is exactly "a whole Hermes inside a container".

**Auth for remote exposure**: a non-loopback bind **always requires an auth provider; the dashboard fails closed at startup** otherwise ("HERMES_DASHBOARD_INSECURE" is a deprecated no-op after a June 2026 campaign that used exposed dashboards to plant SSH backdoors). Providers: username/password (trusted network/VPN only), Nous Portal OAuth, **self-hosted OIDC** (`HERMES_DASHBOARD_OIDC_ISSUER` + client id), plus a **deployment session token** (`HERMES_DASHBOARD_SESSION_TOKEN`, sent as bearer, `X-Hermes-Session-Token`, or on the URL) for token-only deployments. Docs recommend SSH tunnel / Tailscale / VPN rather than raw internet exposure (`user-guide/desktop.md`, `docker.md`).

### 4.3 Desktop app remote connections

`user-guide/multi-connection-desktop.md`, `apps/desktop/src/AGENTS.md` [src]: Settings > Gateways registry with four kinds:

| Kind | What | Auth |
|---|---|---|
| Local | App-managed; `hermes gateway ensure --json`, ticketed WebSocket; the app never owns the PID, gateway has no idle shutdown | automatic |
| Remote gateway | URL of a running `hermes serve` (LAN/Tailscale/internet), reverse-proxy prefixes OK | session token or OAuth |
| SSH | App opens a tunnel, starts the dashboard, adopts a token; client contract = `hermes gateway attach --json` + `hermes gateway tickets --serve` (single-use tickets, 30 s expiry) | SSH key + adopted token |
| Hermes Cloud | Hosted instance discovered through portal sign-in | portal sign-in |

Behaviour: every registered gateway stays connected (redial every 30 s); sessions, profiles, memory live on the owning gateway; sidebar is gateway > profile > sessions; "**Test** probes HTTP and WebSocket legs"; the app "never spawns or reaps a remote gateway"; SSH-started `hermes serve` stops after an idle grace (`dashboard.ssh_isolated_idle_grace_s`, 15 min). Protocol: JSON-RPC over WebSocket `/api/ws`, `hermes-gateway-v1`, shared client `@hermes/shared/gateway-client` with a `connect(start, recover)` callback that re-runs on every reconnect since tickets are one-use (`developer-guide/programmatic-integration.md`). The gateway is "one multiplexing owner per home" serving several profiles.

### 4.4 Hermes Cloud, backup, remote-config

- **Hermes Cloud** (Nous-run hosted agents): "Transfer to Hermes Cloud" in Settings > Backup & Transfer **replaces a cloud agent with your local one**: `hermes backup` zip, chunked copy, cloud side runs `hermes import --keep-host --messaging-off`, takes an **undo point** first (`user-guide/backup-and-transfer.md`). Messaging bots arrive switched off (a bot token can only be used by one running Hermes). Cloud keeps its own portal sign-in, model, tools, scheduler. Desktop cannot create cloud agents yet. This is a **handoff primitive (whole-home snapshot transfer)**, and the cloud agent is a Docker image run by Nous (the CLI doc says `--keep-host` "inside the Docker image (Hermes Cloud) pauses and restarts the gateway itself").
- **`hermes backup`**: whole Hermes home (all profiles, memory, SOUL, skills, conversations, cron, settings, **`.env` and `auth.json`**); restore with `hermes import <zip>`; "Keep it private." Never removes the target's workspace/`.ssh`/`.gitconfig`/`.config`.
- **Remote config** (`user-guide/remote-config.md`): `HERMES_CONFIG_BACKEND=remote` swaps `config.yaml` for a config plane layered global > tenant > group > owner > agent > profile, with admin-locked keys; fails closed after ~30 s; polls every 5 min; on-prem uses OAuth2 client-credentials (`GATEWAY_RELAY_IDP_*`). Fleet feature, not needed for single-user.
- Also relevant: `developer-guide/relay-connector-contract.md`, `managed-scope.md`, `session-storage.md` (not read in depth), `multiplexing-gateway.md`.
- **Not found**: any Hermes component that **provisions** a container or sandbox for a whole gateway from a repo and environment definition. Hermes Cloud provisioning lives in Nous Portal (closed). A self-hoster has to supply that layer.

### 4.5 What a self-hoster can reuse to run a whole gateway in a cloud container and attach the desktop app

Reusable as-is: official Docker image + s6 supervision; `hermes serve`/dashboard with OIDC or session token; Desktop "Remote gateway" and "SSH" connection kinds (including the single-use ticket protocol); `hermes backup/import --keep-host` and the undo-point idea for handoff; iron-proxy egress pattern (Docker only today); `TerminalEnvironmentProvider` and `sandbox_conformance.py` if you also want per-command sandboxes; multiplexing gateway (many profiles in one process, so one container could host a session per profile).
Gaps: nothing creates/stops sandboxes or maps "environment definitions"; egress proxy not available inside Modal/Daytona/SSH; no git credential brokering; no external transcript store (state.db is local to the home volume); no pause/idle-reclaim policy for remote gateways beyond the SSH idle grace.

---

## 5. Design implications for boopis

### 5.1 The two candidate architectures

| | (a) Cloud session = whole gateway + plugin + hx in an ephemeral sandbox | (b) Hermes terminal environments (tools-only remote) |
|---|---|---|
| Where the agent loop runs | In the sandbox, next to the repo | On the user's host; only shell/file calls go remote |
| Laptop closed | Keeps running (the defining cloud-session property) | **Stops**; the loop dies with the host |
| Latency per tool call | Local (ms) | One network hop each; `file_sync` push/pull |
| Secrets | Must be mediated (proxy) because the whole agent holds provider keys | LLM keys stay on host; only tool-visible keys are at risk (strip via `strip_env_keys`; Docker egress proxy only) |
| Multi-device attach | Native: devices dial the gateway (Desktop remote/SSH kinds exist) | Only the host is reachable; phone/web needs the host online |
| Persistence/transcripts | Lives where the gateway lives; needs a durable external store to survive reclaim | Already on the host |
| Work to build | High (provisioning, auth, egress, store, handoff) | Low (config switch; providers exist) |
| Matches Claude Code/Codex cloud | Yes | No; it is closer to Codex-style sandboxed tools or "run commands on a dev box" |

(b) cannot honestly be sold as "cloud session": it gives isolation and remote compute but not detachment from the user's machine. It remains a good **companion** (a "sandboxed local session" mode), cheap to expose as a setting.

### 5.2 Recommendation

**Build (a), and keep (b) as a separate "remote tools" toggle.** Concretely: a cloud session is a sandbox running the standard Hermes image with boopis plugin and hx baked in, repo cloned in, Hermes **`gateway run` + `serve`** supervised, and the desktop app attaching through the existing **Remote gateway / SSH** connection kinds. Reasons: it is the only design that delivers Claude-Code-style semantics (keeps running offline, attach from any device, reclaim/restore), Hermes already has the container, supervisor, auth gate and remote-attach client, and the Claude self-hosted-runner model shows the shape works with a thin control layer. Start with **one sandbox provider (Docker on a VPS, or E2B/Modal) behind an abstraction**, not many.

### 5.3 Components needed

| Component | What it does | Reuse / note |
|---|---|---|
| **Environment definition** | Name, image, setup script (cached via sandbox snapshot), env vars, allowed hosts / network level (none/limited/full + method filter), secret references, size, idle/max lifetime. Personal vs shared scopes if teams matter. | Copy Claude's schema; Codex's maintenance script and HTTP-method filter are cheap adds. Store in repo-independent user config. |
| **Sandbox provider abstraction** | `create(env, repo) -> id`, `exec`, `stop/pause`, `snapshot`, `restore`, `expose(port) -> url`, `destroy`, health, TTL refresh. Adapters: Docker-on-VPS first; then E2B (Apache-2.0, self-hostable) and Modal/Daytona. | Hermes terminal providers are the wrong interface (per-command), but Modal/Daytona/Vercel SDK code in `tools/environments/` is a useful reference for snapshot handling. |
| **Credential-injecting egress proxy** | Sandbox holds opaque tokens; proxy swaps them per host after TLS termination; allowlist + method filter; never inject for the model API on setup phase etc. | Extend **iron-proxy** (already integrated for Docker) to be sandbox-agnostic: run it at the provider boundary (VPS host or sidecar) and point `HTTPS_PROXY` + CA into any sandbox. Mirror Claude's exclusions. |
| **Model access without keys in the sandbox** | The whole agent runs in the sandbox, so its LLM key is the first thing to protect: route inference through the proxy (token swap) or a thin relay. | Hermes `relay-connector-contract` and plugin LLM access might help; unverified. Coder's "agent loop in the control plane" is the opposite choice (see 5.4). |
| **Session store (transcripts, ledgers)** | Durable store outside the sandbox: state.db snapshots/WAL shipping, or event log, plus hx/plugin ledgers; enables reconnect after reclaim and viewing without a live VM. | Hermes `state.db` is a local SQLite on the home volume; either keep the home on a **persistent volume** (Fly volume, Daytona archive, E2B pause) or ship periodic `hermes backup` and restore into a fresh sandbox. Claude stores transcript server-side and replays; compaction limits what teleports. |
| **Git push path** | Repo cloned in with a **scoped, short-lived credential**; push goes through a git proxy that holds the real token, allows branch pushes only, denies deletes and tags, restricts to attached repos. Branch naming rule (e.g. `hx/<session>`), PR creation via REST (avoid GraphQL), optional PR watcher. | Reproduce Claude's GitHub proxy: tiny HTTP smart-protocol proxy or GitHub App installation tokens minted per session. |
| **Remote attach and auth** | Sandbox exposes `serve` via a tunnel/URL; Desktop registers it as a Remote gateway with a per-session token or OIDC; WebSocket tickets are one-use. Prefer **outbound-only** from the sandbox (reverse tunnel to a relay) so no inbound port is public. | Reuse Hermes auth gate and `@hermes/shared` client; bind non-loopback only with a provider. Claude Remote Control and self-hosted runners both use outbound polling/streaming through a broker; copy that if devices should attach without public ports. |
| **Lifecycle manager** | Provision-time checklist UI (clone, setup, ready), queue messages during boot, idle pause, reclaim, restore, TTL, cost caps, "environment expired" UX that tells the model which background jobs died. | Claude's UX is the template. |
| **Handoff** | local -> cloud: new session from pushed branch or a bundle of the working tree (strip `.env`/keys) + optionally the transcript. cloud -> local: checkout branch, import transcript, **fork not share** (Claude's teleport semantics). Optional whole-agent move using `hermes backup` / `import --keep-host` with an undo point. | Document that handoff moves **git state + conversation**, not processes. |
| **Local-session remote control** (optional, later) | Drive a local session from phone/web via an outbound relay, as Claude Remote Control does. | Separate feature from cloud sessions; same attach protocol. |

### 5.4 Hard problems and risks

1. **Secrets inside a whole-agent sandbox.** Anything the agent can read, a prompt-injected agent can exfiltrate. Needs: proxy injection for API keys and git, model-key relaying, no `.env`/`auth.json` copied in (note `hermes backup` includes them: handoff by backup would ship every key, so it must be scrubbed or re-brokered), and a tight default egress (Codex defaults agent internet **off**; Claude defaults Limited). Also, secrets not injectable (non-HTTP protocols, tools pinning certs, non-proxy-aware binaries) will break or leak: Claude's own list of never-injected hosts shows this.
2. **State durability and reclaim.** Ephemeral sandboxes lose background processes; Cloudflare loses all files on stop; E2B/Fly need explicit pause/volumes. Decide the source of truth (external transcript store vs persistent volume) early; Hermes' SQLite + WAL on a network volume or after pause/restore is a corruption risk (see `state-db-recovery.md` and `hermes_state_wal.py`; not studied).
3. **Handoff semantics.** Two copies of one conversation diverge (Claude explicitly forks). Hermes bots tokens can run on only one Hermes at a time (Hermes transfer switches them off); plugin/hx ledgers need merge or fork rules; compaction already drops history.
4. **Attach security.** A public gateway reads `.env` and runs commands; Hermes had a real incident (June 2026) from exposed dashboards. Require OIDC/session token + TLS, outbound-only tunnels, short-lived per-session credentials, device enrolment for sensitive orgs.
5. **Repo input.** Fresh clone from a remote works only if pushed; local-only work needs a bundle; large repos (Claude: >100 MB degrades) and LFS/submodules/sparse checkouts break; uncommitted secrets must be filtered.
6. **Egress proxy coverage.** iron-proxy is Docker-only in Hermes today; MITM CA must be trusted by Node, Python, curl, Go, JVM separately (docs call out a Node asymmetric CA caveat); WebSockets, SSH git and non-HTTP traffic bypass it.
7. **Provider limits.** Lifetimes (E2B 1 h/24 h, Modal 24 h max, Codespaces 12 h, Cloudflare 10 min idle sleep), no memory snapshots on some, nested virtualization needs for Firecracker on a VPS, Docker-in-sandbox needs VM runtimes (Modal VM runtime) or privileged containers.
8. **Cost and runaway control.** Per-second billing plus an agent that never stops: needs budgets, idle reaping, max lifetime, and visible state in the UI.
9. **Multi-profile / multiplexing.** Hermes gateway serves several profiles from one process; decide one sandbox per session, per profile, or per repo (Claude: one runner owner per host, to keep checked-out code separate).
10. **Windows and non-Linux repos.** Cloud sessions are Linux; macOS/iOS toolchains need provider support (Daytona lists macOS sandboxes).

### 5.5 Suggested phasing

1. **Docker-on-VPS adapter**, image = official Hermes + plugin + hx, `serve` behind Tailscale/SSH; Desktop attaches via existing Remote/SSH kind. Repo cloned with a deploy token (no proxy yet). Proves attach + persistence with an external volume.
2. Add **environment definitions**, setup-script snapshot cache, network levels, and the **git proxy** + **iron-proxy** at the host.
3. Add **session store** (backup-based restore) and **lifecycle** (idle pause, TTL, reclaim UX).
4. Add a second provider (E2B or Modal) behind the abstraction; add handoff (bundle up, teleport-style fork down).
5. Optional: remote control of local sessions; scheduled/triggered cloud runs; PR auto-fix.

---

## Sources

- Claude Code: <https://code.claude.com/docs/en/claude-code-on-the-web> · <https://code.claude.com/docs/en/cloud-environments> · <https://code.claude.com/docs/en/remote-control> · <https://code.claude.com/docs/en/self-hosted-environments>
- Codex: <https://learn.chatgpt.com/docs/cloud> · <https://learn.chatgpt.com/docs/environments/cloud-environment> · <https://learn.chatgpt.com/docs/cloud/internet-access> (redirected from developers.openai.com/codex/cloud/*)
- E2B: <https://docs.e2b.dev/docs/sandbox> · <https://github.com/e2b-dev/infra>
- Daytona: <https://www.daytona.io/docs/en/sandboxes>
- Modal: <https://modal.com/docs/guide/sandboxes>
- Fly: <https://docs.fly.io/machines/overview>
- Cloudflare: <https://developers.cloudflare.com/sandbox/> · <https://developers.cloudflare.com/sandbox/concepts/sandboxes/>
- Codespaces: <https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces> · <https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces>
- Coder: <https://github.com/coder/coder>
- Ona: <https://ona.com/docs/ona/runners/aws/setup> (via search summary only)
- Hermes (local): `website/docs/user-guide/{configuration,docker,desktop,multi-connection-desktop,backup-and-transfer,remote-config}.md`, `website/docs/user-guide/egress/iron-proxy.md`, `website/docs/developer-guide/{terminal-environment-plugin,gateway-internals,gateway-ssh-clients,programmatic-integration,egress-internals}.md`, `apps/desktop/src/AGENTS.md`, `tools/environments/*.py`
