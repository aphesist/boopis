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
| [feedforward.md](feedforward.md) | The agent reads the draft while it is typed: `feedforward.read` in the plugin with the cheapest model of the answering provider, revisions and fail-quiet, the readings on send as `pre_llm_call` context, on by default, the live first-run step | `w31/feedforward` (plugin and UI) | ADR-0055 |
| [blanks-inline.md](blanks-inline.md) | Sessions only: a blank waits inline (60 s by default) through the plugin's `leave_blank`, then the agent goes on with its guess, "(my guess)", and the question stays as the shared v7 card; a late answer is one labelled correction; no injected turn. Bots have no blanks or `clarify`: they ask only through approvals, with no time limit | `w31/blanks-inline` (plugin and UI) | ADR-0056 |

Order inside the wave: host protections first (the BOOPIS bot cannot ship without them), then rules engine and team ops in parallel (different areas), then the rules UI once the owner has picked. The calm pass (w31c) runs beside it on the UI library and copy only.

## Open owner questions

Only what is the owner's to decide. Each spec states its proposal; work can start on the proposal.

1. **A per-bot Allow and a global rule.** When a bot's row says Allow and a global rule says ask (for example the bot's "messaging people" row is Allow and the global rule asks before sending email), which wins? Proposed: the global rule still asks; to stop it for one bot, save an exception for that bot (one click from the card's Always allow). (`rules-engine.md` section 6)
2. **Your own sessions.** Do the global rules also apply to the sessions you run yourself (the Sessions tab, not a bot)? Proposed: bots only, as decision 10 says; your sessions keep their own permission rules. (`rules-engine.md` section 15)
3. **Answering from the island.** The host refuses answers from bot processes, but a program that works hard to hide where it came from can still pass, because bots run as your user. Keep answering approvals from the island and other clients on? Proposed: yes, with Always allow from a client saved only as a draft you finish in boopis; per-client tokens later, which would change your earlier choice of one token for every client. (`host-protections.md` sections 6.4 and 7)

## Owner decisions recorded (23 November 2026)

- **Feedforward reader:** the cheapest fast model of the same provider the message goes to. (`feedforward.md` 6.1, ADR-0055)
- **Feedforward everywhere:** sessions, bot chats and rooms, with a global switch, one per context and a per-bot and per-room override; rooms read once with the provider of the members the message reaches first, at the person's cost. (`feedforward.md` 11, 12)
- **Subscriptions:** drafts may be read on a Claude or ChatGPT plan if fast enough; otherwise no marks. A default. (`feedforward.md` 6.1)
- **What travels:** everything the "Will assume" row shows, the person's picks marked as theirs. A default. (`feedforward.md` 7.1)
- **Lapsed session questions:** answerable for 24 hours. A default. (`blanks-inline.md` 5.3)
- **A scheduled run that meets an Ask rule:** the step is refused for now and left as the shared approval card; approving re-runs that step with the run's context. (`rules-engine.md` 8.3, `approval-surfaces.md` 3, ADR-0056)
- **`ask` and `request_input`:** the blanks rule next wave; credentials and secrets never reach the agent. (`blanks-inline.md` 12)
- **Bot approval cards** have no time limit and use the shared v7 card. (`approval-surfaces.md` 5)
