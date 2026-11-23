"""Hermes hook callbacks. Signatures are the verified ones (docs/research/spike-s0.md): each takes
``**kwargs`` and reads what it needs.

Policy hooks (``pre_tool_call``, ``pre_llm_call``) fail closed: any exception blocks. Observer hooks
(``post_*``, session hooks) log and swallow, because an observer must never break the agent loop, but
they never invent data: a missing field is simply absent.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from . import budget, policy, turns
from .hermes_api import bound
from .ledger import project_costs, usage_event_payload
from .policy import Decision, ToolCall
from .policy.types import block as block_decision
from .session import Caller, Runtime, SessionState
from .util.log import get_logger

_log = get_logger("hooks")
_runtime: Runtime | None = None
_STATUSES = frozenset({"ok", "error", "blocked"})


def install(runtime: Runtime) -> None:
    global _runtime
    _runtime = runtime


def runtime() -> Runtime:
    """The process's runtime, built from the bound plugin context on first use."""
    global _runtime
    if _runtime is None:
        _runtime = Runtime(bound())
    return _runtime


def _block(message: str) -> dict[str, Any]:
    return {"action": "block", "message": message}


def _args_digest(args: Any) -> str:
    """sha256 of the arguments' canonical JSON. The arguments themselves are never stored."""
    from ._vendor.contraprova.events import canonical_json

    try:
        text = canonical_json(args if args is not None else {})
    except (TypeError, ValueError):
        text = repr(args)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _locked(rt: Runtime, session_id: str, **info: str) -> SessionState:
    return rt.lock(session_id, **info)


def _caller(rt: Runtime, kw: Mapping[str, Any]) -> Caller:
    """Who this hook call belongs to: a session, or a worker (a delegated child, which works for its parent)."""
    return rt.caller(str(kw.get("session_id") or ""))


def _actor(caller: Caller) -> str:
    return caller.link.actor if caller.link is not None else caller.state.actor()


def _tags(caller: Caller) -> dict[str, Any]:
    """What marks an event as a worker's: its role, and the task, tier and attempt it served."""
    link = caller.link
    if link is None:
        return {}
    return {"role": "worker", "task_id": link.task_id, "tier": link.tier, "attempt": link.attempt}


def ledger_identity(caller: Caller) -> tuple[str, dict[str, Any]]:
    """The ledger actor and the worker tags of a caller's events (the exec kernel's calls use the same)."""
    return _actor(caller), _tags(caller)


# ---------------------------------------------------------------- policy hooks


