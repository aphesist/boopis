# Approval surfaces: the inbox, the card, and its four answers

Status: draft for w31 (the package's w28). Part B 5.3 ("Add: session and always through the Local API; edit-before-approve; allow all for this turn; the rule link on the card; the B40 argument summary"). Builds on ADR-0045 (the inbox) and `rules-engine.md` (the cards it makes); changes ADR-0045's "once or deny only" as proposed in ADR-0062.

## 1. Where it runs

| Part | Runs in |
|---|---|
| The card's text (summary, exact action, rule, origin) and its rule key | the plugin (`rules-engine.md` section 8) |
| The inbox (`local_api/approvals.rs`, `feed.rs`): rows, first answer wins, the audit | the host |
| The card in the window, Settings drafts | the UI |
| The answer | the engine's `approval.respond {session_id, execution_generation, prompt_id, choice}` (unchanged) |

## 2. What an approval row carries

`Approval` (`docs/LOCAL-API.md`) gains five fields; everything else is unchanged.

| Field | Type | From |
|---|---|---|
| `kind` | `"rule"` \| `"row"` \| `"review"` \| `"budget"` \| `"engine"` | the description's shape: a boopis rule card, a per-bot row card, a held review, a run-cap pause, or the engine's own prompt (a dangerous command, `computer_use`, an MCP trust prompt) |
| `rule` | `{id, text, source}` \| `null` | the card's `Rule: “…”` line, matched exactly against `rules.json`; `null` when it does not match (a rule changed meanwhile) or the kind is not `rule` |
| `summary` | string | the card's first line after "<bot> asks: ", the B40 words ("Run a command · git push") |
| `bot` | profile name \| `null` | the row's profile when it is a bot (`null` for the owner's own sessions) |
| `answerable_with` | list | section 3 |

The scrubber and caps of ADR-0045 apply to every field; `description` keeps the full text (it holds the exact action, line 2, as the window shows it).

## 3. The four answers, per surface

| Answer | Engine choice | Window | Local API | Chat platform (engine's own) |
|---|---|---|---|---|
| Allow once | `once` | yes | yes | yes |
| Deny | `deny` | yes | yes | yes |
| Allow all this turn | `session` | rule, row and review cards; on an `engine` card it is "Allow for this session", the engine's own scope | the same, from an owner surface (`host-protections.md` H4) | the engine's own Session button |
| Always allow | `once`, then a drafted exception | rule and row cards: the draft opens for editing, Save makes it active | rule and row cards: answers `once` and saves the draft **disabled**; the owner finishes it in Settings | not offered by boopis; the engine's own Always writes a dead entry (`rules-engine.md` 8.2) |

- **`session` on a boopis card is bounded to the turn** because the plugin's rule key carries the `turn_id` (`rules-engine.md` 8.2). On an `engine` card it is the engine's session scope (the rest of that session), and the window and island label it so.
- **`always` on an `engine` card** stays in the window only and keeps the engine's meaning (a permanent allowlist entry for the engine's pattern), behind a confirm that says it applies to every command the engine's detector groups with this one. From the Local API it is refused (`403 policy_refused`).
- **Governed sessions** (`governed: true`): `once` and `deny` only, from every surface, as today.
- **Budget pauses** (`kind: "budget"`): `once` and `deny` only (each pause has its own key; ADR-0048 on w30/governed-bots).
- **A parked step from a scheduled run** (`rules-engine.md` 8.3, owner decision 23 November 2026): the run is over, so the card is boopis's own (`kind: "parked"`), not the engine's. Its answers are **Approve and re-run** (`once`), **Always allow and re-run** (`once` plus the drafted exception; from the Local API the draft is saved disabled, as for any Always allow) and **Deny**; never `session`. Approving makes the host re-run that step as `rules-engine.md` 8.3 says (a new run of the bot that resumes the scheduled run's session, with a one-time grant for that exact call), and the card then follows the re-run: "Re-running…", "Done" or "kai did not run the approved step". Answered from every owner surface; the Local API answers it with `POST /v1/approvals/<id>` like any approval and gets `{approval, rerun: {session}}`.
- `choice` must be one the engine offered (`choices`) and one `answerable_with` lists; anything else is `400 choice_not_offered` or `403 policy_refused`. No default, no approve-all, no timeout that approves (unchanged).

`POST /v1/approvals/<id>` body: `{choice: "once"|"deny"|"session"|"always", execution_generation?}`. `always` answers `{approval, draft: {id, text, state: "draft"}}`.

## 4. The rule link

Every `rule` card shows the rule by its text and links to it in Settings > Approvals, the rule highlighted. In the window the link also offers, in one menu: Edit rule, Switch off. Grok's form is the reference: "{description}. Paused by your Ask first rule." [live]. A `row` card links to the bot's rows; a `review` card links to the reviewer's status. A link whose rule no longer exists shows the text only.

## 5. The card in the window: what it needs

The owner designs it (lab renders, owner picks; invariant 8; Part H, R-comp-2 `ApprovalCard`, one canonical component).

**A bot's approval in the app renders with the shared card that a lapsed session blank also uses** (design system v7 section 17.1 on `w31/design-system-v7`: one card component, two uses): no countdown, no time limit and no guess, with the approval's own content and answers below (owner decision, 23 November 2026; `blanks-inline.md` section 6).

| Depth (R-calm-11) | Content |
|---|---|
| glance | the bot's orb and name, the summary words, the rule's text (one line, ellipsized), the answers |
| look | the exact action (line 2), who asked (origin), the reviewer's one-line why |
| dig | the full rule, its source and who it applies to; the turn and session |

States: pending, answering (after a press, until the engine settles), answered (by which surface: `gui`, `endpoint`), withdrawn (the turn ended), parked (a scheduled run's step, refused for now; then re-running and done, `rules-engine.md` 8.3), and the draft editor after Always allow. **A bot's card does not expire:** the host writes the engine's maximum `approvals.timeout` into every bot profile (`blanks-inline.md` section 6.3, owner decision 23 November 2026), so "expired" applies only to the owner's own sessions, whose `approvals.timeout` stays the engine's (300 s by default), and to a parked step after 7 days. Keys: every answer needs one, chosen by the owner and listed in `design/v6/KEYMAP.md` (reference: Grok's Esc is "Deny once"). Word budget: a card, at most 25 words of interface text at rest (R-calm-10); the action and the rule are content.

## 6. The B40 summary

The summary is made by the plugin from the same data the host's safe words use (`apps/shared/data/tool-args.json`: a file's last two path parts, a command's program and plain subcommand, a page's host; `local_api/toolwords.rs` and `plugins/boopis/activity.py` on w30/local-api-0.2), with the same verb table. One table, two readers: the plugin reads the JSON file for the words, the host for presence. The words are the headline only; the decision needs the exact action, which is line 2.

