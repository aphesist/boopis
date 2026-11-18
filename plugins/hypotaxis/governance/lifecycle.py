"""A worker attempt's life and a task's end: ``subagent_start``, ``subagent_stop``, and what the orchestrator hears.

**Mechanism: the plugin launches the next tier itself, on the child's ``subagent_stop``.** Hermes fires that hook on
the thread that ran the child, after its last tool call and before the child's result re-enters the orchestrator's
conversation (verified on v0.23.2, with the orchestrator's agent still bound to that thread's context). By then the
worker's ``ship`` has written the gate's verdict to the ledger, so the plugin reads it, asks ``state.next_step`` and
launches the next tier through the same ``engine.launch`` that ``dispatch`` used. The model is not asked: a worker
that claims success is overruled by the gate, and an orchestrator that would rather give up cannot.

What the orchestrator hears is kept small. Every child completion re-enters its conversation as a turn (Hermes), so:

- the completion of an attempt that was blocked, while the next tier is already running, is answered by the plugin
  alone (a ``pre_llm_call`` veto carrying a one-line status): no model call, no tokens;
- the completion that ends the task carries the outcome as injected context: passed at tier N, or failed after the
  last tier, with the gate's own finding. The orchestrator reports it and stops.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from typing import Any

from ..session import Runtime, SessionState
from ..util.log import get_logger
from . import handover
from .engine import CURRENT, LaunchError, launch
from .links import WorkerLink
from .runs import Final, TaskRun
from .state import Attempt, next_step, replay

_log = get_logger("governance.lifecycle")
SUBMISSION_GATE = "T0.submission"  # the plugin's verdict on an attempt that ended without shipping anything


def announce(rt: Runtime, state: SessionState, run: TaskRun, status: str, tier_index: int, attempt: int) -> None:
    """``plugin.hypotaxis.cascade.updated``: ``{task_id, tier, status, attempt}`` (docs/PROTOCOL.md section 3)."""
    payload = {
        "task_id": run.task_id,
        "tier": run.ladder.tiers[tier_index].name,
        "tier_index": tier_index,
        "status": status,
        "attempt": attempt,
    }
    try:
        rt.ctx.emit_to_session(state.session_id, "cascade.updated", payload)
    except Exception:  # noqa: BLE001 - a viewer problem never stops a cascade
        _log.warning("cascade.updated not delivered", exc_info=True)


# ---------------------------------------------------------------- a worker starts


def on_start(rt: Runtime, **kw: Any) -> None:
    """``subagent_start``: link the child session to the attempt being launched, and claim the task for it. A child
    this plugin did not launch (no launch in flight) is left alone: the policy treats it as a worker with no task."""
    launching = CURRENT.get()
    child = str(kw.get("child_session_id") or "")
    run = rt.cascades.find(launching.task_id) if launching is not None else None
    if launching is None or run is None or not child:
        return
    tier = run.ladder.tiers[launching.tier_index]
    link = WorkerLink(
        session_id=child,
        parent_session_id=launching.session_id,
        task_id=launching.task_id,
        tier_index=launching.tier_index,
        tier=tier.name,
        attempt=launching.attempt,
        provider=tier.model.provider,
        model=tier.model.id,
        scope=run.brief.scope,
    )
    rt.links[child] = link  # first: whatever else fails, the child is known for what it is
    state = rt.state(launching.session_id)
    rt.ledger(state).append(
        "task.claimed",
        link.actor,
        {"task_id": run.task_id, "worker": link.actor, "attempt": link.attempt, "tier": link.tier},
    )


# ---------------------------------------------------------------- a worker stops: the gate's verdict decides


def on_stop(rt: Runtime, **kw: Any) -> None:
    """``subagent_stop``: the attempt is over. Never raises into Hermes; a failure here ends the task, loudly."""
    link = rt.links.pop(str(kw.get("child_session_id") or ""), None)
    run = rt.cascades.find(link.task_id) if link is not None else None
    if link is None or run is None:
        return
    state = rt.state(link.parent_session_id)
    with run.lock:
        try:
            _advance(rt, state, run, link, kw)
        except Exception as exc:  # noqa: BLE001
            _log.error("the cascade could not advance after attempt %d", link.attempt, exc_info=True)
            fail(rt, state, run, f"internal error after attempt {link.attempt}: {type(exc).__name__}: {exc}")


def _advance(rt: Runtime, state: SessionState, run: TaskRun, link: WorkerLink, kw: Mapping[str, Any]) -> None:
    run.gating = False
    if link.verdict is None:
        _close_without_ship(rt, state, run, link, str(kw.get("child_status") or "ended"), kw.get("child_summary"))
    ledger = rt.ledger(state)
    attempts = replay(ledger.read(), run.task_id)
    step = next_step(run.ladder, attempts)
    if step.kind != "launch":
        finish(rt, state, run, attempts, step.kind)
        return
    announce(rt, state, run, "escalating", link.tier_index, link.attempt)
    try:
        launch(rt, state, run, step, link.failure)
    except LaunchError as exc:
        fail(rt, state, run, str(exc))


def _submitted(events: Sequence[Mapping[str, Any]], task_id: str) -> bool:
    """Whether the task's latest attempt already has its ``task.submitted`` (a ship got that far)."""
    for event in reversed(events):
        if event["payload"].get("task_id") != task_id:
            continue
        if event["type"] == "task.submitted":
            return True
        if event["type"] == "task.claimed":
            return False
    return False


