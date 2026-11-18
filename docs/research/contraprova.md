# contraprova engine map (for the hypotaxis Rust port)

Source: `/home/user/contraprova` (HEAD d70672d), Python 3.11, stdlib only. Paths below are relative to `src/contraprova/` unless stated. Rust port: `/home/user/hypotaxis/crates/contraprova-kernel/src/` (abbrev. `RK/`), contracts in `/home/user/hypotaxis/crates/hypotaxis-contracts/src/lib.rs`.

## 1. Module map

**Kernel (the engine proper, ~900 lines, no model calls)**
- `events.py`: `EVENT_TYPES`, `canonical_json`, `compute_hash`, `Event` (frozen dataclass; `create/to_json/from_json`), `ChainError`, `verify_chain`, `GENESIS_HASH`.
- `log.py`: `EventLog(path)` with `.events()`, `.verify()`, `.append()` (the single writer); `read_events`, `utc_now`.
- `projections.py`: pure replay. `TaskView`, `apply_task_event`, `project_tasks`, `InvalidTransition`, `usage_records`, `outcomes`, `is_arm_outcome`, `fork_id_of`, `shipped_forks`, `arm_usage_records`, `pareto_frontier`.
- `forks.py`: counterfactual re-runs. `conversation_prefix`, `fork`, `fork_pair`, `fork_id_for`, `list_forks`, `run_fork`, `render_task/submission/block`.
- `contracts.py`: `LaneContract`, `check_scope`, `overlapping_scopes`, `DEFAULT_PROTECTED`.
- `gates.py`: `scope_gate`, `run_test_gate`, `review_gate`, `run_gates`, `required_tiers`, `decision_payload`, `hash_protected_files`, `protected_digest`, `changed_lines`, `touches_manifest`.
- `sandbox.py`: temp-copy workspace plus subprocess runner (`RunResult`, `run_in_temp_workspace`, `safe_relpath`). Not a security sandbox (`sandbox.py:3`).
- `pricing.py` / `usage.py`: price tables, `request_cost`, `scale_table`, `cost_by`; `usage_payload` normalises an API usage object into a `usage.recorded` payload.
- `router.py`: learned `LinearRouter` (per-action logistic regression, epsilon-greedy, `router_hash`), `featurize`, `train`, `training_examples`, `retrain_from_log`, `trained_payload`.
- `interfaces.py`: shared types and the Claude model constants: `Message`, `Completion`, `LLMClient` (Protocol), `Submission`, `GateResult`, `RouteDecision`, `Router`, `HAIKU/SONNET/OPUS/FABLE`, `TIERS`.
- `llm.py`: `AnthropicClient` (urllib, Messages API), `Budget`, `BudgetExceeded`, `estimate_cost`, a scripted fake, `RecordingClient`.
- `mcp_edge.py`: MCP facade; only `task.created/claimed/submitted` are submittable (`mcp_edge.py:72-77`), the rest are `KERNEL_ONLY`.
- `ope.py`, `stats.py`, `analysis.py`: off-policy evaluation, McNemar/bootstrap, report. Not engine; skip in the port.
- `cli.py` (`verify|tasks|cost|report|init-claude`; exit 1 on `ChainError`/`InvalidTransition`, `cli.py:66-69`), `claude_init.py` (copies the plugin).

**Harness (experiment driver; reference for orchestration, not for the kernel)**
- `harness/arms.py`: arms A/B/C/D, `Harness`, `BudgetGuard`, prompts. `run_d` (`arms.py:722-782`) is the governed cascade with forks.
- `harness/lanes.py` (1274 lines, frozen): planner, `parse_plan`, `interface_check`, `merge_governed`, `merge_shadow`, `blame`, `run_la`, `LaneConfig` and `DEFAULT_LADDER`.
- `harness/lanes_detect.py`: clash detectors. `harness/edits.py`: SEARCH/REPLACE parser. `harness/outline.py`: file outlines.
- `harness/swepro*.py`, `polyglot.py`, `docker.py`, `runners.py`, `run.py`: benchmark plumbing, `CascadeRouter/UniformRouter/FixedRouter` (`run.py:100-135`).

**Plugin `config/claude-code/`:** `agents/{orchestrator,worker,escalation-sonnet,escalation-opus}.md`, `hooks/hooks.json` (PreToolUse and PostToolUse on matcher `Agent`), `scripts/gate.py` (the stdlib hook gate), `.claude-plugin/plugin.json`.
**`tools/readme/`** makes README SVGs. **`ui/`** is a static replay UI (`ui/demo-data.json`, `ui/data/*.json`, vendored lab-kit). Neither affects the port.

## 2. The event log

### 2.1 Event types and fields (`events.py:17-38`, canonical payloads in `docs/events.md`)
The envelope is always `{seq, type, actor, ts, payload, prev_hash, hash}` (`events.py:51-59`). Unknown extra payload fields are allowed (`docs/events.md:5`). 14 types:

