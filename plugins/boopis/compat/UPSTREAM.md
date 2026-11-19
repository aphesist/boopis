# Draft upstream issue for Hermes (for the owner to file; not filed)

**Title:** A turn-end plugin hook that can continue the turn (generalising `pre_verify`)

**Context.** Plugins that enforce a "do not stop yet" policy (Claude Code's `Stop` hook, CI-style checks, boopis's
gate) have no good place to run in Hermes v0.23.2.

- `pre_verify` can continue a turn (`{"action": "continue", "message"}`, or the Claude Code shape
  `{"decision": "block", "reason"}`), but it fires only when the turn edited files with `write_file` or `patch`
  (`agent/tool_result_classification.py: FILE_MUTATING_TOOL_NAMES`, read by `_turn_file_mutation_paths`), and at most
  `agent.max_verify_nudges` times. A plugin tool that writes the workspace (here, `ship`) never triggers it, and a turn
  that only ran commands never does either.
- `post_llm_call` fires at the end of every completed turn, but its return value is ignored.
- `ctx.inject_message` can queue a user message from a hook, but that starts a **new turn after the answer** has already
  been shown, and it needs the operator to set `allow_gateway_injection`.

**Proposal.** Add one hook, for example `pre_turn_end` (or let `pre_verify` fire on every turn that is about to
finish), with these properties:

1. Fires once per candidate final answer, whether or not files were edited, before the answer is delivered.
2. Kwargs as `pre_verify` today (`session_id`, `final_response`, `attempt`, `changed_paths`, `coding`, ...), plus
   `tool_call_count` and `interrupted`.
3. Returns `{"action": "continue", "message": ...}` to keep the loop going in the same turn. Same cap as now
   (`max_verify_nudges`), and a documented `attempt` so a plugin can stop itself.
4. Fail-open on a timeout, like the other bounded hooks, so a hung plugin cannot trap the loop.
5. The attempted answer stays in history but is not shown while the agent is being nudged (as for `pre_verify`).

**Why this is small.** `agent/turn_stop_gates.py` already has the machinery (`_pre_verify_nudge`, the cap, the synthetic
user turn). The change is dropping the "the agent edited code this turn" precondition, or making it a hook argument
the plugin can opt out of.

**What it unlocks.** Claude Code `Stop` hooks that behave as in Claude Code (a continuation inside the turn, with the
reason as the next instruction), without a second turn and without `allow_gateway_injection`. It also serves Codex's
turn-end hooks and Gemini's `AfterAgent`.

**Workaround in the meantime.** boopis runs `Stop` at the final `post_llm_call` and re-enters a block through
`ctx.inject_message`. See `docs/COMPAT.md` section 4.1.