def _close_without_ship(
    rt: Runtime, state: SessionState, run: TaskRun, link: WorkerLink, status: str, summary: Any
) -> None:
    """A worker that ends without a gate verdict did not deliver (it never shipped, or its ship could not reach the
    gate). The task's state machine needs the attempt closed (submitted, then decided), so the plugin records exactly
    that: an empty submission if there was none, and a block from the plugin's own check, with the worker's report
    kept as unverified evidence for the next tier."""
    from ..ship.gate import blocked_payload

    known = link.failure
    gate = known.gate if known is not None else SUBMISSION_GATE
    reason = (
        known.reason
        if known is not None
        else "the worker finished without shipping any change"
        if status == "completed"
        else f"the worker ended without shipping any change (status: {status})"
    )
    ledger = rt.ledger(state)
    if not _submitted(ledger.read(), run.task_id):
        ledger.append(
            "task.submitted",
            link.actor,
            {
                "task_id": run.task_id,
                "attempt": link.attempt,
                "tier": link.tier,
                "files": [],
                "files_sha256": hashlib.sha256(b"").hexdigest(),
            },
        )
    ledger.append("gate.decided", "gate", blocked_payload(run.task_id, gate, reason) | handover_tags(link))
    link.verdict, link.gate = "block", gate
    if known is None:
        report = str(summary or "").strip()
        link.failure = handover.Failure(
            tier=link.tier,
            attempt=link.attempt,
            gate=gate,
            reason=reason,
            output=f"The worker's own report (not verified): {report}" if report else "",
        )


def handover_tags(link: WorkerLink) -> dict[str, Any]:
    return {"attempt": link.attempt, "tier": link.tier}


# ---------------------------------------------------------------- the end of a task


def _report(events: Sequence[Mapping[str, Any]], run: TaskRun, attempts: Sequence[Attempt]) -> list[str]:
    """One line per attempt, from the ledger: the tier and how the gate decided."""
    findings: dict[int, tuple[str, str]] = {}
    seen = 0
    for event in events:
        payload = event["payload"]
        if event["type"] == "gate.decided" and payload.get("task_id") == run.task_id:
            seen += 1
            findings[seen] = (str(payload.get("gate") or ""), str(payload.get("reason") or ""))
    lines: list[str] = []
    for attempt in attempts:
        tier = run.ladder.tiers[attempt.tier_index].name
        gate, reason = findings.get(attempt.number, ("", ""))
        if attempt.verdict == "pass":
            lines.append(f"- attempt {attempt.number}, tier {tier}: passed the gate")
        else:
            lines.append(f"- attempt {attempt.number}, tier {tier}: blocked by {gate or 'the gate'}: {reason[:300]}")
    return lines


def _shipped(events: Sequence[Mapping[str, Any]], run: TaskRun) -> str:
    """The files the passing ship changed and its checkpoint, as one line."""
    ship = next(
        (
            e["payload"]
            for e in reversed(events)
            if e["type"] == "ship.applied" and e["payload"].get("task_id") == run.task_id
        ),
        None,
    )
    if ship is None:
        return ""
    files = ", ".join(f["path"] for f in ship["files"])
    checkpoint = next(
        (
            e["payload"]
            for e in reversed(events)
            if e["type"] == "checkpoint.committed" and e["payload"].get("ship_id") == ship["ship_id"]
        ),
        None,
    )
    where = f" Checkpoint {checkpoint['ref']} at {checkpoint['commit'][:12]}." if checkpoint else ""
    return f"Changed: {files}.{where}"