def pre_tool_call(tool_name: str = "", args: Mapping[str, Any] | None = None, **kw: Any) -> dict[str, Any] | None:
    """The permission policy. Block, approve, modify, or let the call through."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        caller = _caller(rt, kw)
        call = ToolCall(tool_name, args or {}, session_id, str(kw.get("tool_call_id") or ""))
        decision = _budget_gate(rt, caller, policy.check(call, rt.policy_for(caller)))
        if decision.kind == "block" and call.tool_call_id:
            caller.state.blocked_calls[call.tool_call_id] = "hx.policy.denied"
            caller.state.blocked_rules[call.tool_call_id] = (decision.reason, decision.rule)
        if caller.link is not None:
            _worker_pre_call(
                rt, caller, call, args, blocked=decision.kind == "block", why=(decision.reason, decision.rule)
            )
        return decision.directive()
    except Exception:  # noqa: BLE001 - the policy hook fails closed
        _log.error("pre_tool_call failed closed for tool=%s", tool_name, exc_info=True)
        return _block("boopis could not evaluate its policy, so this call was blocked.")


def _budget_gate(rt: Runtime, caller: Caller, decision: Decision) -> Decision:
    """The budgets a run meets before a tool call (``budget``): the team's month, then the bot's cap per run. A refusal
    of the policy stands; a pause of the budget is the engine's approval card, and when the policy also asked, the one
    card carries both reasons (allowing it allows the call)."""
    if decision.kind == "block":
        return decision
    state = caller.state
    month = budget.month_stop(rt, state, state.provider, state.model)
    if month is not None:
        if budget.run.stop(state.run, "month"):
            budget.record_block(rt, state, "month_budget", cap=month[1], scope="month")
        return block_decision(month[0], "month_budget")
    bot = rt.bot_rules()
    verdict = budget.run_gate(state, bot, asked_by="")
    if verdict is None or bot is None or bot.cap_usd is None:
        return decision
    if verdict.kind == "stop":
        if budget.run.first_stop(state.run):
            budget.record_block(rt, state, verdict.reason, cap=bot.cap_usd, scope="run")
        return block_decision(verdict.message, verdict.reason)
    rt.pauses[verdict.rule_key] = state.session_id
    budget.record_block(rt, state, verdict.reason, cap=bot.cap_usd, scope="run")
    message = verdict.message if decision.kind != "approve" else f"{verdict.message} Also: {decision.message}"
    return Decision("approve", message=message, rule_key=verdict.rule_key, reason=verdict.reason, rule="run_cap")


def post_approval_response(**kw: Any) -> None:
    """The engine's approval gate settled a card. When it is a run cap's pause, the run is raised or stopped
    (``budget.run.answered``); any other card is not the budget's business. An observer: never raises."""
    try:
        key = str(kw.get("pattern_key") or "").removeprefix("plugin_rule:")
        if not key.startswith(budget.run.RULE_PREFIX):
            return
        rt = runtime()
        session_id = rt.pauses.pop(key, None)
        if session_id is None:
            return
        budget.run.answered(rt.state(session_id).run, key, str(kw.get("choice") or ""))
    except Exception:  # noqa: BLE001
        _log.error("an answer at a run cap was not recorded; the run stops at its next tool call", exc_info=True)


def _why(reason: str, rule: str) -> dict[str, Any]:
    """Which policy rule blocked a call, for its ``tool.called``: a stable ``reason`` tag and the ``rule``."""
    return {k: v for k, v in (("reason", reason), ("rule", rule)) if v}


def _worker_pre_call(
    rt: Runtime, caller: Caller, call: ToolCall, args: Any, *, blocked: bool, why: tuple[str, str] = ("", "")
) -> None:
    """Hermes fires no ``post_tool_call`` for a delegated child's tools (verified on v0.23.2), so a worker's calls are
    recorded here and in the tool handlers: a blocked call now (nothing ran, so it took no time), an allowed one when
    the boopis tool that serves it finishes (``record_worker_call``)."""
    assert caller.link is not None
    if not blocked:
        caller.link.calls.append((call.tool, call.tool_call_id))
        return
    rt.ledger(caller.state).append(
        "tool.called",
        _actor(caller),
        {
            "tool_call_id": call.tool_call_id,
            "tool": call.tool,
            "status": "blocked",
            "duration_ms": 0,
            "args_sha256": _args_digest(args),
            "error_code": "hx.policy.denied",
        }
        | _why(*why)
        | _tags(caller),
    )


def record_worker_call(caller: Caller, tool: str, args: Any, duration_ms: int, failed: bool) -> None:
    """``tool.called`` for a worker's call to one of the boopis tools, from the handler that ran it."""
    try:
        link = caller.link
        assert link is not None
        index = next((i for i, (name, _) in enumerate(link.calls) if name == tool), None)
        if index is None:
            return  # no pre_tool_call announced it: a call from an exec kernel, which exec records itself
        call_id = link.calls.pop(index)[1]
        runtime().ledger(caller.state).append(
            "tool.called",
            _actor(caller),
            {
                "tool_call_id": call_id,
                "tool": tool,
                "status": "error" if failed else "ok",
                "duration_ms": max(duration_ms, 0),
                "args_sha256": _args_digest(args),
            }
            | _tags(caller),
        )
    except Exception:  # noqa: BLE001
        _log.error("worker tool.called not recorded", exc_info=True)


