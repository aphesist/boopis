"""Values the policy takes and returns. Pure data: no I/O, no Hermes imports."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from ..config.model import Fallback, Mode

DecisionKind = Literal["allow", "block", "approve", "modify"]
Role = Literal["orchestrator", "worker"]
CallSource = Literal["hook", "kernel", "kernel_sh"]


@dataclass(frozen=True, slots=True)
class ToolCall:
    """One tool call to judge. ``source`` says which entry point asked: the ``pre_tool_call`` hook,
    or the exec kernel (``ctx.dispatch_tool`` bypasses hooks, ADR-0005). ``kernel_sh`` is the kernel's
    own ``harness.sh``, judged as a ``terminal`` call: user rules apply to it, but it runs in the sandbox."""

    tool: str
    args: Mapping[str, Any] = field(default_factory=dict)
    session_id: str = ""
    tool_call_id: str = ""
    source: CallSource = "hook"


@dataclass(frozen=True, slots=True)
class Decision:
    """The answer. ``message`` is what the model (or the human, for ``approve``) reads.

    - ``allow``: proceed to Hermes's own gates unchanged.
    - ``block``: do not run; the model sees ``{"error": message}``.
    - ``approve``: a human must confirm first; ``rule_key`` names what Hermes remembers.
    - ``modify``: run with ``args`` instead.
    ``reason`` is a short stable tag for the ledger and tests (``deny_rule``, ``governed``,
    ``protected_path``, ``ask_rule``, ``fail_closed``, ...); ``rule`` is the rule text that fired.
    """

    kind: DecisionKind
    message: str = ""
    rule_key: str = ""
    args: Mapping[str, Any] | None = None
    reason: str = ""
    rule: str = ""

    @property
    def allowed(self) -> bool:
        return self.kind in ("allow", "modify")

    def directive(self) -> dict[str, Any] | None:
        """This decision as a Hermes ``pre_tool_call`` directive, None for a plain allow."""
        if self.kind == "block":
            return {"action": "block", "message": self.message}
        if self.kind == "approve":
            return {"action": "approve", "message": self.message, "rule_key": self.rule_key}
        if self.kind == "modify":
            return {"action": "modify", "args": dict(self.args or {})}
        return None


ALLOW = Decision("allow")


def block(message: str, reason: str, rule: str = "") -> Decision:
    return Decision("block", message=message, reason=reason, rule=rule)


@dataclass(frozen=True, slots=True)
class SessionPolicy:
    """Everything ``check`` needs about one session, resolved once at the session's first prompt.

    ``deny``, ``ask`` and ``allow`` hold rule texts from every source (settings and the project
    file). ``config_error`` set means the configuration could not be trusted: only read-only tools
    run until it is fixed. ``role`` and ``ship_closed`` matter in governed mode: the orchestrator reads
    (``pack``) and ``dispatch``es; a worker reads (``pack``), runs ``exec`` and ``ship``s, once per attempt.
    """

    mode: Mode
    cwd: str = ""
    deny: tuple[str, ...] = ()
    ask: tuple[str, ...] = ()
    allow: tuple[str, ...] = ()
    default: Fallback = "allow"
    protected: tuple[str, ...] = ()
    config_error: str = ""
    hook_allow: bool = True  # a Claude Code hook's allow skips this policy's approval prompts (docs/COMPAT.md 4.4)
    role: Role = "orchestrator"  # the session model, or a delegated worker attempt (governed mode)
    ship_closed: str = ""  # a worker whose attempt is over (or has no task): why ship is refused; empty = open