## 7. Edit before approve

Grok has it (`approved_command` on `ResolveGrokBotAutoReviewApproval`, [inferred from the field] in the package). **The engine does not:** `approval.respond` takes exactly `session_id`, `execution_generation`, `prompt_id` and `choice` and refuses any other key (`gateway/session_controls.py:976-980`); `resolve_gateway_approval` sets only the choice and a deny reason (`tools/approval.py:149-188`); a pending prompt's `edit` field is the local editor's diff, once or deny only (`gateway/session_pending_controls.py:18-36`, `gateway/session_local_editor.py:48`).

So it is **not built in w31**. Two routes, in order of preference:
1. **Engine ask** (added to the engine report): `approval.respond {…, approved_args}` for a plugin card, re-run through `pre_tool_call` with the new arguments before dispatch.
2. **Plugin workaround, [verify] first:** the owner edits; the host answers `deny`; the plugin's `transform_tool_result` adds to the refused call's result "The owner rewrote this as: `<edited>`. Run exactly that." and records a one-shot grant for the exact arguments' digest in that session, so the bot's next call with those arguments skips the rules (host protections, hardline and the engine's own checks still apply). It depends on `transform_tool_result` running for a call the gate refused (`model_tools.py:882-900` shows the hook for executed calls; not shown for refused ones) and on the model following the instruction. If either fails, route 1 only.

## 8. Audit

Every answer, from every surface the host sees, is a line of `audit/client-answers.jsonl` (ADR-0045), now with `kind`, `rule_id` (when `kind` is `rule`), and `draft_id` for `always`. Refusals by the owner-surface check are lines too (`host-protections.md` section 10).

## 9. Local API and protocol changes

- `docs/LOCAL-API.md`: the `Approval` fields of section 2; `answerable_with` and the body of section 3; the rule-link fields; the sentence that `always` from a client saves a draft only.
- The window's answer stays the engine's `approval.respond`, sent through the host's gateway proxy, which sees and records it (`apps/desktop/src-tauri/src/gateway/hub.rs`); for Always allow the window sends `once`. New Tauri command: `rules_draft_save {draft, expected_revision}` (the draft editor's Save).
- Plugin RPC `rules.draft` (`rules-engine.md` section 11).

## 10. Acceptance tests

Host (`local_api`):
1. A rule card's row: `kind: "rule"`, `rule.id` matches `rules.json`, `summary` is the first line's words, `answerable_with` is `["once", "deny", "session", "always"]`.
2. An engine card's row: `kind: "engine"`, `rule: null`, `answerable_with` `["once", "deny", "session"]`; `always` from the endpoint is `403 policy_refused`.
3. A governed row and a budget row: `["once", "deny"]` only.
4. `always` from the endpoint on a rule card: the engine receives `once`; `rules.json` gains an exception with `state: "draft"`; it is not applied (a second identical call still asks).
5. `session` from the endpoint on a rule card: the engine receives `session`; a later matching call in the same turn shows no card; in the next turn it does.
6. A rule renamed between the card and the read: `rule: null`, the text still in `description`.
7. Two clients answer at once: the first wins, the second gets `409 already_answered` with the surface (unchanged).
8. The canary test of ADR-0045 extended to the new fields.

UI (vitest, lab stories for every state of section 5, dark and light).

End to end: a bot's rule card answered `session` from the reference client (`scripts/boopis-local-client.py`) lets the turn's second matching call run.

## 11. Open questions

None beyond owner question 3 (`README.md`): endpoint answers stay on. Recorded owner decisions (23 November 2026): bot cards have no time limit and use the shared v7 card (section 5); a scheduled run's refused step is a parked card that re-runs the step on approval (section 3).

## 12. Verification log

| Claim | Result |
|---|---|
| `approval.request` → `approval.respond{choice: once\|deny\|session\|always}` → `approval.settled` | verified: `gateway/session_pending_controls.py:18-63`, `gateway/session_controls.py:976-980`, `docs/PROTOCOL.md` section 2 |
| `session` and `always` are offered unless `allow_session`/`allow_permanent` are false or smart denied | verified: `gateway/session_pending_controls.py:22-26` |
| The inbox answers `once`/`deny` only | verified: `local_api/approvals.rs` (`REMOTE_CHOICES`), tests `approvals.rs:449`, `endpoint_tests.rs:503-504` |
| `approved_command` (edit before approve) | not in the engine (section 7); [verify] the plugin workaround |
| Engine `session` is close to "allow all for this turn" | verified, with the turn-scoped key (`rules-engine.md` 8.2) |
| Grok's `apply_to_group` covers every request from the same tool in the turn | [code] in the package; boopis narrows it to the same rules and the same tool |
