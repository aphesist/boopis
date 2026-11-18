"""``plugin.hypotaxis.*``: the hypotaxis-v1 RPC (docs/PROTOCOL.md section 3).

Handlers are ``fn(params, *, session_id=None, **kw)`` and return JSON-able values. They raise a
``HypotaxisError`` for a refusal; Hermes reports it as ``plugin_rpc_failed`` with the text
``<ClassName>: hx.<code>: <message>`` (see ``errors.py``).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, cast

from ..errors import InvalidParamsError, PricesDisabledError
from ..hooks import runtime
from ..ledger import compute_stats, refresh
from ..session import SessionState
from ..version import PLUGIN_VERSION, PROTOCOL

Handler = Callable[..., Any]
CAPABILITIES = (
    "describe",
    "mode.set",
    "ledger.tail",
    "ledger.verify",
    "ledger.stats",
    "cascade.state",
    "prices.refresh",
)
DEFAULT_TAIL_LIMIT = 200
MAX_TAIL_LIMIT = 1000


def _session_id(params: Mapping[str, Any], session_id: str | None) -> str:
    sid = params.get("session_id") or session_id
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    return sid


def _int(params: Mapping[str, Any], key: str, default: int) -> int:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise InvalidParamsError(f"{key} must be an integer", data={"found": repr(value)})
    return value


def describe(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    rt = runtime()
    loaded = rt.load_settings()
    session: dict[str, Any] | None = None
    sid = params.get("session_id") or session_id
    if isinstance(sid, str) and sid:
        state = rt.state(sid)
        session = {"session_id": sid, "mode": state.mode, "locked": state.locked, "cwd": state.cwd or None}
    return {
        "session": session,
        "version": PLUGIN_VERSION,
        "protocol": PROTOCOL,
        "capabilities": list(CAPABILITIES),
        "hx": None,  # the hx binary is not wired in this part
        "kernel": None,  # nor is the exec kernel
        "config": {"mode": loaded.value.mode, "errors": list(loaded.errors)},
    }


def _tier_ladder(ladder: Any) -> Mapping[str, Any]:
    """A ``Tier[]`` from ``mode.set`` (``model`` as ``{provider, id}`` or ``'provider/id'``) as the
    settings' ladder form, validated by contraprova's own ``TierLadder``."""
    from .._vendor.contraprova.interfaces import TierLadder

    if not isinstance(ladder, list) or not ladder:
        raise InvalidParamsError("ladder must be a non-empty list of tiers")
    tiers: list[dict[str, Any]] = []
    for i, tier in enumerate(cast("list[Any]", ladder)):
        if not isinstance(tier, Mapping):
            raise InvalidParamsError(f"ladder[{i}] must be an object")
        item = dict(cast("Mapping[str, Any]", tier))
        model = item.get("model")
        if isinstance(model, Mapping):
            m = cast("Mapping[str, Any]", model)
            item["model"] = f"{m.get('provider')}/{m.get('id')}"
        tiers.append(item)
    try:
        return TierLadder.from_dict({"tiers": tiers}).to_dict()  # type: ignore[no-any-return]
    except (ValueError, KeyError, TypeError) as exc:
        raise InvalidParamsError(f"ladder is invalid: {exc}") from exc


def mode_set(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = _session_id(params, session_id)
    mode = params.get("mode")
    if mode not in ("governed", "ungoverned"):
        raise InvalidParamsError("mode must be 'governed' or 'ungoverned'", data={"found": repr(mode)})
    ladder = _tier_ladder(params["ladder"]) if params.get("ladder") is not None else None
    gate = params.get("gate")
    enabled: bool | None = None
    if gate is not None:
        if not isinstance(gate, Mapping) or not isinstance(cast("Mapping[str, Any]", gate).get("enabled"), bool):
            raise InvalidParamsError("gate must be an object {enabled: boolean}")
        enabled = cast("Mapping[str, Any]", gate)["enabled"]
    runtime().set_mode(sid, mode, ladder=ladder, gate_enabled=enabled)
    return {}


def ledger_tail(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = _session_id(params, session_id)
    since = _int(params, "since_seq", -1)
    limit = min(max(_int(params, "limit", DEFAULT_TAIL_LIMIT), 0), MAX_TAIL_LIMIT)
    rt = runtime()
    events, head = rt.ledger(rt.state(sid)).tail(since, limit)
    return {"events": events, "head_seq": head}


def ledger_verify(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = _session_id(params, session_id)
    rt = runtime()
    ok, broken_at, count = rt.ledger(rt.state(sid)).verify()
    result: dict[str, Any] = {"ok": ok, "events": count}
    if broken_at is not None:
        result["broken_at_seq"] = broken_at
    return result


def ledger_stats(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = _session_id(params, session_id)
    rt = runtime()
    state = rt.state(sid)
    book = rt.price_book(state.settings)
    return compute_stats(rt.ledger(state).read(), book, state.settings.subscription_providers)


def _ladder_tiers(state: SessionState) -> list[dict[str, Any]]:
    """The configured ladder as protocol ``Tier`` objects; empty when none is configured."""
    from .._vendor.contraprova.interfaces import TierLadder

    raw = state.ladder if state.ladder is not None else state.settings.ladder
    if raw is None:
        return []
    ladder = TierLadder.from_dict(raw)
    return [
        {
            "name": t.name,
            "model": {"provider": t.model.provider, "id": t.model.id},
            "effort": t.effort.value,
            "max_tokens": t.max_tokens,
            "retries": t.retries,
        }
        for t in ladder.tiers
    ]


def cascade_state(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The cascade is not built yet: the configured ladder, and ``status: idle``. No task, no tier."""
    sid = _session_id(params, session_id)
    return {"ladder": _ladder_tiers(runtime().state(sid)), "status": "idle"}


def prices_refresh(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """One HTTPS GET of the models.dev catalogue into the profile's cache. Takes no URL: the address is
    fixed, so a caller cannot aim the plugin at another host."""
    rt = runtime()
    if not rt.load_settings().value.prices.refresh_enabled:
        raise PricesDisabledError("prices.refresh_enabled is false in the plugin settings")
    return refresh(rt.home)


def handlers() -> dict[str, Handler]:
    return {
        "describe": describe,
        "mode.set": mode_set,
        "ledger.tail": ledger_tail,
        "ledger.verify": ledger_verify,
        "ledger.stats": ledger_stats,
        "cascade.state": cascade_state,
        "prices.refresh": prices_refresh,
    }


__all__ = ["CAPABILITIES", "handlers"]
