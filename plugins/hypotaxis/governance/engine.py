"""``dispatch``, and the launch of one attempt.

``dispatch(brief)`` is the orchestrator's only way to get work done. It never names a model: the plugin writes the
contraprova task (``task.created``), decides the tier (``route.decided``, propensity 1: a fixed cascade, not a
learned router) and launches a worker through Hermes's own ``delegate_task``, called with ``ctx.dispatch_tool`` and
routed by the plugin's delegation provider (``delegation``), which reads the tier back from the ledger. The same
``launch`` runs the next tier after a block (``lifecycle``), so a stronger model is bought only by a gate verdict.

Verified on Hermes v0.23.2: ``delegate_task`` has no per-task ``toolsets`` (a spawn always inherits the parent's,
minus ``delegate_task``), so a worker can see ``dispatch``; the policy, by role, is what stops it.
"""

from __future__ import annotations

import hashlib
import json
import uuid
import weakref
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, cast

from .. import budget
from .._vendor.contraprova.events import canonical_json
from .._vendor.contraprova.interfaces import TierLadder
from ..session import Runtime, SessionState
from ..ship import gate as gate_mod
from ..util.log import get_logger
from . import handover
from .brief import Brief, parse_brief
from .host import BACKEND
from .ladder import ladder_problems, max_attempts, start_index, tier_views
from .runs import TaskRun
from .state import Step, current_tier, first_step, replay, status_of

_log = get_logger("governance.engine")


@dataclass(frozen=True, slots=True)
class Launch:
    """The attempt being launched. Hermes builds the child, asks the delegation provider for its route and fires
    ``subagent_start`` on the thread that called ``delegate_task`` (verified), so a context variable carries the
    attempt to all three without any of them being told by the model."""

    session_id: str
    task_id: str
    tier_index: int
    attempt: int


CURRENT: ContextVar[Launch | None] = ContextVar("hypotaxis_launch", default=None)


class Refused(Exception):
    """``dispatch`` will not start: nothing was launched and nothing was written."""


class LaunchError(Exception):
    """An attempt could not be launched; the task ends without a gate verdict."""


def _refuse(message: str) -> dict[str, Any]:
    return {"status": "refused", "launched": False, "reason": message}


def dispatch(rt: Runtime, state: SessionState, args: dict[str, Any]) -> dict[str, Any]:
    """Run one brief through the ladder. Never raises: every failure is a result."""
    try:
        brief, ladder = _checked(rt, state, args)
        return _start(rt, state, brief, ladder)
    except Refused as exc:
        return _refuse(str(exc))
    except Exception as exc:  # noqa: BLE001 - a tool handler never raises into Hermes
        _log.error("dispatch failed", exc_info=True)
        return {"error": f"dispatch failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"}


def _checked(rt: Runtime, state: SessionState, args: dict[str, Any]) -> tuple[Brief, TierLadder]:
    """Everything that must hold before a task exists. The first failure refuses, naming what to fix."""
    if state.mode != "governed":
        raise Refused("dispatch runs the governed cascade and this session is not governed.")
    problems = list(state.config_errors)
    if problems:
        raise Refused("the plugin configuration is invalid: " + "; ".join(problems))
    if state.settings.forks:
        raise Refused(
            "forks (contraprova's control replicates) are not yet supported. Set `forks` to false in the plugin "
            "settings; the cascade runs without them."
        )
    try:
        ladder = rt.ladder_of(state)
    except (ValueError, KeyError) as exc:
        raise Refused(f"the tier ladder is invalid: {exc}") from exc
    problems = ladder_problems(ladder, rt.provider_known, rt.start_tier_of(state))
    if problems:
        raise Refused("the tier ladder cannot run: " + "; ".join(problems))
    backend = rt.delegation_backend()
    if backend != BACKEND:
        raise Refused(
            f"Hermes routes delegated children by delegation.backend, which is {backend!r}; tiers only follow the "
            f"ladder when it is {BACKEND!r} (the host or installer sets it, with your consent). Nothing was launched."
        )
    _check_gate(state)
    brief_text = args.get("brief")
    if not isinstance(brief_text, str):
        raise Refused("dispatch needs `brief`, a text that starts with the lines `scope:` and `goal:`.")
    brief, issues = parse_brief(brief_text, state.settings.cascade.brief_max_chars)
    if brief is None:
        raise Refused("; ".join(issues))
    active = rt.cascades.active(state.session_id)
    if active is not None:
        raise Refused(
            f"task {active.task_id} is still running; its outcome arrives as a message. "
            "Do not dispatch again until then."
        )
    if rt.active_parent() is None:
        raise Refused("dispatch can only run inside a session's turn, and none is active.")
    return brief, ladder


