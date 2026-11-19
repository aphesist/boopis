"""Exit codes and JSON output as decisions (docs/COMPAT.md section 4.4).

| Outcome                              | Meaning                                                                 |
|--------------------------------------|-------------------------------------------------------------------------|
| exit 0, stdout one JSON object       | its fields decide                                                       |
| exit 0, other stdout                 | plain text: context for SessionStart, UserPromptSubmit, PostToolUse     |
| exit 2                               | block where the event can; stderr goes to the model                     |
| other non-zero                       | a non-blocking error, one line in the log (``onFailure: "block"``: exit 2) |
| timeout                              | output discarded, nothing blocks (Claude: PreToolUse proceeds)           |
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from ..data import limit, table
from ..model.items import HookHandler
from ..model.jsonval import as_bool, as_dict, as_str
from .results import Outcome, PermissionDecision, Verdict

PLAIN_TEXT_CONTEXT = frozenset({"SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure"})
_DECISIONS: Mapping[str, PermissionDecision] = {"allow": "allow", "deny": "deny", "ask": "ask", "defer": "ask"}


def can_block(event: str) -> bool:
    return bool(table("hook_events")["supported"].get(event, {}).get("can_block"))


def cap_context(text: str) -> str:
    """``additionalContext`` is capped at 10,000 characters. Overflow is cut and says so (Claude spills to a file)."""
    cap = int(limit("additional_context_cap_chars"))
    if len(text) <= cap:
        return text
    return f"{text[:cap]}\n[truncated: {len(text) - cap} more characters]"


def _json_object(text: str) -> dict[str, Any] | None:
    stripped = text.strip()
    if not stripped.startswith("{"):
        return None
    try:
        value: Any = json.loads(stripped)
    except ValueError:
        return None
    return as_dict(value) if isinstance(value, dict) else None


def _from_json(event: str, data: Mapping[str, Any], hook_id: str) -> Verdict:
    specific = as_dict(data.get("hookSpecificOutput"))
    permission: PermissionDecision = "none"
    reason = as_str(specific.get("permissionDecisionReason")) or as_str(data.get("reason"))
    block = False
    if event == "PreToolUse":
        permission = _DECISIONS.get(as_str(specific.get("permissionDecision")), "none")
        legacy = as_str(data.get("decision"))  # the deprecated top-level form: approve | block
        if permission == "none" and legacy in ("block", "deny"):
            permission = "deny"
        elif permission == "none" and legacy == "approve":
            permission = "allow"
    elif as_str(data.get("decision")) == "block":
        block = can_block(event)
    if data.get("continue") is False and event in ("PreToolUse", "UserPromptSubmit"):
        block = True
        reason = as_str(data.get("stopReason")) or reason or "a hook stopped this."
    updated = specific.get("updatedInput")
    context = cap_context(as_str(specific.get("additionalContext")) or as_str(data.get("additionalContext")))
    feedback = ""
    if event in ("PostToolUse", "PostToolUseFailure") and as_str(data.get("decision")) == "block":
        feedback = reason  # the tool already ran: the reason is feedback for the model
    return Verdict(
        permission=permission,
        block=block,
        reason="" if event in ("PostToolUse", "PostToolUseFailure") else reason,
        context="\n".join(p for p in (context, feedback) if p),
        updated_input=dict(as_dict(updated)) if isinstance(updated, dict) else None,
        system_message=as_str(data.get("systemMessage")),
        hook_ids=(hook_id,),
    )


def interpret(event: str, outcome: Outcome, handler: HookHandler) -> Verdict:
    """The verdict of one handler run."""
    ids = (outcome.hook_id,)
    if outcome.error:
        return _failure(event, handler, outcome, f"{outcome.hook_id}: {outcome.error}")
    if outcome.timed_out:
        return Verdict(errors=(f"{outcome.hook_id}: timed out",), hook_ids=ids)
    code = outcome.exit_code
    if code == 0:
        data = _json_object(outcome.stdout)
        if data is not None:
            return _from_json(event, data, outcome.hook_id)
        text = outcome.stdout.strip()
        return Verdict(context=cap_context(text) if text and event in PLAIN_TEXT_CONTEXT else "", hook_ids=ids)
    if code == 2:
        return _exit2(event, outcome)
    line = f"{outcome.hook_id}: exit {code}" + (
        f": {outcome.stderr.strip().splitlines()[0]}" if outcome.stderr.strip() else ""
    )
    return _failure(event, handler, outcome, line)


def _exit2(event: str, outcome: Outcome) -> Verdict:
    message = outcome.stderr.strip() or "a hook blocked this without saying why."
    ids = (outcome.hook_id,)
    if event in ("PostToolUse", "PostToolUseFailure"):
        return Verdict(context=message, hook_ids=ids)  # the tool ran: stderr is appended to its result
    if can_block(event):
        return Verdict(block=True, reason=message, hook_ids=ids)
    return Verdict(errors=(f"{outcome.hook_id}: exit 2 cannot block {event} here",), hook_ids=ids)


def _failure(event: str, handler: HookHandler, outcome: Outcome, line: str) -> Verdict:
    """A handler that failed. ``onFailure: "block"`` makes the failure a block, as exit 2 would."""
    if handler.on_failure == "block":
        forced = Outcome(outcome.hook_id, 2, stderr=outcome.stderr.strip() or line)
        return _exit2(event, forced)
    return Verdict(errors=(line,), hook_ids=(outcome.hook_id,))


__all__ = ["as_bool", "can_block", "cap_context", "interpret"]
