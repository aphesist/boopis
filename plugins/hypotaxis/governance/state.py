"""The cascade as a pure state machine over the ledger (contraprova's escalation policy, research 3.3).

Nothing here does I/O, so the same functions serve the engine (what runs next), the delegation provider
(which model an attempt gets) and the ``cascade.state`` RPC (what the UI shows), and a property test can
drive them with any verdict sequence.

The policy, which is contraprova's and measured: one attempt per tier, stop at the first pass, never skip
a tier, no other model. The one exception: when the only thing wrong with a blocked attempt is a scope or
protected-file violation, the *same* tier runs once more with the violation named, before moving up. A
tier's own ``retries`` (extra attempts after a block) come first. ``TierLadder.next_index`` holds that rule;
this module only counts attempts and asks it.

The truth is the ledger: an attempt begins at a ``route.decided`` and ends at the task's next
``gate.decided``. The tier is therefore always the plugin's decision and never the model's.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .._vendor.contraprova.interfaces import TierLadder

SCOPE_GATE = "T0.scope"  # the gate whose block alone earns the same-tier scope retry

Decision = Literal["initial", "same_tier_retry", "same_tier_scope_retry", "after_gate_failure"]
Status = Literal["working", "gate", "escalating", "passed", "failed"]


@dataclass(frozen=True, slots=True)
class Attempt:
    """One worker attempt: the tier it ran at and, once the gate has decided, how it ended."""

    number: int  # 1-based, across the whole task
    tier_index: int
    decision: Decision
    verdict: str | None = None  # "pass" / "block", None while the worker is still at it
    gate: str = ""  # the gate that decided (the blocking one for a block)

    @property
    def scope_only(self) -> bool:
        """A block whose only cause is a scope or protected-file violation (the scope gate runs first and stops
        at its first block, so nothing else was checked)."""
        return self.verdict == "block" and self.gate == SCOPE_GATE


@dataclass(frozen=True, slots=True)
class Step:
    """What the cascade does next: run an attempt at ``tier_index``, or it is over."""

    kind: Literal["launch", "passed", "failed"]
    tier_index: int = -1
    decision: Decision = "initial"


def first_step(start_index: int = 0) -> Step:
    return Step("launch", start_index, "initial")


def next_step(ladder: TierLadder, attempts: Sequence[Attempt]) -> Step:
    """The step after ``attempts`` (the last of which must have a verdict). Raises ValueError if it has none."""
    if not attempts:
        raise ValueError("there is no attempt to decide on")
    last = attempts[-1]
    if last.verdict is None:
        raise ValueError(f"attempt {last.number} has no gate verdict yet")
    if last.verdict == "pass":
        return Step("passed", last.tier_index)
    here = [a for a in attempts if a.tier_index == last.tier_index]
    retried = any(a.decision == "same_tier_scope_retry" for a in here)
    again = ladder.next_index(last.tier_index, attempts_at_tier=len(here))
    if again == last.tier_index:
        return Step("launch", last.tier_index, "same_tier_retry")
    nxt = ladder.next_index(
        last.tier_index, attempts_at_tier=len(here), scope_only=last.scope_only, scope_retried=retried
    )
    if nxt is None:
        return Step("failed", last.tier_index)
    return Step("launch", nxt, "same_tier_scope_retry" if nxt == last.tier_index else "after_gate_failure")


def replay(events: Iterable[Mapping[str, Any]], task_id: str) -> list[Attempt]:
    """The task's attempts, from its ``route.decided`` and ``gate.decided`` events."""
    attempts: list[Attempt] = []
    for event in events:
        payload: Mapping[str, Any] = event["payload"]
        if payload.get("task_id") != task_id:
            continue
        if event["type"] == "route.decided":
            attempts.append(
                Attempt(len(attempts) + 1, int(payload["tier_index"]), payload.get("decision") or "initial")
            )
        elif event["type"] == "gate.decided" and attempts and attempts[-1].verdict is None:
            last = attempts[-1]
            attempts[-1] = Attempt(
                last.number, last.tier_index, last.decision, str(payload["verdict"]), str(payload.get("gate") or "")
            )
    return attempts


def status_of(ladder: TierLadder, attempts: Sequence[Attempt], *, gating: bool = False) -> Status | None:
    """The task's status; None before any attempt. ``gating`` says a ship is at the gate right now (that is
    only known to a live process, never to the ledger)."""
    if not attempts:
        return None
    last = attempts[-1]
    if last.verdict is None:
        return "gate" if gating else "working"
    step = next_step(ladder, attempts)
    if step.kind == "passed":
        return "passed"
    return "failed" if step.kind == "failed" else "escalating"


def current_tier(attempts: Sequence[Attempt]) -> int | None:
    return attempts[-1].tier_index if attempts else None