| type | required payload | notable optional |
|---|---|---|
| `task.created` | `task_id`, `title`, `scope` (kernel reads `title`,`kind`=code,`scope`,`max_attempts`=3,`supersedes`; `projections.py:359-366`) | `kind`, `max_attempts`, `supersedes`, `arm`, `contract`, `prompt`, `system`, `fork_of`, ... |
| `task.claimed` | `task_id` | `worker` (default actor), `attempt` |
| `task.submitted` | `task_id` | `attempt`, `model`, `files`, `response`, `files_sha256`, ... |
| `gate.decided` | `task_id`, `verdict` in {pass, block}, `gate`, `reason` | `tests_sha256`, `gates[]` (per-gate verdict, reason, evidence), `tier`, `attempt`. `gates.decision_payload` (`gates.py:289-301`) folds a run into one event. |
| `route.decided` | `task_id`, `action` (a model id), `propensities` (sums to 1), `router_hash`, `features` | `arm`, `decision` (initial/after_gate_failure/lane_escalation), `rng_seed`, `step` |
| `router.trained` | `prefix_seq`, `n_examples`, `router_hash`, `hyperparameters`, `feature_names`, `actions` | `schema_version` |
| `fork.created` | `fork_id`, `task_id`, `from_seq`, `model`, `role` (control/treatment), `seed`, `prefix_hash` | `fork_task_id`, `branch`, `arm` (not hashed into fork_id) |
| `usage.recorded` | `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_5m_tokens`, `cache_write_1h_tokens` (`usage.py:193-200`) | `role`, `arm`, `task_id`, `fork_id`, `request_id`, `batch`, `repair`, `lane_id`, `tier` |
| `outcome.scored` | arm outcome: `arm`, `task_id` (pairing key), `solved`. Fork outcome: `fork_id`, `task_id`, `solved`. Gate replay: `gate_seq`, `solved` | `log_task_id`, `branch_task_id`, `shipped`, `derived_from`, `evidence` |
| `lane.planned` | `task_id`, `plan_id`, `model`, `k`, `lanes[]`, `plan_sha256` | `fallback`, `repair_used`, ... |
| `interface.frozen` | `task_id`, `plan_id`, `interfaces` (symbol to signature), `interfaces_sha256` | `board`, `entries` |
| `interface.requested` | `task_id`, `plan_id`, `lane_id`, `symbol`, `requested_signature`, `status`=rejected | `reason` |
| `merge.decided` | `task_id`, `plan_id`, `round`, `mode` (governed/shadow), `lanes`, `merged_sha256`, `verdict` | `blamed`, `blame_rule`, `gate_seq`, `tiers`, `conflicts` |
| `coordination.detected` | `task_id`, `plan_id`, `kind`, `lanes` | `round`, `mode`, `evidence` |

Two task-id namespaces: the kernel task id (lifecycle, route, fork, usage) and the pairing key on `outcome.scored` (benchmark exercise id), linked by `log_task_id` (`docs/events.md:7-13`). The Rust port needs both.

### 2.2 Hash chain
```python
GENESIS_HASH = "0" * 64                                                             # events.py:15
def canonical_json(obj): return json.dumps(obj, sort_keys=True, separators=(",", ":"),
                                           ensure_ascii=False, allow_nan=False)    # :41-43
def compute_hash(seq, type_, actor, ts, payload, prev_hash):
    body = {"seq": seq, "type": type_, "actor": actor, "ts": ts, "payload": payload, "prev_hash": prev_hash}
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()       # :46-48
```
- Hashed: the whole envelope except `hash`, as one canonical JSON object, UTF-8. `ts` is hashed as a string (`...isoformat(timespec="milliseconds")` with `Z`, `log.py:125-126`).
- Canonical rules: keys sorted recursively (code-point order), no whitespace, non-ASCII emitted raw, NaN/Infinity is an error.
- `seq` starts at **0**; `prev_hash` of event 0 is `GENESIS_HASH`.
- `Event.create` round-trips the payload through canonical JSON before hashing (`events.py:65-66`), so the stored payload is exactly what was hashed. A port must do the same (parse, sort, re-emit) and must keep integer versus float forms stable (`1` is not `1.0`).
- `verify_chain` (`events.py:92-105`) checks, in order: `seq == index`, `prev_hash == previous hash`, type is known, recomputed hash equals stored. Blank lines are skipped on read (`log.py:133`).
- Storage: one `Event.to_json()` line per event (canonical JSON of the full envelope including `hash`).

### 2.3 Single writer (`log.py:151-165`)
`append` opens `a+`, takes `flock(LOCK_EX)`, re-reads and **verifies the whole chain**, computes `seq=len(evs)` and `prev=evs[-1].hash`, builds the event, runs `apply_task_event(project_tasks(evs), ev)` (raises `InvalidTransition`, nothing written), then writes, flushes and **fsyncs**. Illegal events are never stored, so replay cannot fail (`log.py:1-5`). Task state machine (`projections.py:348-392`):
- `task.created`: id must be new; `supersedes` must name an existing **terminal** (`done`/`failed`) task.
- `task.claimed`: only from `todo`, then `in_progress` with worker.
- `task.submitted`: only from `in_progress`, then `review` with `attempts+1`.
- `gate.decided`: only from `review`. `pass` goes to `done`. `block` goes to `failed` if `attempts >= max_attempts`, else back to `todo` with worker cleared. Any other verdict is invalid.
- `route.decided` and `fork.created`: the task must exist. `usage.recorded`, `outcome.scored` and the five lane events have **no** validation.
- Done is final: no transition leaves `done`/`failed` (claim/submit/gate all demand a non-terminal status).