def _check_gate(state: SessionState) -> None:
    """The test command is the project's trusted gate command, never the brief's. With none, nothing runs."""
    if state.gate_enabled is False:
        return
    command = state.project.settings.gate_command if state.project else None
    if not command:
        raise Refused(
            "governed mode needs the project's gate command, and none is configured and trusted "
            "(gate.command in .hermes/hypotaxis.yaml, approved by the user). Nothing was launched."
        )
    try:
        gate_mod.parse_command(command)
    except ValueError as exc:
        raise Refused(f"the gate command cannot be used: {exc}. Nothing was launched.") from exc


def _start(rt: Runtime, state: SessionState, brief: Brief, ladder: TierLadder) -> dict[str, Any]:
    first = start_index(ladder, rt.start_tier_of(state))
    run = TaskRun(
        task_id=f"task-{uuid.uuid4().hex[:12]}",
        session_id=state.session_id,
        brief=brief,
        ladder=ladder,
        start_index=first,
        max_attempts=max_attempts(ladder, first),
    )
    rt.ledger(state).append(
        "task.created",
        "plugin",
        {
            "task_id": run.task_id,
            "title": brief.title,
            "kind": "code",
            "scope": list(brief.scope),
            "max_attempts": run.max_attempts,
            "prompt_sha256": hashlib.sha256(brief.text.encode("utf-8")).hexdigest(),
        },
    )
    rt.cascades.add(run)
    with run.lock:
        try:
            launch(rt, state, run, first_step(first), None)
        except LaunchError as exc:
            from .lifecycle import fail

            fail(rt, state, run, str(exc))
            return {"status": "failed", "task_id": run.task_id, "launched": False, "reason": str(exc)}
    result: dict[str, Any] = {
        "status": "dispatched",
        "task_id": run.task_id,
        "tier": ladder.tiers[first].name,
        "tiers": list(ladder.names[first:]),
        "max_attempts": run.max_attempts,
        "scope": list(brief.scope),
        "note": (
            "A worker is running on the first tier. The plugin, not you, escalates on a gate block, and tells you "
            "the final outcome in a message. End your turn now with one short line; do not poll or dispatch again."
        ),
    }
    if brief.ignored_test:
        result["ignored_test_command"] = brief.ignored_test
        result["test_note"] = "The brief's test: line was ignored: the gate runs the project's own pinned command."
    if run.final is not None:  # delegate_task ran the child inline (a session that cannot receive a later turn)
        result.update(status=run.final.status, note=run.final.message)
    return result


def _router_hash(ladder: TierLadder, first: int) -> str:
    return hashlib.sha256(canonical_json({"cascade": ladder.to_dict(), "start_index": first}).encode()).hexdigest()