def pre_llm_call(**kw: Any) -> dict[str, Any] | None:
    """The cost cap, then the cascade. Fires once per user turn (Hermes), before any model call of that turn: for the
    orchestrator that is each message and each child result; for a worker it is its whole attempt."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        if rt.is_worker(session_id):
            return _worker_turn(rt, rt.caller(session_id), str(kw.get("model") or ""))
        rt.roster.note_message(session_id, str(kw.get("user_message") or ""))  # what the user named (delegation guard)
        state = _locked(rt, session_id, model=str(kw.get("model") or ""))
        budget.run.begin(state.run, str(kw.get("turn_id") or ""))  # every turn is a new run
        capped = _cost_cap(rt, state, state.provider, state.model) or _turn_budgets(rt, state)
        if capped is not None:
            state.track.armed_at = None  # a blocked turn does not use the exception
            return capped
        if turns.begin(rt, state, str(kw.get("turn_id") or "")):
            return {"context": turns.CONTEXT}
        if state.mode != "governed":
            return None
        from .governance.frontier import session_refusal

        refused = session_refusal(state.provider, state.model)  # ADR-0037: the orchestrator is frontier too
        if refused is not None:
            return _block(refused)
        from .store.policy import session_refusal as store_refusal

        engine_plugins = store_refusal(rt, state.cwd, governed=True)  # docs/STORE.md 5.8: the project's switch
        if engine_plugins is not None:
            return _block(engine_plugins)
        from .governance.lifecycle import turn_directive

        return turn_directive(rt, state, str(kw.get("user_message") or ""))
    except Exception:  # noqa: BLE001
        _log.error("pre_llm_call failed closed", exc_info=True)
        return _block("boopis could not evaluate the cost cap, so this turn was blocked.")


def _worker_turn(rt: Runtime, caller: Caller, model: str) -> dict[str, Any] | None:
    """A worker's attempt starts: it must run on the model the plugin chose for its tier (fail closed if Hermes put it
    elsewhere), and the cost cap covers it like any model call."""
    link = caller.link
    assert link is not None
    if model and model != link.model:
        return _block(
            f"boopis chose {link.provider}/{link.model} for tier {link.tier}, but this worker runs on {model}. "
            "The attempt was stopped: a tier is the plugin's choice."
        )
    return _cost_cap(rt, caller.state, link.provider, link.model)


def _turn_budgets(rt: Runtime, state: SessionState) -> dict[str, Any] | None:
    """When a turn starts: a bot whose rules cannot be read does not run, and a spent team budget stops every turn."""
    refused = budget.bot_turn_refusal(rt.bot_rules())
    if refused is not None:
        return _block(refused)
    month = budget.month_stop(rt, state, state.provider, state.model)
    if month is None:
        return None
    budget.run.stop(state.run, "month")
    budget.record_block(rt, state, "month_budget", cap=month[1], scope="month")
    return _block(month[0])


def _cost_cap(rt: Runtime, state: SessionState, provider: str, model: str) -> dict[str, Any] | None:
    stop = budget.cap_block(state, provider, model)
    if stop is None:
        return None
    budget.record_block(rt, state, stop[1])
    return _block(stop[0])


# ---------------------------------------------------------------- observers


def tool_called_payload(
    call_id: str, tool: str, status: str, duration_ms: int, args: Any, *, error_code: str = "", task_id: str = ""
) -> dict[str, Any]:
    """The ``tool.called`` payload, shared by the Hermes hook and the exec kernel's calls (one shape).
    Arguments are hashed, never stored."""
    payload: dict[str, Any] = {
        "tool_call_id": call_id,
        "tool": tool,
        "status": status if status in _STATUSES else "error",
        "duration_ms": max(int(duration_ms or 0), 0),
        "args_sha256": _args_digest(args),
    }
    if error_code:
        payload["error_code"] = error_code
    if task_id:
        payload["task_id"] = task_id
    return payload


def post_tool_call(tool_name: str = "", args: Any = None, **kw: Any) -> None:
    """``tool.called``: the call's outcome and duration. Arguments are hashed, never stored."""
    try:
        rt = runtime()
        caller = _caller(rt, kw)
        state = caller.state
        call_id = str(kw.get("tool_call_id") or "")
        code = state.blocked_calls.pop(call_id, None) or (str(kw["error_type"]) if kw.get("error_type") else "")
        payload = tool_called_payload(
            call_id,
            tool_name,
            str(kw.get("status")),
            int(kw.get("duration_ms") or 0),
            args,
            error_code=code,
            task_id="" if caller.worker else str(kw.get("task_id") or ""),
        )
        if code == "hx.policy.denied":
            payload |= _why(*state.blocked_rules.pop(call_id, ("", "")))
        payload |= _tags(caller)  # a worker's own task id is the cascade's, not Hermes's subagent id
        rt.ledger(state).append("tool.called", _actor(caller), payload)
        if tool_name == "exec" and kw.get("status") not in _STATUSES:
            _abandon_cell(str(kw.get("session_id") or ""))
    except Exception:  # noqa: BLE001
        _log.error("tool.called not recorded", exc_info=True)