### 2.4 Fork semantics (the contraprova control vs escalation)
Purpose (`docs/design.md:9-18`): a failed worker attempt is one sample, so escalation is compared with a same-model retry. At a fork point (a `from_seq`, normally the blocking `gate.decided`) the harness makes a **control** (same cheap model, 2 replicates differing only in `seed`; their disagreement is the noise floor) and a **treatment** (stronger model, `arms.py:55-59`). Escalation value is treatment minus control solve rate.
- `forks.py:148-151`: `fork_id = "fork-" + sha256(canonical_json({task_id, from_seq, model, role, seed, prefix_hash}))[:16]`; `prefix_hash` is the chain hash of the event at `from_seq`, which commits to all prior history.
- `conversation_prefix` (`forks.py:112-142`) reads only events with `seq <= from_seq` and the same `task_id`: `task.created` gives a user turn (`render_task`), `task.submitted` an assistant turn, a `block` verdict a user turn "The {gate} check blocked your submission: {reason}\nPlease try again.". `outcome.scored` (hidden-test results) is never read.
- `fork` (`forks.py:164-195`) refuses: role not control/treatment, empty model, non-int seed, a prefix not ending on a user turn (no assistant prefill), duplicate fork id, `extra` overriding required fields. It appends `fork.created`.
- `run_fork` makes **exactly one live call**, re-checks `prefix_hash` against the log (tamper detection), tags usage with `{task_id, fork_id, arm: role}`. Forks are re-executed, never stitched from recorded output.
- Cost rule (`projections.py:435-481`): only the fork branch an arm shipped (`branch_task_id`) is that arm's cost; every other fork's usage is `"<arm>:measurement"` overhead.

### 2.5 Replay and projections
All pure: `project_tasks`, `usage_records`, `outcomes` (`(arm, task_id) -> solved`, last score wins, skips fork outcomes and gate replays via `is_arm_outcome`, `projections.py:409-426`), `shipped_forks`, `arm_usage_records`, `pareto_frontier`, `training_examples`/`retrain_from_log` (router replays to the same `router_hash` or raises, `router.py:538-552`), `list_forks`, `conversation_prefix`.

### 2.6 Cost (never stored)
`usage.recorded` holds tokens only (`pricing.py:1-10`). Cost is `request_cost(u, table)` (`pricing.py:264-280`):
```python
inp, out = price.rates(prompt_tokens(u))      # long-context tier flips the WHOLE request above threshold
usd = (input*inp + cache_read*inp*cache_read_mult + w5m*inp*1.25 + w1h*inp*2.0 + output*out) / 1e6
if u.get("batch"): usd *= 0.5
```
`prompt_tokens = input + cache_read + w5m + w1h` (so `input_tokens` **excludes** cache, Anthropic semantics, `pricing.py:8-9`). `PRICE_TABLES["anthropic-2026-11"]` (`pricing.py:244-251`) is per-model `ModelPrice(input, output, cache_read_mult, long_threshold, long_input, long_output)`; an unknown model raises `KeyError` and the budget guard refuses to spend without a price (`llm.py:194-195`). `scale_table(table,k)` scales rates (not the multipliers); `cost_by(records, table, key)` groups by any usage field. Budget (`llm.py:97-123`): `check(estimate)` before a call (worst case = prompt at 2.5 chars/token, system written to cache at premium, full `max_tokens` out), `charge(actual)` after. The harness `BudgetGuard` (`arms.py:294-322`) re-prices the entire log each time.

## 3. Governance semantics

### 3.1 Orchestrator brief (`orchestrator.md:109-125`, parser `scripts/gate.py:55-67`)
Free text, first lines exactly `scope: <comma-separated paths/globs>`, `test: <command>`, `goal: <1-2 sentences>`, then approach, at most about 250 words, no code longer than one line, no tests/CI in scope. Parser regex `^\s*[-*]?\s*(scope|test)\s*:\s*(.*)$` (case-insensitive, first occurrence wins, backticks stripped, scope split on `[,\s]+`). `goal:` is not parsed. **The test command is never taken from the brief**: only from `$CONTRAPROVA_TEST_CMD` (`gate.py:18-19`).

