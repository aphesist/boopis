"""Values the hook engine passes around."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

PermissionDecision = Literal["none", "allow", "ask", "deny"]
_RANK: Mapping[str, int] = {"none": 0, "allow": 1, "ask": 2, "deny": 3}


@dataclass(frozen=True, slots=True)
class Outcome:
    """How one handler run ended, before its output is interpreted."""

    hook_id: str
    exit_code: int | None  # None: timed out, or never started
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False
    truncated: bool = False
    error: str = ""
    duration_s: float = 0.0


@dataclass(frozen=True, slots=True)
class Verdict:
    """What one handler (or, combined, one event) decided.

    ``permission`` is the PreToolUse decision; ``block`` is a stop (exit 2, ``decision: block``, or
    ``continue: false``); ``updated_input`` is a rewrite of the tool input. Combination is strictest first:
    a block beats ``deny`` beats ``ask`` beats ``allow`` beats nothing.
    """

    permission: PermissionDecision = "none"
    block: bool = False
    reason: str = ""  # what the model reads when the event blocks
    context: str = ""  # additionalContext, or plain stdout for the events that take it
    updated_input: Mapping[str, Any] | None = None
    system_message: str = ""
    errors: tuple[str, ...] = ()  # non-blocking failures: one line each, for the log
    hook_ids: tuple[str, ...] = ()

    @property
    def blocks(self) -> bool:
        return self.block or self.permission == "deny"


def combine(verdicts: list[Verdict]) -> Verdict:
    """The strictest of ``verdicts``, in hook order: reasons and contexts are joined, the last rewrite wins."""
    if not verdicts:
        return Verdict()
    permission: PermissionDecision = max((v.permission for v in verdicts), key=lambda p: _RANK[p])
    updated: Mapping[str, Any] | None = None
    for v in verdicts:
        if v.updated_input is not None:
            updated = v.updated_input
    blockers = [v for v in verdicts if v.blocks]
    reasons = [v.reason for v in (blockers or verdicts) if v.reason]
    return Verdict(
        permission=permission,
        block=any(v.block for v in verdicts),
        reason="\n".join(reasons),
        context="\n\n".join(v.context for v in verdicts if v.context),
        updated_input=updated,
        system_message="\n".join(v.system_message for v in verdicts if v.system_message),
        errors=tuple(e for v in verdicts for e in v.errors),
        hook_ids=tuple(i for v in verdicts for i in v.hook_ids),
    )


@dataclass(frozen=True, slots=True)
class Directive:
    """What the bridge hands back to Hermes for a ``pre_tool_call``: a block, an approval request, or a rewrite."""

    action: Literal["none", "block", "approve", "modify"] = "none"
    message: str = ""
    rule_key: str = ""
    args: Mapping[str, Any] = field(default_factory=dict)
    allowed_by_hook: bool = False  # a hook said allow: hypotaxis-level approval prompts are skipped (COMPAT 4.4)