def _abandon_cell(session_id: str) -> None:
    """Hermes reports an exec call ``cancelled`` (not ok, error or blocked) when it gave up on it while its
    handler still runs: the owner stopped the turn, or a deadline passed (verified on v0.23.2: the interrupt
    arrives as ``post_tool_call`` with status ``cancelled``). Nobody is waiting for that cell, so it is
    cancelled; the kernel and its variables stay."""
    from .exec import abandon

    abandon(session_id)


def _record_usage(kw: Mapping[str, Any], *, auxiliary: bool) -> None:
    rt = runtime()
    caller = rt.caller(str(kw.get("session_id") or ""))
    state = caller.state
    provider, model = str(kw.get("provider") or ""), str(kw.get("model") or "")
    if not auxiliary:
        link = caller.link
        turns.note_call(
            state, provider=provider, model=model, worker=turns.ref(link.provider, link.model) if link else ""
        )
    if not auxiliary and not caller.worker:  # a side call (a title, a compression) is not the session's model
        state.provider, state.model = provider or state.provider, model or state.model
    subscription = provider in state.settings.subscription_providers
    payload = usage_event_payload(
        kw.get("usage"),
        model=model,
        provider=provider,
        api_duration_s=kw.get("api_duration"),
        request_id=kw.get("api_request_id"),
        subscription=subscription,
    )
    if payload is None:
        return
    payload |= _tags(caller)
    if kw.get("turn_id"):
        payload["turn_id"] = str(kw["turn_id"])
    payload["role"] = "auxiliary" if auxiliary else ("worker" if caller.worker else "orchestrator")
    if auxiliary and kw.get("aux_task"):
        payload["aux_task"] = str(kw["aux_task"])
    actor = "plugin" if auxiliary else _actor(caller)
    rt.ledger(state).append("usage.recorded", actor, payload)
    assert state.book is not None
    costs = project_costs([payload], state.book, state.settings.subscription_providers)
    with state.lock:  # workers run on their own threads, and their spend is the session's
        if costs.billed_usd is None:
            state.unpriced.update(costs.billed_unpriced)
        else:
            state.spend_usd += costs.billed_usd
    budget.note_usage(rt, state, payload)  # the run's API-equivalent, against a bot's cap per run


def post_api_request(**kw: Any) -> None:
    """``usage.recorded`` for one model request of the session's own model."""
    try:
        _record_usage(kw, auxiliary=False)
    except Exception:  # noqa: BLE001
        _log.error("usage.recorded not recorded", exc_info=True)