### 3.2 Gate
Kernel gates (`gates.py`), run in order, stop at first block (`run_gates`, `:232-286`):
1. `T0.scope` (`scope_gate`, `:140-170`): `check_scope` (`contracts.py:272-285`) gives, per path (backslashes to `/`, leading `./` stripped), `out_of_scope` if absolute or any `..` segment, `protected` if it matches `contract.protected`, `out_of_scope` if not matching `allowed` (`fnmatchcase`). **Test-file immutability**: `hash_protected_files` (sha256 of every protected file, taken **before** the attempt) is bound into evidence as `tests_sha256 = sha256(canonical_json(path->hash))`. A submission writing a hashed path is `protected`; any difference between pre-attempt and current hashes is `test_tampered`.
2. `T0.visible_tests`: the tests the worker saw, run in a temp copy with the submission applied. Pass iff `returncode == 0 and not timed_out` (`sandbox.py:39-41`); reasons `timed out after Ns`, `test command could not start`, `exit code N (counts)`. Output tail-truncated to 2048 bytes.
3. `T1.private_tests`: same, with `private_dir` overlaid first (tests the worker never saw). Skipped (absent from the plan) when no `private_command`.
4. `T2.review`: added only by blast radius (`required_tiers`, `:108-125`): escalated, or a manifest touched (`Cargo.toml, go.mod, package.json, CMakeLists.txt, pyproject.toml, build.gradle(.kts), pom.xml`), or more than 200 changed lines (500 for lanes). Reviewer is an injected callable. Missing reviewer: `block` (library default) or `skip` (pass with `status: skipped`). Reply must be exactly `PASS` or `BLOCK: <reason>`.

Plugin gate (`scripts/gate.py:144-180`, the live version for Claude Code), always exit 0 and report through `additionalContext`: (1) no `scope:` line is a BLOCK; (2) protected paths changed (`TEST_PATTERNS`, `:37-41`, broader than `DEFAULT_PROTECTED`: includes `conftest.py`, `__tests__`, `spec/`) is a BLOCK; (3) changed files outside scope, excluding protected ones already reported, is a BLOCK; (4) `$CONTRAPROVA_TEST_CMD` (timeout 540 s) non-zero or timed out is a BLOCK, output tail 3000 chars. "Changed files" = diff of dirty-tree sha256 snapshots taken in PreToolUse vs PostToolUse (`dirty_state`, `changed_since`). PreToolUse denies any per-call `model` override. The gate verdict is authoritative over the agent's self-report.

Exit-code semantics: tests pass iff exit 0; `None` return code (timeout, spawn failure) is a block with a distinct reason; the hook always exits 0 and signals through JSON; `cli verify` exits 1 on `ChainError`/`InvalidTransition`.

