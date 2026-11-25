"""The Session tab's permission scale (ADR-0057, docs/specs/session-launch.md section 5): one step of four, a step of
``policy.check`` after the governed check.

| Step | Mode | The plugin asks before |
|---|---|---|
| ``supervised`` | governed | every ``ship`` and every ``exec`` call (and the governed network tools, as before) |
| ``auto_edits`` | governed | every ``exec`` call (and the governed network tools); ships apply when the gate passes |
| ``auto`` | governed | nothing of its own: only the owner's rules ask (``ask`` rules, the configured default) |
| ``full`` | ungoverned | nothing: every ask becomes allow; blocks stay blocks |

On the session surface (``surface == "session"``) the engine's direct-write tools are refused at every step, Full
access included, also when an exec cell calls them through ``dispatch_tool``: every change goes through ``ship``. A
session-surface session whose step is unknown runs read-only tools only (fail closed). Pure: no I/O.
"""

from __future__ import annotations

from typing import Final, Literal

from .data import Defaults
from .types import ALLOW, Decision, SessionPolicy, ToolCall, block

Careful = Literal["supervised", "auto_edits", "auto", "full"]
Surface = Literal["session", "bot", "cli"]
STEPS: Final[tuple[Careful, ...]] = ("supervised", "auto_edits", "auto", "full")
GOVERNED_STEPS: Final[frozenset[str]] = frozenset({"supervised", "auto_edits", "auto"})
SURFACES: Final[tuple[Surface, ...]] = ("session", "bot", "cli")
NAMES: Final[dict[str, str]] = {
    "supervised": "Supervised",
    "auto_edits": "Auto-accept edits",
    "auto": "Auto",
    "full": "Full access",
}
_WHAT = {"ship": "change", "exec": "command"}


def mode_of(careful: str) -> str:
    """The mode a step runs in: ``full`` is ungoverned, the three others governed."""
    return "ungoverned" if careful == "full" else "governed"


def step_decision(call: ToolCall, session: SessionPolicy, defaults: Defaults) -> Decision | None:
    """A block or an ask of the scale itself, None to go on with the rest of ``check``."""
    if session.surface != "session":
        return _ask_of_step(call, session)
    if call.source == "kernel_sh":
        return None  # harness.sh runs in the kernel's own sandbox: the workspace is read-only to it
    read_only = call.tool in defaults.read_only_tools
    if session.careful not in STEPS:
        if read_only and call.tool not in defaults.network_tools:
            return None
        return block(
            "This session's permission step is not known, so only read-only tools run until it is set.",
            "careful_unset",
        )
    if call.tool not in defaults.own_tools and not read_only and call.tool not in defaults.network_tools:
        return block(
            f"In the Session tab every change goes through ship, so `{call.tool}` is not available here.",
            "session_surface",
        )
    return _ask_of_step(call, session)


def _ask_of_step(call: ToolCall, session: SessionPolicy) -> Decision | None:
    careful = session.careful
    if careful == "supervised" and call.tool in ("ship", "exec"):
        return _ask(careful, call)
    if careful == "auto_edits" and call.tool == "exec":
        return _ask(careful, call)
    return None


def _ask(careful: str, call: ToolCall) -> Decision:
    rule = f"careful.{careful}"
    what = _WHAT.get(call.tool, call.tool)
    every = "every change and every command" if careful == "supervised" else "every command"
    return Decision(
        "approve",
        message=f"{NAMES[careful]} asks before {every}: allow this {what}?",
        rule_key=f"boopis:{rule}.{call.tool}",
        reason="careful",
        rule=rule,
    )


def skips_network_ask(session: SessionPolicy) -> bool:
    """At Auto only the owner's rules ask: the governed network ask is not one of them."""
    return session.careful in ("auto", "full")


def lift(decision: Decision, session: SessionPolicy) -> Decision:
    """Full access: an ask becomes allow; a block stays a block."""
    if session.careful == "full" and decision.kind == "approve":
        return ALLOW
    return decision
