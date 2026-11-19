"""What a ship means to a cascade worker: one attempt, ended by the gate.

A worker's ``ship`` is the attempt's submission. Whatever the gate decides (or hx refuses before writing anything for
a scope or protected-file violation, which is the same scope gate acting early) closes the attempt: the verdict goes
into ``gate.decided`` for the task and tier, the link records it so the policy refuses a second ``ship``, and a block
keeps what the next tier is told: the gate's finding, the failing output and the rejected change as a diff, taken
before the restore.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..errors import HxCallError
from ..governance.handover import Failure
from ..governance.links import WorkerLink
from ..governance.state import SCOPE_GATE
from ..hx.types import PathsData
from ..session import Runtime, SessionState
from . import gate as gate_mod
from . import results as out

SCOPE_CODES = ("hx.txn.scope_violation", "hx.txn.protected_path")


def gate_tags(worker: WorkerLink) -> dict[str, Any]:
    """The extra fields of a worker's ``gate.decided``: which attempt, at which tier."""
    return {"attempt": worker.attempt, "tier": worker.tier}


def conclude(worker: WorkerLink, run: gate_mod.GateRun | None) -> None:
    """Record the gate's verdict on the attempt. A switched-off gate (``run`` None) passes, as its payload says."""
    if run is None:
        worker.verdict, worker.gate = "pass", "disabled"
        return
    worker.verdict, worker.gate = run.results[-1].verdict, run.results[-1].gate


def failure_of(
    worker: WorkerLink, gate: str, reason: str, output: str, diff: str, evidence: Mapping[str, Any]
) -> Failure:
    """What the next attempt is told about this block."""
    violations = evidence.get("violations") or ()
    paths = tuple(str(v["path"]) for v in violations if isinstance(v, Mapping))  # pyright: ignore[reportUnknownVariableType]
    return Failure(
        tier=worker.tier,
        attempt=worker.attempt,
        gate=gate,
        reason=reason,
        output=output,
        diff=diff,
        paths=paths,
        scope_only=gate == SCOPE_GATE,
    )


def reject_before_write(
    rt: Runtime, state: SessionState, worker: WorkerLink, exc: HxCallError, protected: Sequence[str]
) -> dict[str, Any] | None:
    """hx refused the edits for scope or a protected path before writing: the attempt's submission broke the scope gate.
    Recorded as one (``task.submitted`` then a ``T0.scope`` block), so the state machine counts the attempt and the
    cascade can give the same tier its one scope retry. None for any other refusal, which is not a verdict."""
    if exc.code not in SCOPE_CODES:
        return None
    paths = list(PathsData.from_wire(exc.data).paths) if "paths" in exc.data else []
    ledger = rt.ledger(state)
    ledger.append(
        "task.submitted",
        worker.actor,
        {"task_id": worker.task_id, "attempt": worker.attempt, "tier": worker.tier, "files": sorted(paths)},
    )
    payload = gate_mod.scope_block_payload(worker.task_id, paths, exc.code.endswith("protected_path"))
    ledger.append("gate.decided", "gate", payload | gate_tags(worker))
    worker.verdict, worker.gate = "block", SCOPE_GATE
    worker.failure = failure_of(worker, SCOPE_GATE, payload["reason"], "", "", payload["gates"][0]["evidence"])
    what = "protected" if exc.code.endswith("protected_path") else "outside the allowed scope"
    result = out.blocked(exc.code, paths, f"Nothing was written: these paths are {what}.")
    result["attempt_over"] = worker.closed_reason()
    return result
