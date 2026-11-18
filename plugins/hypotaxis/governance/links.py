"""Who a session is: the orchestrator, or one worker attempt of one task.

Hermes runs a delegated child as its own session, with its own id. ``subagent_start`` (verified on v0.23.2:
it fires on the thread that launched the child, after ``route_task``, before the child's first request) is
where the plugin learns which child belongs to which task and tier, so every later hook and tool call of
that child session can be resolved here, whatever Hermes's toolset inheritance does.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .handover import Failure


@dataclass(slots=True)
class WorkerLink:
    """One worker attempt. ``session_id`` is the child's own session; everything is written to the parent's ledger."""

    session_id: str
    parent_session_id: str
    task_id: str
    tier_index: int
    tier: str
    attempt: int
    provider: str  # the route the plugin chose, so the plugin can check the child really runs on it
    model: str
    scope: tuple[str, ...]
    verdict: str | None = None  # the gate's verdict for this attempt once decided; the attempt is over then
    gate: str = ""
    failure: Failure | None = None  # what the next attempt is told, set with a block
    calls: list[tuple[str, str]] = field(
        default_factory=list
    )  # (tool, tool_call_id) seen by pre_tool_call, not yet run

    @property
    def actor(self) -> str:
        return f"worker:{self.provider}/{self.model}"

    def closed_reason(self) -> str:
        """Why ``ship`` is refused for this attempt, empty while it is open."""
        if self.verdict is None:
            return ""
        return (
            f"The gate has already decided this attempt ({self.verdict}), so it is over. Do not call ship again: "
            "stop and give your short report. The system decides what happens next."
        )