def launch(rt: Runtime, state: SessionState, run: TaskRun, step: Step, previous: handover.Failure | None) -> None:
    """Decide and start one attempt. Raises ``LaunchError``; the caller ends the task."""
    from .lifecycle import announce

    tier = run.ladder.tiers[step.tier_index]
    stop = budget.cap_block(state, tier.model.provider, tier.model.id)
    if stop is not None:
        budget.record_block(rt, state, stop[1])
        raise LaunchError(stop[0])
    agent = rt.active_parent() or (run.parent() if run.parent else None)
    if agent is None:
        raise LaunchError("the orchestrator's session is not available to launch the next tier from.")
    ledger = rt.ledger(state)
    number = len(replay(ledger.read(), run.task_id)) + 1
    ledger.append(
        "route.decided",
        "plugin",
        {
            "task_id": run.task_id,
            "decision": step.decision,
            "action": tier.model.id,
            "propensities": {tier.model.id: 1.0},
            "router_hash": _router_hash(run.ladder, run.start_index),
            "features": {"attempt": min(1.0, (number - 1) / 2)},
            "tier": tier.name,
            "tier_index": step.tier_index,
            "attempt": number,
            "provider": tier.model.provider,
        },
    )
    announce(rt, state, run, "working", step.tier_index, number)
    try:
        run.parent = weakref.ref(agent)
    except TypeError:
        run.parent = lambda: agent  # an agent that cannot be weakly referenced (a test double)
    context = handover.worker_context(
        run.brief,
        tier=tier.name,
        number=step.tier_index + 1,
        count=len(run.ladder.tiers),
        attempt=number,
        previous=previous,
        output_chars=state.settings.cascade.output_tail_chars,
        diff_chars=state.settings.cascade.diff_chars,
    )
    token = CURRENT.set(Launch(state.session_id, run.task_id, step.tier_index, number))
    try:
        raw = rt.ctx.dispatch_tool(
            "delegate_task",
            {"tasks": [{"goal": handover.worker_goal(run.brief), "context": context}]},
            parent_agent=agent,
        )
    except Exception as exc:
        raise LaunchError(f"delegate_task failed: {type(exc).__name__}: {exc}") from exc
    finally:
        CURRENT.reset(token)
    _check_launched(raw)


def _check_launched(raw: str) -> None:
    """``delegate_task`` answers JSON: ``dispatched`` (a background child), ``results`` (it ran inline) or an error."""
    try:
        reply = cast("dict[str, Any]", json.loads(raw))
    except (TypeError, ValueError) as exc:
        raise LaunchError(f"delegate_task answered something that is not JSON: {raw!r:.200}") from exc
    if reply.get("error"):
        raise LaunchError(f"Hermes refused to start the worker: {reply['error']}")
    if reply.get("status") == "dispatched" or "results" in reply:
        return
    raise LaunchError(f"delegate_task did not start a worker: {raw!r:.300}")


def state_view(rt: Runtime, state: SessionState) -> dict[str, Any]:
    """``cascade.state``: the ladder and, if a task has run, where it is. The live run knows more than the ledger
    (a ship at the gate right now, a task that ended without a verdict); the ledger answers for a resumed session."""
    ladder = rt.ladder_of(state)
    view: dict[str, Any] = {"ladder": tier_views(ladder), "status": "idle"}
    run = rt.cascades.latest(state.session_id)
    task_id = run.task_id if run else _last_task(rt.ledger(state).read())
    if task_id is None:
        return view
    attempts = replay(rt.ledger(state).read(), task_id)
    status = status_of(ladder, attempts, gating=bool(run and run.gating))
    if run is not None and run.final is not None:
        status = run.final.status
    tier = current_tier(attempts)
    view.update(task_id=task_id, status=status or "working", attempt=len(attempts))
    if tier is not None:
        view.update(tier=ladder.tiers[tier].name, tier_index=tier)
    if run is not None:
        view.update(max_attempts=run.max_attempts)
        if run.reason:
            view["reason"] = run.reason
    return view


def _last_task(events: list[dict[str, Any]]) -> str | None:
    """The newest cascade task of a ledger (a plain ship makes its own ``ship:`` tasks, which are not cascades)."""
    created = [e["payload"]["task_id"] for e in events if e["type"] == "task.created"]
    cascades = [t for t in created if t.startswith("task-")]
    return cascades[-1] if cascades else None
