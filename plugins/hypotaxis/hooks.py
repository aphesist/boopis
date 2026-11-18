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

from . import policy
from .hermes_api import bound
from .ledger import project_costs, usage_event_payload
from .policy import ToolCall
from .session import Runtime, SessionState
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
    from contraprova.events import canonical_json

    try:
        text = canonical_json(args if args is not None else {})
    except (TypeError, ValueError):
        text = repr(args)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _locked(rt: Runtime, session_id: str, **info: str) -> SessionState:
    return rt.lock(session_id, **info)


# ---------------------------------------------------------------- policy hooks


def pre_tool_call(tool_name: str = "", args: Mapping[str, Any] | None = None, **kw: Any) -> dict[str, Any] | None:
    """The permission policy. Block, approve, modify, or let the call through."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        state = _locked(rt, session_id)
        assert state.policy is not None
        call = ToolCall(tool_name, args or {}, session_id, str(kw.get("tool_call_id") or ""))
        decision = policy.check(call, state.policy)
        if decision.kind == "block" and call.tool_call_id:
            state.blocked_calls[call.tool_call_id] = "hx.policy.denied"
        return decision.directive()
    except Exception:  # noqa: BLE001 - the policy hook fails closed
        _log.error("pre_tool_call failed closed for tool=%s", tool_name, exc_info=True)
        return _block("hypotaxis could not evaluate its policy, so this call was blocked.")


def pre_llm_call(**kw: Any) -> dict[str, Any] | None:
    """The cost cap. Fires once per user turn (Hermes), before any model call of that turn."""
    try:
        rt = runtime()
        state = _locked(rt, str(kw.get("session_id") or ""), model=str(kw.get("model") or ""))
        return _cost_cap(rt, state)
    except Exception:  # noqa: BLE001
        _log.error("pre_llm_call failed closed", exc_info=True)
        return _block("hypotaxis could not evaluate the cost cap, so this turn was blocked.")


def _cost_cap(rt: Runtime, state: SessionState) -> dict[str, Any] | None:
    cap = state.settings.cost_cap_usd
    if cap is None:
        return None
    subscription = state.provider in state.settings.subscription_providers
    unpriced = sorted(state.unpriced)
    if state.model and not subscription and not _model_priced(state):
        unpriced = sorted({*unpriced, state.model})
    if unpriced:
        message = (
            f"The cost cap is {_usd(cap)} but no price is configured for {', '.join(unpriced)}, "
            "so the spend cannot be computed. Add it to the plugin's prices setting or remove the cap."
        )
        _record_budget(rt, state, cap, "unpriced")
        return _block(message)
    if state.spend_usd >= cap:
        message = (
            f"Cost cap reached: this session has spent {_usd(state.spend_usd)} of the {_usd(cap)} cap. "
            "Raise cost_cap_usd in the plugin settings to continue."
        )
        _record_budget(rt, state, cap, "cap_reached")
        return _block(message)
    return None


def _model_priced(state: SessionState) -> bool:
    entries = state.price_table.entries
    return any(ref.id == state.model and (not state.provider or ref.provider == state.provider) for ref in entries)


def _usd(value: float) -> str:
    return f"${value:.4f}"


def _record_budget(rt: Runtime, state: SessionState, cap: float, reason: str) -> None:
    """``budget.blocked`` in the ledger (the cap, never the spend) and to viewers (with the spend)."""
    try:
        rt.ledger(state).append(
            "budget.blocked",
            "plugin",
            {"cap_usd": cap, "price_table": state.price_table.version, "reason": reason},
        )
        rt.ctx.emit_to_session(state.session_id, "budget.blocked", {"cap_usd": cap, "projected_usd": state.spend_usd})
    except Exception:  # noqa: BLE001 - the block itself must still happen
        _log.error("budget.blocked not recorded", exc_info=True)


# ---------------------------------------------------------------- observers


def post_tool_call(tool_name: str = "", args: Any = None, **kw: Any) -> None:
    """``tool.called``: the call's outcome and duration. Arguments are hashed, never stored."""
    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        state = _locked(rt, session_id)
        call_id = str(kw.get("tool_call_id") or "")
        status = kw.get("status")
        payload: dict[str, Any] = {
            "tool_call_id": call_id,
            "tool": tool_name,
            "status": status if status in _STATUSES else "error",
            "duration_ms": max(int(kw.get("duration_ms") or 0), 0),
            "args_sha256": _args_digest(args),
        }
        code = state.blocked_calls.pop(call_id, None)
        if code:
            payload["error_code"] = code
        elif kw.get("error_type"):
            payload["error_code"] = str(kw["error_type"])
        if kw.get("task_id"):
            payload["task_id"] = str(kw["task_id"])
        rt.ledger(state).append("tool.called", state.actor(), payload)
    except Exception:  # noqa: BLE001
        _log.error("tool.called not recorded", exc_info=True)


def _record_usage(kw: Mapping[str, Any], *, auxiliary: bool) -> None:
    rt = runtime()
    state = _locked(rt, str(kw.get("session_id") or ""))
    provider, model = str(kw.get("provider") or ""), str(kw.get("model") or "")
    if not auxiliary:  # a side call (a title, a compression) is not the session's model
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
    payload["role"] = "auxiliary" if auxiliary else "orchestrator"
    if auxiliary and kw.get("aux_task"):
        payload["aux_task"] = str(kw["aux_task"])
    rt.ledger(state).append("usage.recorded", "plugin" if auxiliary else state.actor(), payload)
    costs = project_costs([payload], state.price_table, state.settings.subscription_providers)
    if costs.billed_usd is None:
        state.unpriced.update(costs.billed_unpriced)
    else:
        state.spend_usd += costs.billed_usd


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
        _locked(runtime(), str(kw.get("session_id") or ""), model=str(kw.get("model") or ""))
    except Exception:  # noqa: BLE001
        _log.error("session open not recorded", exc_info=True)


def on_session_finalize(**kw: Any) -> None:
    """``session.closed``. A session that never reached its first prompt has nothing to close."""
    try:
        rt = runtime()
        state = rt.forget(str(kw.get("session_id") or ""))
        if state is None or state.policy is None:
            return
        rt.ledger(state).append(
            "session.closed", "plugin", {"session_id": state.session_id, "reason": str(kw.get("reason") or "finalized")}
        )
    except Exception:  # noqa: BLE001
        _log.error("session.closed not recorded", exc_info=True)


def system_prompt_section(info: Mapping[str, Any]) -> str:
    """Rendered once per session, at its first prompt: this is where the session locks."""
    from .prompt import section_text

    rt = runtime()
    state = rt.lock(
        str(info.get("session_id") or ""),
        cwd=str(info.get("cwd") or ""),
        model=str(info.get("model") or ""),
        provider=str(info.get("provider") or ""),
        profile=str(info.get("profile_name") or ""),
    )
    return section_text(state.mode)