def post_auxiliary_call(**kw: Any) -> None:
    """Hermes's side calls (titles, compression, ...) cost money too, so they are recorded, tagged."""
    try:
        _record_usage(kw, auxiliary=True)
    except Exception:  # noqa: BLE001
        _log.error("auxiliary usage not recorded", exc_info=True)


def on_session_start(**kw: Any) -> None:
    """The first-turn hook: make sure the session is locked and ``session.opened`` is written."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        if session_id not in rt.links:  # a worker's session is not a session of its own: it works for its parent
            _locked(rt, session_id, model=str(kw.get("model") or ""))
    except Exception:  # noqa: BLE001
        _log.error("session open not recorded", exc_info=True)


def on_session_end(**kw: Any) -> None:
    """A turn ended (completed, failed or interrupted): a message that ran outside governed mode is governed again."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        if rt.is_worker(session_id):
            return
        reason = "interrupted" if kw.get("interrupted") else "failed" if kw.get("failed") else "completed"
        turns.end(rt, rt.state(session_id), reason)
    except Exception:  # noqa: BLE001
        _log.error("the end of a turn was not recorded", exc_info=True)


def on_session_finalize(**kw: Any) -> None:
    """``session.closed``. A session that never reached its first prompt has nothing to close."""
    try:
        rt = runtime()
        _stop_kernel(str(kw.get("session_id") or ""))
        if str(kw.get("session_id") or "") in rt.links:
            return  # a worker ending; ``subagent_stop`` is where its attempt is closed
        if rt.forms is not None:
            rt.forms.close_session(
                str(kw.get("session_id") or "")
            )  # before the ledger is forgotten: it records the expiry
        state = rt.forget(str(kw.get("session_id") or ""))
        if state is None or state.policy is None:
            return
        rt.ledger(state).append(
            "session.closed", "plugin", {"session_id": state.session_id, "reason": str(kw.get("reason") or "finalized")}
        )
    except Exception:  # noqa: BLE001
        _log.error("session.closed not recorded", exc_info=True)


def _stop_kernel(session_id: str) -> None:
    """A finished session's exec kernel goes with it. Never raises."""
    try:
        from .exec import stop_session

        stop_session(session_id, "the session ended")
    except Exception:  # noqa: BLE001
        _log.error("exec kernel not stopped", exc_info=True)


def recover_on_start() -> None:
    """Run in a thread when the plugin loads: roll back what a crash left behind. Never raises."""
    try:
        runtime().recover_journals()
    except Exception:  # noqa: BLE001
        _log.error("journal recovery failed", exc_info=True)


def subagent_start(**kw: Any) -> None:
    """A delegated child exists: if the cascade launched it, link it to its attempt (``governance.lifecycle``)."""
    try:
        from .governance.lifecycle import on_start

        on_start(runtime(), **kw)
    except Exception:  # noqa: BLE001
        _log.error("subagent_start not handled", exc_info=True)


def subagent_stop(**kw: Any) -> None:
    """A delegated child is done: the cascade reads the gate's verdict and launches the next tier, or ends the task."""
    try:
        from .governance.lifecycle import on_stop

        on_stop(runtime(), **kw)
    except Exception:  # noqa: BLE001
        _log.error("subagent_stop not handled", exc_info=True)


def system_prompt_section(info: Mapping[str, Any]) -> str:
    """Rendered once per session, at its first prompt: this is where the session locks. A worker's section is its
    own, and it locks nothing: Hermes renders the section for a delegated child too, and the child is already linked
    (``subagent_start`` fires before its first prompt)."""
    from .prompt import section_text, worker_text

    rt = runtime()
    session_id = str(info.get("session_id") or "")
    if rt.is_worker(session_id):
        return worker_text()
    state = rt.lock(
        session_id,
        cwd=str(info.get("cwd") or ""),
        model=str(info.get("model") or ""),
        provider=str(info.get("provider") or ""),
        profile=str(info.get("profile_name") or ""),
    )
    return section_text(state.mode)
