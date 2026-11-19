# Cloud sessions

Status: plan, 2026-11-18. Evidence: `docs/research/cloud.md` (Claude Code on the web, Codex cloud, sandbox providers, Hermes's remote features) and this repository's own cloud session environment. Decision: ADR-0019.

boopis offers two kinds of session, side by side in the same list:
- **Local session:** Hermes runs on your computer, with everything the plan already has: your files, toolchains, devices, the macOS VM.
- **Cloud session:** the same software runs in a fresh, isolated container on infrastructure **you** own. It keeps working when your laptop is closed, and you open it from any device you're signed in on: desktop, phone, another computer. It can't touch your computer unless you allow it (section 7).

This is how Claude Code's cloud sessions work. The one difference is that you bring the infrastructure instead of renting Anthropic's.

## 1. How Claude Code does it, and what we copy
| Claude Code cloud | boopis cloud |
|---|---|
| One fresh VM per session, reclaimed when idle and rebuilt from the stored transcript | One fresh container per session on your runner, reclaimed when idle and restored from your session store |
| The repository cloned in; work survives only if pushed | Same, and every passing `ship` is already a checkpoint commit, pushed to the session branch, so a reclaim loses nothing that passed the gate |
| Environments: setup script, env vars, network level (none / limited + allowed hosts / full), saved per user | Same schema, stored in your control plane |
| Secrets injected by a proxy after traffic leaves the VM; they never enter it | Same: an egress proxy at your runner swaps placeholder tokens for real credentials per host |
| Git goes through a proxy holding the real token; the VM has only a scoped one | Same: a git proxy allows pushes to the session's branch prefix only, with no deletes or force pushes |
| Any device attaches; the session is shared state, not a copy | Any device attaches through your control plane; one live session |
| Remote Control: a local process lets a cloud session use a folder on your computer | Same, through the desktop host, per folder, with your approval |
| Handoff local ↔ cloud moves the git branch plus a transcript copy (a fork) | Same; never two live copies of one session |
| Self-hosted runners poll a queue, outbound only | Same: runners and sandboxes connect out, so no inbound ports are opened |

## 2. The pieces
1. **The cloud image:** the official Hermes Docker image plus the boopis plugin, `hx` and common toolchains, built per Hermes release in CI. Inside a cloud session Hermes runs exactly as on the desktop. Hermes's gateway and our plugin don't know where they are.
2. **The control plane (`hx-cloud`):** one small service, in Rust, that you deploy once: a Docker Compose file for a VPS or home server, and later a Cloudflare deployment. It holds:
   - **environments:** name, image, setup script, env vars, network level, allowed hosts, network secrets, repositories, size, idle timeout and maximum lifetime;
   - **the session registry:** state, owner, environment, branch, runner;
   - **device sign-in:** passkeys or a one-time pairing code, then per-device tokens that can be revoked;
   - **the relay** that connects devices to sessions;
   - **the queue** runners poll;
   - **secrets:** network secrets, git credentials and model API keys, encrypted at rest and never sent to a sandbox.
3. **Runners:** a machine that runs sandboxes, such as your VPS, a home server or a cloud VM. A runner polls the control plane for work and starts containers through a **sandbox provider**. The first provider is Docker with gVisor when available. E2B (self-hostable), Modal, Daytona, Fly Machines and Cloudflare Containers come behind the same interface: `create`, `exec`, `pause`, `snapshot`, `restore`, `expose`, `destroy`, `health`.
4. **The egress proxy,** at the runner boundary: TLS interception with a per-sandbox CA. It enforces the network level and allowed hosts, swaps placeholder tokens for real credentials per host (model providers included, so **no API key ever lives in the sandbox**), and logs denials. It extends Hermes's own `iron-proxy` where that fits.
5. **The git proxy,** in the control plane:
   - holds your GitHub App installation token or a personal token;
   - the sandbox gets a short-lived scoped token;
   - fetches are allowed for attached repositories; pushes only to `hx/<session>/*`; no deletes, tags or force;
   - pull requests open through the API.
6. **The session store** is your vault (ADR-0018), meaning any storage through OpenDAL: S3, R2, B2, Google Drive, OneDrive, WebDAV, SFTP, a local drive. Encryption happens on the runner. It holds:
   - ledgers, streamed as they're written (append-only and hash-verified);
   - the Hermes session state, snapshotted at idle and on reclaim through Hermes's own backup, scrubbed of credentials;
   - artifacts.
7. **Attach:** the desktop host's connection abstraction (ADR-0018 seam) gains a `Cloud` kind. Devices talk TLS to the control plane, and the control plane relays `hermes-gateway-v1` frames to the sandbox over the sandbox's outbound tunnel. The wire is the same as for local sessions, so the UI doesn't change.

## 3. Lifecycle
1. **New session:** choose Local, or Cloud with an environment. The control plane queues it.
2. **Provisioning:**
   1. a runner starts a container from the environment's snapshot (or the base image, then runs the setup script once and snapshots it);
   2. clones the repositories through the git proxy;
   3. starts the Hermes gateway with the plugin and connects its tunnel.
   The UI shows a checklist (clone, setup, ready) and queues your first message meanwhile.
3. **Working:** identical to a local session: governed or ungoverned, the cascade, `ship`, the gate, the ledger. Every passing `ship` checkpoint is pushed to `hx/<session>/checkpoints`.
4. **Idle:** after the environment's idle timeout the state is snapshotted to the store, then the container pauses (if the provider can) or is destroyed. Background processes stop, and the UI says which.
5. **Resume:** a fresh container restores the snapshot and the branch, and the session continues where it was.
6. **End:** archive (store kept), delete (store removed), or hand off to local.

## 4. Models and subscriptions in the cloud
- **API keys:** sit in the control plane and are injected by the egress proxy. Hermes inside the sandbox is configured with placeholder keys.
- **Claude subscription:** the `claude` CLI needs its OAuth credentials on disk, so the proxy can't hide them. That makes it opt-in per environment: you sign in inside a session and the token stays in that sandbox only. Or the cloud session uses API keys while local sessions keep the subscription. The UI says plainly which is in use.
- **Local models** (Ollama, vLLM) on your network work through the egress proxy when the runner can reach them, for example on a tailnet.

## 5. Security
- The sandbox is untrusted. It holds no long-lived credential, can push only its own branch prefix, and reaches only allowed hosts.
- Devices need a signed-in device token. The relay never exposes a sandbox port publicly, and every frame is authenticated.
- Whatever the agent can read, a prompt-injected agent can try to send out. So the default network level is *limited* (package registries plus the hosts you list), and secrets are never readable inside.
- The control plane is the one component you must keep patched. It binds behind TLS, rate-limits sign-in, and logs every session start, attach and push.

## 6. Handoff
- **Local → cloud:** the current branch is pushed (or a bundle of the working tree is uploaded, with `.env` and key files removed), together with a copy of the transcript and the ledger. The cloud session is a **fork**; the local one stays as it was.
- **Cloud → local:** fetch the session branch, import the transcript and the ledger as a new local session. Also a fork.
- A session is never live in two places, because a session's lease lives in the control plane.

## 7. Remote Control (a cloud session using your computer)
The desktop host can **offer folders** to your cloud sessions: an outbound connection to the control plane, folder by folder. A cloud session asks to use one, you approve on your desktop, and the session's `pack`, `exec` and `ship` calls for that folder run on your computer through the host, with the same policy and gate. That covers toolchains, devices or private networks the cloud can't reach. Revoking is one click.

## 8. What changes in the plan
- **Phase 1 (now) adds seams only:**
  - the host's endpoint abstraction includes `Cloud`;
  - the plugin and `hx` run headless in a container with no desktop assumptions (CI builds the cloud image and runs the end-to-end suite inside it);
  - an option to push checkpoint refs to a branch;
  - one storage interface for everything we persist.
- **Phase C1** (after phase 1):
  - the cloud image;
  - `hx-cloud` with environments, the session registry, device sign-in, relay and queue;
  - a Docker runner;
  - the egress proxy with injected secrets;
  - the git proxy;
  - the session store on a vault.
  Deployed with one Compose file on one VPS.
- **Phase C2:** idle pause and restore, setup snapshots, handoff, the Android app attaching to cloud and local sessions.
- **Phase C3:** more sandbox providers (E2B, Modal, Daytona, Fly, Cloudflare), Remote Control of your computer, scheduled cloud runs (the control plane starts a fresh cloud session on a schedule), teammates living in the cloud, iOS app.

## 9. Hard problems, named early
| Problem | Mitigation |
|---|---|
| Secrets in a sandbox that runs a whole agent | Proxy injection for every HTTP credential; the subscription CLI only by explicit opt-in; backups scrubbed of `.env` and `auth.json` |
| Durability of Hermes's SQLite across reclaim | Snapshot with Hermes's own backup, never sync live files; restore into a fresh container |
| Proxy coverage (CA trust differs in Node, Python, Go, the JVM; WebSockets; SSH git) | Install the CA for each runtime in the image; git over HTTPS only; document what bypasses the proxy and deny it at the network level |
| Attach security | Outbound-only tunnels, device tokens, TLS, audit log |
| Runaway cost | Per-environment idle timeout, maximum lifetime and cost cap, shown in the UI and the dock |
| Provider limits (E2B, Modal and Codespaces session caps; no memory snapshots on some) | The lifecycle never assumes memory survives: the store and the branch are the truth |
| Non-Linux toolchains | Cloud sessions are Linux. Apple work uses the macOS VM or a remote Mac through Remote Control |
