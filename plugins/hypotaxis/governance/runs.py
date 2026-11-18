"""The live side of a cascade: what a process knows that the ledger does not.

The ledger is the truth about attempts and verdicts (``state.replay``). A ``TaskRun`` holds only what cannot
be recovered from it: the brief's words, the parent agent to launch the next tier from, whether a ship is at
the gate right now, and the outcome the orchestrator has yet to be told. It is in memory on purpose: a worker
is a thread of this process, so a cascade does not outlive it.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from .._vendor.contraprova.interfaces import TierLadder
from .brief import Brief


@dataclass(frozen=True, slots=True)
class Final:
    """How a task ended, and the words that tell the orchestrator."""

    status: Literal["passed", "failed"]
    tier: str  # the tier that passed, or the last one tried
    attempts: int
    message: str


@dataclass(slots=True)
class TaskRun:
    task_id: str
    session_id: str
    brief: Brief
    ladder: TierLadder
    start_index: int
    max_attempts: int
    parent: Callable[[], Any] | None = None  # a weak reference to the orchestrator's agent
    gating: bool = False  # a ship of this task is at the gate now
    final: Final | None = None
    told: bool = False  # the orchestrator has been given ``final``
    reason: str = ""  # why a task ended without a gate verdict (a launch that failed): never in the ledger
    lock: threading.RLock = field(default_factory=threading.RLock)


class Cascades:
    """The runs of every session of this process."""

    def __init__(self) -> None:
        self._runs: dict[str, list[TaskRun]] = {}
        self._lock = threading.Lock()

    def add(self, run: TaskRun) -> None:
        with self._lock:
            self._runs.setdefault(run.session_id, []).append(run)

    def latest(self, session_id: str) -> TaskRun | None:
        with self._lock:
            runs = self._runs.get(session_id)
            return runs[-1] if runs else None

    def active(self, session_id: str) -> TaskRun | None:
        """The session's task that has not ended, if any (at most one runs at a time)."""
        run = self.latest(session_id)
        return run if run is not None and run.final is None else None

    def find(self, task_id: str) -> TaskRun | None:
        with self._lock:
            return next((r for runs in self._runs.values() for r in runs if r.task_id == task_id), None)

    def forget(self, session_id: str) -> None:
        with self._lock:
            self._runs.pop(session_id, None)