### 3.3 Cascade / router policy
- **Plugin cascade (`orchestrator.md:141-153`)**: tier 1 `worker` (Haiku), tier 2 `escalation-sonnet`, tier 3 `escalation-opus`. **One attempt per tier**, stop at first PASS, never skip a tier, no other model. Only exception: when the sole failure is scope/protected/contract, re-dispatch the **same tier once** with the violation named before moving up. After Opus fails: report FAILED.
- **What the next tier receives**: the **same brief** plus `## Previous attempt failed` with the failing tier, gate findings (or the agent's report) and the trimmed test output. The previous attempt's changes stay in the working tree; the escalation agent is told to start from them and to revert out-of-scope/test edits (`escalation-*.md:10-17`).
- **Harness arm D**: a `Router` picks the first tier; on first gate failure the log is forked at the blocking `gate.decided` and the retry prompt (first prompt + rejected files + `[gate] reason` lines, truncated to `feedback_chars`) goes to 2 same-model controls and 1 stronger treatment; the router's `after_gate_failure` action picks which branch ships (`arms.py:739-781`). Max attempts 1 per branch.
- **Routers**: `LinearRouter` maximises `P(solve|a) - threshold * expected_cost[a]`, epsilon-greedy so every action has propensity at least epsilon/K, `decide(features, rng_seed)` deterministic, `router_hash = sha256(canonical({schema, hyperparameters, weights}))`, weights rounded to 12 decimals (`router.py:198`). Eight features in [0,1] (`router.py:97-106`). `CascadeRouter` (`harness/run.py:115-125`) is a fixed policy with propensity 1.
- **Lane ladder** (`lanes.py:97-104`): `haiku`, `haiku-repair` (same tier plus feedback), `sonnet`, `opus`; attempt n runs step n; `max_attempts` = ladder length, so the projection's attempt limit enforces it.

### 3.4 Contract lanes (frozen; development moved to parataxis, `docs/lanes-plan.md:3-9`)
Planner (Opus, one request) returns a JSON plan: 1..4 lanes, each `allowed` files (a **partition** of the task's solution files), `symbols`, `exports`, `imports`, `tests`; `parse_plan` rejects test paths, overlap, missing files; one repair turn, else a single-lane fallback. **Freeze**: no model call; interfaces (symbol to signature, seeded from the task's interface text) are written once in `interface.frozen`; a lane wanting a change emits `INTERFACE REQUEST: sym: sig`, logged as `interface.requested` status rejected (a counted clash). Each lane sees its own files in full, outlines of others. **Governed merge**: union of lane file sets (overlap detected, first lane wins), then gates `T0.scope`, `T0.edits`, `T0.interfaces` (frozen symbols still defined, Python parameter names preserved), `T0.visible_tests`, `T1.private_tests`, `T2.review`. **Blame** (`lanes.py:766-816`): rule 1 direct (edit errors, interface owners, lanes the plan assigned a failing test), rule 2 test-file stem or traceback names a lane file, rule 3 every lane; widening when the same lanes are blamed twice. Only blamed lanes climb the ladder; passed lanes keep output; blamed at Opus again ends the task unsolved. **Shadow merge**: the same first-reply outputs joined with no contracts or gates, scored once, to isolate what governance is worth. Parataxis is referenced in `docs/lanes-plan.md:3-9`, `README`, and the latest commit "Point the contract lanes material at parataxis"; lane code is not extended here.

### 3.5 Budgets
`Budget` in the client (cap, `check` before, `charge` after, shared across clients, `llm.py:97-123`); `BudgetGuard` in the harness (re-prices the log, `arms.py:294`); hard stop is `BudgetExceeded`. Per-attempt limits: `max_attempts` (projection), `maxTurns: 60` per agent (plugin), `max_tokens` per request.

## 4. Claude coupling and neutral abstractions

| # | Where | Assumption | Neutral abstraction |
|---|---|---|---|
| 1 | `interfaces.py:307-312` | `HAIKU/SONNET/OPUS/FABLE` string constants; `TIERS` tuple; router action set `TIERS` (`router.py:86,214`); `LANE_MODELS`, hard refusal of FABLE (`lanes.py:93,125-129`); fork defaults (`arms.py:55-59`) | `ModelRef {provider, id}`; `TierLadder = Vec<Tier{name, ModelRef, effort, max_tokens}>` ordered by cost; "never above tier N" becomes a per-run `ceiling` instead of a name ban |
| 2 | `pricing.py:244-251,226,239-241` | Anthropic price table; `cache_read_mult` per model; fixed 1.25x/2.0x write multipliers (5m/1h TTL); 0.5 batch; long-context flip by model | `PriceTable{version, entries: ModelRef -> Price{input, output, cache_read, cache_write, reasoning?, long_ctx?}}` with absolute per-Mtok rates for each bucket (no multipliers); a `subscription` pseudo-provider with price 0 plus a separate "API-equivalent" projection; table keyed and versioned like `anthropic-2026-11` |
| 3 | `usage.py:185-202`, `pricing.py:255-261` | Anthropic `usage` field names (`cache_creation.ephemeral_5m/1h_input_tokens`, `cache_read_input_tokens`); **`input_tokens` excludes cache**; prompt = sum of four | Normalised `Usage{input_uncached, output, cache_read, cache_write, reasoning}` (u64s). Each provider adapter maps in: OpenAI `prompt_tokens` **includes** `cached_tokens` (subtract), `completion_tokens_details.reasoning_tokens`; Gemini `cachedContentTokenCount`, `thoughtsTokenCount`; DeepSeek `prompt_cache_hit/miss_tokens`; Ollama `prompt_eval_count/eval_count`. Keep 5m/1h as optional detail of `cache_write`. Log payload carries a `usage_schema` version |
| 4 | `llm.py:52-66,255-291` | Messages API URL, `anthropic-version`, `x-api-key`, `cache_control` breakpoints (max 4), 512-token minimum prefix, `output_config.effort`, no temperature | `trait ModelClient { complete(CompletionRequest) -> Completion }` plus `Capabilities{prompt_cache: None|Explicit(max_bp)|Automatic, effort: None|Levels(..)|ThinkingBudget, token_count_endpoint, seed_support, prefill, streaming, tool_use_format}`; `Message.cache_upto` becomes a hint that adapters ignore or realise |
| 5 | `llm.py:56` | Effort levels `low/medium/high/xhigh/max`; effort tuned per tier (`arms.py:327-345`, `lanes.py:97-104`) | Abstract `Effort` enum (`None|Low|Medium|High|Max`) mapped per adapter to reasoning_effort, thinking budget tokens, or ignored; recorded in the route event |
| 6 | `llm.py:20-24,321`, `swepro_arms.py:773` | adaptive thinking implied by omitting `thinking`; thinking blocks dropped from text; `THINKING_ALLOWANCE` calibrated on Claude | Adapter strips reasoning content; the allowance is a per-model-ref calibration table; reasoning tokens counted via `Usage.reasoning` |
| 7 | `llm.py:173-175`, `forks.py:179-185` | Assistant prefill is a 400 on Claude, so forks require a prefix ending on a user turn | Capability flag `prefill`; keep the user-turn rule as the portable default |
| 8 | `llm.py:326-340` | Free `count_tokens` endpoint; 2.5 chars/token estimate (`llm.py:66`) | `Capabilities.token_count`; fall back to a conservative chars-per-token per provider/tokenizer (local models differ) |
| 9 | `llm.py:61-64,212-251` | Key env vars `PROJECTS_ANTHROPIC_KEY`/`ANTHROPIC_API_KEY`, role-specific key; retry on 408/409/429/5xx/`overloaded_error` | Per-provider credential refs; a provider-neutral retry class (`rate_limited`, `overloaded`, `transient`) with each adapter classifying |
| 10 | `config/claude-code/agents/*.md`, `hooks/hooks.json`, `scripts/gate.py:183-225`, `cli.py:90`, `claude_init.py` | Claude Code subagent frontmatter (`model`, `effort`, `maxTurns`, `tools: Read, Edit, Write, Grep, Glob, Bash`, `Agent(...)`), PreToolUse/PostToolUse hooks with `hookSpecificOutput.additionalContext`, `permissionDecision: deny`, `claude --agent orchestrator` | This is the **claude-CLI adapter only**. In the Rust harness, express the same contract as a provider-neutral `Worker` role (tool allow-list, max turns, tier) and enforce the gate in-process (snapshot before / diff after the worker's turn); for the claude CLI subscription adapter, parse the CLI's JSON output and mark `subscription_covered` |
| 11 | `harness/arms.py:67-72`, `harness/edits.py:60-80`, `swepro_arms.py` | Output formats `<<<FILE path>>>...<<<END>>>` and SEARCH/REPLACE blocks tuned on Claude; tool-use format never used (harness is single-turn text) | Edit format is a per-model `EditFormat` capability (whole-file / search-replace / unified diff / native tool calls), with a repair turn on parse failure (already modelled: `repair_used`) |
| 12 | `router.py:93-95`, `docs/events.md:44-62` | Router features are language/test-based, not Claude-specific; `route.decided.action` must be a model id from `TIERS` | `action` becomes a ladder tier name plus the resolved `ModelRef`; the learned router is optional (needs hundreds of examples) |
| 13 | prompts `arms.py:100-160`, agent `.md` bodies | Text tuned on Claude | Keep prompts as versioned templates per tier; record `prompt_sha256` in `task.created` or `route.decided` so a port can prove it did not change them |
| 14 | `harness/arms.py:56-58`, `forks.py:51` | The control model equals the cheap tier, treatment equals tier 2; independent samples because the API has no seed | `seed` is only a replicate label; for providers with seed support (OpenAI, local) record it separately and say whether it was honoured |

## 5. Invariants and tests to port 1:1

`tests/test_properties.py` (Hypothesis; port with `proptest`, same action strategy over 3 task ids, history built by "keep only actions a single writer would accept", `:37-46`):
- `test_replay_is_deterministic` (:52): incremental projection equals `project_tasks(events)`; `verify_chain` passes.
- `test_terminal_tasks_never_change` (:61): once `done`/`failed`, a task view never changes.
- `test_attempts_never_exceed_limit` (:75): `attempts <= max_attempts`.
- `test_any_payload_edit_breaks_the_chain` (:83): add a field to any event's payload without rehashing; `verify_chain` must raise.
`tests/test_log.py`: `test_happy_path`, `test_done_is_immutable`, `test_cannot_supersede_open_task`, `test_attempt_limit`, `test_rejected_event_is_not_written`, `test_tampering_is_detected`, `test_deletion_is_detected`, `test_unknown_event_type`, `test_outcomes_skip_fork_outcomes_and_gate_replays`, `test_is_arm_outcome`.
`tests/test_pricing.py`: `test_repricing_is_linear` (:58: `sum cost(scale_table(T,k)) == k * sum cost(T)`, rel_tol 1e-9; the linear re-pricing property), `test_haiku_long_prompt_reprices_the_whole_request`, `test_cache_reads_count_toward_the_long_threshold`, `test_cache_and_batch_multipliers` (cache read 1M on opus = $0.20; w5m 1M = $5.0; w1h 1M = $8.0; batch halves), `test_cost_by_role`, `test_usage_payload_from_api_shape`, `test_usage_payload_legacy_cache_total`.
`tests/test_forks.py`: `test_prefix_reconstruction`, `test_fork_created_payload`, `test_fork_validation`, `test_prefix_hash_stable_as_log_grows`, `test_run_fork_calls_live_and_never_stitches_future`, `test_run_fork_detects_tampered_prefix`, `test_property_prefix_is_pure_and_stable`, `test_property_fork_makes_exactly_one_call`, `test_event_payload_roundtrip_keeps_prefix`.
`tests/test_router.py`: `test_decide_is_deterministic_and_matches_propensities`, `test_training_is_reproducible_and_seed_sensitive`, `test_retraining_reproduces_hash` (property), `test_router_trained_event_replays`, `test_training_prefix_excludes_later_outcomes`, `test_a_blocked_then_forked_decision_is_an_unsolved_example`.
`tests/test_gates.py`: `test_touching_hashed_test_file_blocks_even_if_contract_allows`, `test_direct_workspace_tamper_is_detected`, `test_run_gates_stops_at_first_block`, `test_tiers_manifest_adds_review`, `test_tiers_escalation_and_size`, `test_evidence_is_deterministic`, `test_safe_relpath_rejects`, `test_timeout_blocks`, `test_missing_command_does_not_raise`.
`tests/test_lanes.py`: `test_ladder_is_haiku_repair_sonnet_opus_and_never_fable`, `test_blame_rules`, `test_blame_widens_when_the_same_lanes_are_blamed_again`, `test_lane_blamed_again_at_opus_ends_unsolved_within_the_attempt_limit`, `test_interface_check_passes_on_gold_and_blocks_missing_or_changed_symbols`, `test_governed_merge_unions_and_reports_overlap`, `test_valid_plan_parses_and_partitions_every_file`.
`tests/test_claude_code.py`: `test_gate_test_patterns_match_the_harness`, `test_evaluate_verdicts`, `test_gate_hook_denies_model_override_and_ignores_other_agents`. `tests/test_boundaries.py`: engine modules must not import harness/analysis. `tests/test_mcp_edge.py`: `test_kernel_only_events_are_forbidden`.

Missing a cross-implementation test: a **golden log** (fixed events with fixed `ts`) whose hashes both languages must reproduce; none exists in either repo. Add it first.

## 6. The existing Rust port: divergences

Verdict: `contraprova-kernel` implements a **different system with the same vocabulary**. It is not log-compatible with Python.

**Ledger (`RK/ledger.rs`, `hypotaxis-contracts/src/lib.rs:5-30`)**
- Envelope: `{seq, timestamp, kind, prev_hash, hash, payload}`; Python has `ts` and `type` and an **`actor`** (absent in Rust, so no actor attribution).
- `seq` starts at **1** (`ledger.rs:89,168`); Python starts at 0.
- Hash preimage is `format!("{seq}|{timestamp}|{kind}|{prev_hash}|{payload_json}")` (`:37-50`), pipe-joined, with only payload canonicalised; Python hashes the canonical JSON of the whole envelope including `actor`. Hashes never match.
- Kind strings are snake_case (`task_created`) vs dotted (`task.created`).
- Event set is the 9 base types only; the five lane types (`lane.planned`, `interface.frozen`, `interface.requested`, `merge.decided`, `coordination.detected`) are missing, as is any type validation on read (serde enum fails instead).
- Canonicalisation (`:66-98`): recursive sorted keys, compact; equivalent for strings and objects, but numbers go through `serde_json` (f64 vs i64/u64 formatting can differ from Python `repr`, e.g. `1e16`, and no NaN rejection path); the payload is not round-tripped on append, so the stored payload and the hashed one can differ by key order/number form only if the caller supplied exotic values.
- Timestamp: `Utc::now().to_rfc3339()` (nanoseconds, `+00:00`) vs ms `Z`.
- **No single-writer validation**: `append` has no file lock, no re-read, no chain verification, no task state machine, no `InvalidTransition`, no fsync (only `flush`). Concurrent writers can fork the chain. `Ledger::open` is "lenient": a corrupt line just bumps `next_seq` (`:96-103`), so a damaged log keeps accepting appends. Python refuses (`verify_chain` on every append).
- `verify_chain` errors on blank lines (Python skips them) and does not check event type validity beyond serde.
- No projections at all: no `TaskView`, no attempts/`max_attempts`, no done-is-final, no supersedes, `outcomes`, `shipped_forks`, `arm_usage_records`, `conversation_prefix`, forks (`fork_id`, `prefix_hash`, `run_fork`), router training or `pareto_frontier`.
- **Cost** (`:328-352`, `:246-325`): hard-coded three-tier constants (`FRONTIER 15/75`, `BALANCED 3/15`, `FAST 0.8/4`), cache read at a flat rate, **no cache write buckets, no long-context flip, no batch, no price-table versioning, no model key** (tier enum instead). Python's `request_cost` and `scale_table` linearity are not reproduced; there is no linear re-pricing test. Cost is a projection (good) and tokens are stored (good), but tiers are priced by a name not a model id.
- **Double-counting bug risk**: `extract_u64` accepts `prompt_tokens`/`cached_tokens` aliases (`:264-269`) and then sums `input + cache_read` (`:9`, `:304`); for OpenAI-shaped usage `prompt_tokens` already includes `cached_tokens`, so the cached share is counted twice. Python semantics (`input_tokens` excludes cache) are only right for Anthropic.
- New concepts with no Python counterpart: `subscription_covered`/`zero_api_cost`, `billed_api_usd` vs `raw_api_equivalent_usd` vs `cascade_actual_usd`, `cache_hit_rate`, "frontier uncached baseline". These are useful for the claude-CLI subscription adapter; keep them, but as a pricing-mode layer over the normalised `Usage`.

**Gate (`RK/gate.rs`)**
- Input is a structured `TaskBrief{id, goal, scope_globs, lane_id, invariants}` plus a caller-supplied changed-file list. There is **no** `scope:/test:/goal:` text parser, no snapshot-diff of the dirty tree, no `contract` missing-scope vs empty-scope distinction (both are `EmptyScopeGlobs`).
- Order is protected (2), then scope (3), then command (4) after non-empty scope (1), matching `scripts/gate.py:155-176` in effect. Python additionally excludes protected files from the out-of-scope list; Rust returns early so the same.
- Protected set `*test*, *spec*, .git/**, .env*, .githooks/**` (`gate.rs:11-26`) is far broader than Python's pattern lists (`contracts.py:250`, `gate.py:37-41`): `*test*` matches `contest.rs`, `latest.py`, `fastest/`, `src/attestation.rs` (globset `*` crosses `/`). It adds `.git/.env/.githooks` protection, which Python lacks (worth keeping, but the test patterns should be narrowed to directory/suffix forms).
- **Missing**: test-file hash binding and `test_tampered` (no `tests_sha256`, `hash_protected_files`), visible vs private test tiers, `T2.review` blast-radius tiering and reviewer hook, changed-line/manifest rules, the folded `gate.decided` payload (`decision_payload`), `GateResult` evidence, timeout (`run_pinned_command` has none; Python 60 s per gate / 540 s hook), output tail truncation (Python 2048/3000 chars), temp-copy execution (Rust runs the command in the real workspace).
- Path hygiene: `normalize_rel_path` (`lib.rs:45-55`) drops empty and `.` segments and the **leading `/`**, but keeps `..`; so `/etc/passwd` becomes `etc/passwd` and `a/../../x` is not rejected. Python rejects absolute and `..` paths as `out_of_scope` (`contracts.py:279-280`, `sandbox.safe_relpath`). Fix before using it as a security boundary.
- Command env var is `HARNESS_GATE_CMD`; Python's is `CONTRAPROVA_TEST_CMD` (keep "never from the brief", which Rust enforces and tests, `gate.rs:96`).
- `exit_code` uses `unwrap_or(-1)` for signal death; Python distinguishes timeout/unstartable (`None`).
- Claude-specific kept: none in the gate itself.

**Router (`RK/router.rs`)**
- Implements only the **fixed plugin policy**: start `Tier1Fast`; pass gives no next tier; a pure scope/protected violation retries the same tier once (tracked per tier in `scope_retry_used`), a second one escalates; any other failure escalates one tier; Tier3 failure is `exhausted`. This matches `orchestrator.md:141-153`.
- Differences: no `haiku-repair` step (lane ladder, `lanes.py:97-104`); no `max_attempts` link to the task projection; no learned `LinearRouter`, `featurize`, propensities, `router_hash`, `route.decided`/`router.trained` writing or replay; `RouteDecision` is a different struct (no `action`, `propensities`, `features`); no budget linkage; no per-tier effort. The router is not wired to the ledger.
- Tiers are a closed enum `Tier1Fast/Tier2Balanced/Tier3Frontier` (`contracts:33-50`), which is already model-agnostic by name (good), but is fixed at three and carries no `ModelRef`; the ladder needs to be data (`Vec<Tier>`), with the same-tier scope retry as a per-tier policy.
- What the next tier receives (previous-failure section, brief reuse) is not modelled in the kernel.

**Lanes (`RK/lanes.rs`)**
- A glob registry of lanes with `owner_bot`, `scope_globs`, `frozen_interfaces` (glob patterns over paths). It detects `CrossLaneOverlap`, `FrozenInterfaceViolation`, `OutOfLaneScope` on a changed-path list.
- Python's lane layer is much richer: planner and `parse_plan`, plan partition validation, **symbol-level** frozen interfaces with signatures and `T0.interfaces`, interface requests, governed merge and shadow merge, blame rules 1-3 with widening, per-lane ladder, clash detectors (`overlapping_scope`, `scope_violation`, `interface_mismatch`, `overwrite`, `duplicated_work`, `unattributable_failure`, `wasted_lane`, `regression_after_escalation`). None of those exist in Rust, and the lane events are not in the ledger.
- Semantic difference: Python's `check_scope` classifies a path as protected then out-of-scope; Rust's frozen check applies to **every** registered lane including the writer's own (`detect_clash` iterates all lanes' frozen globs), so a lane cannot touch its own frozen interface file, which Python allows when it keeps signatures. `overlapping_scopes` in Python compares literal patterns; Rust compares a changed path against other lanes' globs (different, arguably better for runtime, weaker for plan-time).

**Claude-specific assumptions kept in Rust:** (1) price constants of the Claude Opus/Sonnet/Haiku generation (15/75, 3/15, 0.8/4) under tier names; (2) `cache_read` as the only cache bucket with an Anthropic-style 10% rate (`FRONTIER_CACHE_READ = 1.50`); (3) `input_tokens` excludes cache (conflicts with its own OpenAI aliases); (4) the doc comments reference "Contraprova Kernel Gate" ordering copied from the Claude Code hook, and `subscription_covered` models the Claude subscription. No model ids, no effort, no Messages API shapes are present, so the Rust kernel is closer to neutral than the Python, but only because it dropped the model layer.

## 7. Recommended port shape (short)
1. Fix the wire format first: adopt Python's envelope and hash (`seq` from 0, `actor`, `ts` ms-Z, dotted types, whole-envelope canonical JSON) **or** declare a new `v2` and version it in the genesis event; either way add a golden-log test shared with Python.
2. Port `EventLog.append` as a locked, verifying, validating, fsyncing single writer with the task state machine; make `open` strict.
3. Introduce `Usage`, `ModelRef`, `PriceTable` (per-bucket rates, versioned), `Capabilities`, and `TierLadder`; keep tokens in the log and dollars as projections, with the linear re-pricing property test.
4. Port gates in full (hash-bound protected files, visible/private tiers, blast-radius `T2`, pre/post snapshot diff, narrowed protected patterns, `..`/absolute rejection, timeouts, output truncation).
5. Router: ladder as data, same-tier scope retry once per tier, optional learned router later behind `route.decided` with propensities.
6. Treat Claude Code plugin/hook files and the Messages client as one adapter among several; lane planning is deferred to parataxis.
