# Specs

One page per feature, written before code (Part E of the owner's design package, "the loop for every feature"). Each says where it runs (host, plugin, engine), its protocol and events, what it stores, its permissions and fail-closed behaviour, its Local API and protocol changes, its acceptance tests and its open questions. Claims about the engine are checked in its source (v0.23.2) and marked: verified with the file, "not as stated", or **[verify]** when they need a live engine.

Wave numbers: the package's w28 is w31 here, w29 is w32, and so on (ADR-0054).

## w31 foundations

| Spec | What | Branch | ADR |
|---|---|---|---|
| [host-protections.md](host-protections.md) | B47 and no self-approval: what no session may read, what a bot may not write or run, the host's refusal of owner-voice requests from bot processes (Linux, macOS, Windows), approvals only from an owner surface | `w31/host-protections` | ADR-0053 |
| [rules-engine.md](rules-engine.md) | One plain-language rules list for every bot: the eight default rules and their patterns, the reviewer (cheapest connected model), precedence with the per-bot rows, the card's four answers, `rules.json`, migration from w30/governed-bots, Settings > Approvals needs | `w31/rules-engine` (plugin), `w31/rules-ui` (after the owner picks a lab option) | ADR-0051 |
| [team-ops.md](team-ops.md) | `team.plan`, apply by the owner's hold, undo; room, bot, session and job verbs on the `hx-host-ops-v1` channel; read-only plans and stops on the Local API; CLI parity | `w31/team-ops` | ADR-0052 |
| [approval-surfaces.md](approval-surfaces.md) | The inbox's answers (once, deny, session, always), the rule link, the B40 summary on the card, edit before approve (not in the engine) | `w31/rules-engine` (plugin), `w31/host-protections` (host), `w31/rules-ui` | ADR-0053 |

Order inside the wave: host protections first (the BOOPIS bot cannot ship without them), then rules engine and team ops in parallel (different areas), then the rules UI once the owner has picked. The calm pass (w31c) runs beside it on the UI library and copy only.

## Open owner questions

Only what is the owner's to decide. Each spec states its proposal; work can start on the proposal.

1. **A per-bot Allow and a global rule.** When a bot's row says Allow and a global rule says ask (for example the bot's "messaging people" row is Allow and the global rule asks before sending email), which wins? Proposed: the global rule still asks; to stop it for one bot, save an exception for that bot (one click from the card's Always allow). (`rules-engine.md` section 6)
2. **Your own sessions.** Do the global rules also apply to the sessions you run yourself (the Sessions tab, not a bot)? Proposed: bots only, as decision 10 says; your sessions keep their own permission rules. (`rules-engine.md` section 15)
3. **Answering from the island.** The host refuses answers from bot processes, but a program that works hard to hide where it came from can still pass, because bots run as your user. Keep answering approvals from the island and other clients on? Proposed: yes, with Always allow from a client saved only as a draft you finish in boopis; per-client tokens later, which would change your earlier choice of one token for every client. (`host-protections.md` sections 6.4 and 7)
