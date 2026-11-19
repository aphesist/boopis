# Ledger

One hash-chained JSONL file per Hermes session: `<profile home>/boopis/ledger/<session_id>.jsonl`. The format is **contraprova's** (`aphesist/contraprova`, `src/contraprova/events.py`, `log.py`, `docs/events.md`), byte for byte. `contraprova verify`, `cost` and `report` work on boopis ledgers unchanged.

## Envelope and hash
- Every line is the canonical JSON of `{seq, type, actor, ts, payload, prev_hash, hash}`.
- **Canonical JSON:** keys sorted recursively, separators `,` and `:`, raw UTF-8, NaN and Infinity forbidden. Integers stay integers.
- `seq` starts at 0, and `prev_hash` of event 0 is 64 zeros.
- `hash = sha256(canonical_json({seq, type, actor, ts, payload, prev_hash}))`.
- `ts` is UTC with milliseconds and `Z`.
- `actor` is one of `user`, `plugin`, `gate`, `orchestrator:<provider>/<model>`, `worker:<provider>/<model>`, or `teammate:<profile>`.
- **The single writer:**
  - takes an exclusive file lock (`fcntl.flock` on POSIX, `msvcrt.locking` on Windows; the portable lock goes upstream into contraprova);
  - verifies the tail;
  - validates the event against the task projection (illegal events are never written);
  - writes, flushes, then fsyncs.
- **Verification:** incremental verification on append (cached tail hash and seq, file size and mtime as a staleness check) meets the 5 ms budget. A full `verify_chain` runs on open and on demand. A broken chain is flagged in the app and never silently repaired.

## Event types
Contraprova's 14 types keep their exact payloads:
- `task.created`, `task.claimed`, `task.submitted`, `gate.decided`;
- `route.decided`, `router.trained`, `fork.created`;
- `usage.recorded`, `outcome.scored`;
- `lane.planned`, `interface.frozen`, `interface.requested`, `merge.decided`, `coordination.detected`.

The harness adds the types below. They go upstream into contraprova's `EVENT_TYPES` and `docs/events.md`. Payload fields not listed here are allowed (contraprova's rule).

| type | required payload | notes |
|---|---|---|
| `session.opened` | `session_id`, `mode` (`governed`/`ungoverned`), `cwd`, `hermes_version`, `plugin_version` | `profile`, `ladder` (the tier ladder as data), `gate_command_sha256`, `price_table` |
| `session.closed` | `session_id`, `reason` | |
| `tool.called` | `tool_call_id`, `tool`, `status` (`ok`/`error`/`blocked`), `duration_ms` | `args_sha256`, `error_code`, `task_id`. Arguments are hashed, never stored |
| `ship.applied` | `ship_id`, `files` (list of `{path, sha256_before, sha256_after}`) | `task_id`, `journal_id` |
| `ship.restored` | `ship_id`, `reason` | restored byte and metadata exact |
| `checkpoint.committed` | `ship_id`, `ref`, `commit` | |
| `approval.requested` | `approval_id`, `kind`, `summary`, `rule` | `task_id`, `teammate` |
| `approval.decided` | `approval_id`, `decision` (`approve`/`deny`/`timeout`), `decided_by`, `surface` | |
| `blank.opened` | `blank_id`, `question`, `options` (list of strings), `blocks` (list of strings: the steps that wait for the answer; empty = nothing blocked) | `task_id` |
| `blank.filled` | `blank_id`, `answer`, `decided_by` | |
| `blank.lapsed` | `blank_id` | became an end-of-turn question |
| `feedforward.set` | `turn_id`, `decision`, `value`, `source` (`config`/`convention`/`model`/`user`) | |
| `mode.changed` | `from`, `to` | |
| `budget.blocked` | `cap_usd`, `price_table` | dollars beyond the cap value are computed, never stored |

### Pending upstream: form events
Forms (`docs/FORMS.md` section 6) are recorded today as `tool.called` events whose `tool` is `form.opened` or `form.resolved`, because contraprova's `EVENT_TYPES` has no `form.*` yet. The extra keys are `form_id`, `kind`, `origin`, and then `fields` and `secrets` (names only) on open, or `form_status` (`submitted`, `cancelled`, `expired`), `provided` (the secret fields saved to the host) and `answered` (the non-secret field names) on resolve. Values are never written. Upstream adds `form.opened` (`form_id`, `kind`, `fields`) and `form.resolved` (`form_id`, `form_status`, `provided`) to `HARNESS_EVENT_TYPES` and `REQUIRED_FIELDS`; the plugin then writes them under those names and stops using `tool.called`. The vendored copy is not edited.

Automation grants (`docs/AUTOMATION.md` section 9) follow the same path: `grant.decided` (`grant_id`, `principal`, `capability`, `subject`, `scope`) and `grant.revoked` (`grant_id`, `reason`) go upstream together with `form.*`, and until then are written as `tool.called` with that `tool` name. Gated tool calls add the keys `capability`, `target`, `action_class`, `grant_id`, `decision` and `lease_epoch` to `tool.called`.

## Usage, made provider-neutral
`usage.recorded` keeps contraprova's required fields: `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_5m_tokens`, `cache_write_1h_tokens`. `input_tokens` means **uncached** input, as in contraprova. The harness adds:
- `provider`;
- `reasoning_tokens`;
- `latency_ms`;
- `request_id`;
- `usage_schema: 2`;
- `subscription` (bool: billed to a plan, not the API). The usage of Hermes's Claude subscription plugin (provider `claude-subscription-directsdk-experimental`, ADR-0029) always carries `true`, whatever the settings say (`PLAN_PROVIDERS`); the `subscription_providers` setting only adds providers. Such a record bills zero, and a list price the CLI reports natively (`total_cost_usd`) is never read, stored or shown as a charge: dollars come from tokens, and an API-equivalent figure exists only when the price table has the model. `ledger.stats` carries `subscription: true` when every request so far was a plan's, so the UI can say the plan covers it.

Providers that report a single cache-write bucket put it in `cache_write_5m_tokens`.

`output_tokens` is always the total billable output, **including** reasoning, and `reasoning_tokens` is a subset of it. Gemini reports thoughts separately, so its mapper adds them into `output_tokens`. Pricing charges reasoning at the reasoning rate when one is set and the output rate otherwise, never twice. Abstract effort levels are `none`, `low`, `medium`, `high`, `xhigh` and `max`.

Each adapter maps its provider's usage into these fields. The mapping lives in one place (`boopis.ledger.usage`), with a test per provider shape:
- **OpenAI:** `prompt_tokens` *includes* `cached_tokens`, so subtract them.
- **Gemini:** use `cachedContentTokenCount` and `thoughtsTokenCount`.
- **DeepSeek:** use the hit and miss counts.
- **Ollama:** use `prompt_eval_count` and `eval_count`.

## Governed tasks
A `dispatch(brief)` is a contraprova task:
1. `task.created`. Scope comes from the brief. The test command comes from project config, never from the brief.
2. `route.decided` for each tier, with propensity 1 for the fixed cascade.
3. `task.claimed` by the worker.
4. `task.submitted` on ship.
5. `gate.decided`.
6. `fork.created` for controls, when the policy forks.
7. `outcome.scored` when known.

## Tests
- Contraprova's `test_properties.py`, `test_log.py` and `test_pricing.py` are ported 1:1.
- A golden ledger with fixed timestamps lives in both repositories, and both must reproduce its hashes.
- An extra property test: a ledger written on Windows (msvcrt lock) and on POSIX hashes identically.