def outcome_text(rt: Runtime, state: SessionState, run: TaskRun, attempts: Sequence[Attempt], status: str) -> str:
    events = rt.ledger(state).read()
    last = attempts[-1]
    tier = run.ladder.tiers[last.tier_index]
    where = f"tier {last.tier_index + 1} of {len(run.ladder.tiers)} ({tier.name})"
    if status == "passed":
        head = f"PASSED at {where}, on attempt {last.number}. The project's gate decided, not a worker's report."
        tail = _shipped(events, run)
        advice = "Tell the user what changed, in a few lines, and stop. Do not dispatch again unless asked."
    else:
        head = f"FAILED after the last tier, {where}, in {last.number} attempt(s). The workspace is unchanged."
        tail = ""
        advice = "Tell the user it failed and why (the last finding is above), and stop. Do not retry it yourself."
    lines = [f"[hypotaxis cascade] Task {run.task_id}: {head}", *_report(events, run, attempts)]
    if tail:
        lines.append(tail)
    lines.append(advice)
    return "\n".join(lines)


def finish(rt: Runtime, state: SessionState, run: TaskRun, attempts: Sequence[Attempt], status: str) -> None:
    """The gate ended the task: ``outcome.scored`` (the gate's verdict, labelled as that, never a hidden score), the
    outcome kept for the orchestrator's next turn, and ``cascade.updated``."""
    last = attempts[-1]
    tier = run.ladder.tiers[last.tier_index]
    passed = status == "passed"
    rt.ledger(state).append(
        "outcome.scored",
        "plugin",
        {
            "arm": "governed",
            "task_id": run.task_id,
            "log_task_id": run.task_id,
            "solved": passed,
            "gate_passed": passed,
            "model": tier.model.id,
            "evidence": {"source": "project gate", "tier": tier.name, "attempts": len(attempts)},
        },
    )
    message = outcome_text(rt, state, run, attempts, status)
    run.final = Final("passed" if passed else "failed", tier.name, len(attempts), message)
    announce(rt, state, run, run.final.status, last.tier_index, last.number)


def fail(rt: Runtime, state: SessionState, run: TaskRun, reason: str) -> None:
    """The task ended without a gate verdict (a launch that failed, the cost cap, an internal error): said as that.
    No ``outcome.scored``: nothing was scored."""
    attempts = replay(rt.ledger(state).read(), run.task_id)
    index = attempts[-1].tier_index if attempts else run.start_index
    tier = run.ladder.tiers[index]
    run.reason = reason
    message = (
        f"[hypotaxis cascade] Task {run.task_id} FAILED after {len(attempts)} attempt(s), before a gate could decide: "
        f"{reason}\nTell the user, and stop. Do not retry it yourself."
    )
    run.final = Final("failed", tier.name, len(attempts), message)
    announce(rt, state, run, "failed", index, len(attempts))


# ---------------------------------------------------------------- what the orchestrator hears


def is_completion(user_message: str) -> bool:
    """A child's result re-entering the conversation (Hermes frames it ``[ASYNC DELEGATION BATCH COMPLETE ...]``,
    verified on v0.23.2). A miss only means the turn is not vetoed: the model then gets the in-flight note instead."""
    return "ASYNC DELEGATION" in user_message


def turn_directive(rt: Runtime, state: SessionState, user_message: str) -> dict[str, Any] | None:
    """The ``pre_llm_call`` answer for one orchestrator turn: the final outcome as context (once), a veto for a
    completion that is only an interim step, or a note that a task is running."""
    run = rt.cascades.latest(state.session_id)
    if run is None:
        return None
    with run.lock:
        if run.final is not None:
            if run.told:
                return None
            run.told = True
            return {"context": run.final.message}
        if is_completion(user_message):
            attempts = replay(rt.ledger(state).read(), run.task_id)
            tier = run.ladder.tiers[attempts[-1].tier_index].name if attempts else "?"
            return {
                "action": "block",
                "message": f"hypotaxis: task {run.task_id} is running on tier {tier}; the plugin escalates "
                "on a gate block and reports the outcome when it ends.",
            }
        return {
            "context": f"[hypotaxis cascade] Task {run.task_id} is still running; the plugin will report its outcome. "
            "Do not dispatch again."
        }
