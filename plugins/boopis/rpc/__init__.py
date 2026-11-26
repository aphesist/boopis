"""``plugin.boopis.*``: the boopis-v1 RPC (docs/PROTOCOL.md section 3).

Handlers are ``fn(params, *, session_id=None, **kw)`` and return JSON-able values. They raise a
``BoopisError`` for a refusal; Hermes reports it as ``plugin_rpc_failed`` with the text
``<ClassName>: hx.<code>: <message>`` (see ``errors.py``).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any, cast

from ..errors import InvalidParamsError, PricesDisabledError
from ..hooks import runtime
from ..ledger import compute_stats, refresh
from ..version import PLUGIN_VERSION, PROTOCOL
from .blanks import blank_fill
from .careful import careful_set
from .checkpoints import checkpoint_diff, checkpoint_list, checkpoint_rewind
from .continuation import continue_arm, continue_chain

Handler = Callable[..., Any]
CAPABILITIES = (
    "describe",
    "mode.set",
    "mode.once",
    "turns.bind",
    "turns.models",
    "budget.state",
    "budget.get",
    "budget.set",
    "ledger.tail",
    "ledger.verify",
    "ledger.stats",
    "cascade.state",
    "cascade.start_tier",
    "dispatch.roster",
    "prices.refresh",
    "blank.fill",
    "checkpoint.list",
    "checkpoint.diff",
    "checkpoint.rewind",
    "careful.set",
    "continue.arm",
    "continue.chain",
    "form.submit",
    "form.cancel",
    "form.list",
    "mod.press",
    "mod.input",
    "mod.select",
    "mod.props",
    "mod.list",
    "mod.unload",
    "mod.install.prepare",
    "mod.install.confirm",
    "bots.read",
    "bots.write",
    "bots.guide",
    "bots.toolsets",
    "bots.project",
    "bots.inspect",
    "bots.archive",
    "bots.restore",
    "bots.delete",
    "store-v1",
    "store.prepare",
    "store.confirm",
    "store.uninstall",
    "store.diff",
    "store.rollback",
    "store.set_enabled",
    "store.list",
    "store.removed.set",
    "store.policy.get",
    "store.policy.set",
    "rules-v1",
    "rules.draft",
    "rules.explain",
    "rules.reviewer.rank",
    "rules.grant",
    "rules.kinds",
)
DEFAULT_TAIL_LIMIT = 200
MAX_TAIL_LIMIT = 1000


def _host_capabilities() -> list[str]:
    """What the host adds: ``host-ops-v1`` once the host-ops channel answered at load."""
    from ..hostops import CAPABILITY, available

    return [CAPABILITY] if available() else []


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


def _kernel(rt: Any) -> dict[str, Any] | None:
    """Whether the exec kernel can start here: ``{ok, reason}``, or None when there is no hx to sandbox it."""
    from ..exec import available
    from ..exec.probe import sandbox_problem

    if not available():
        return {
            "ok": False,
            "reason": "exec needs the sandbox's private channel, which does not exist on this platform",
        }
    client = rt.hx_client()
    if client is None:
        return None
    problem = sandbox_problem(client, rt.load_settings().value.exec)
    return {"ok": not problem, "reason": problem}


def describe(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    rt = runtime()
    loaded = rt.load_settings()
    session: dict[str, Any] | None = None
    sid = params.get("session_id") or session_id
    ladder_errors: list[str] = []
    ladder_now = None
    now_state = None
    if isinstance(sid, str) and sid:
        from ..ship.rewind import rewind_view

        state = rt.state(sid)
        session = {
            "session_id": sid,
            "mode": state.mode,
            "locked": state.locked,
            "cwd": state.cwd or None,
            "careful": state.careful or None,
            "careful_next": state.careful_next,
            "surface": state.surface,
            "running": state.running,
            "continued_from": state.continued["parent_session_id"] if state.continued else None,
            "rewind": rewind_view(rt, state),
        }
        ladder_errors = _ladder_errors(rt, state)
        ladder_now = _effective_ladder(rt, state)
        now_state = state
    extra: dict[str, Any] = {}
    cwd = params.get("cwd")
    if cwd is not None:
        from .careful import folder_view, sandbox_view

        if not isinstance(cwd, str):
            raise InvalidParamsError("cwd must be a string", data={"found": repr(cwd)})
        extra["folder"] = folder_view(rt, cwd)
        extra["sandbox"] = sandbox_view(rt)
    from ..governance.host import approvals_mode
    from .careful import hx_view

    return {
        **extra,
        "session": session,
        "version": PLUGIN_VERSION,
        "protocol": PROTOCOL,
        "capabilities": [*CAPABILITIES, *_host_capabilities()],
        "hx": hx_view(rt),
        "session_refused_toolsets": _refused_toolsets(),
        "approvals": {"mode": approvals_mode()},
        "kernel": _kernel(rt),
        "config": {
            "mode": loaded.value.mode,
            "cost_cap_usd": loaded.value.cost_cap_usd,
            "errors": list(loaded.errors),
            "ladder_errors": ladder_errors,
        },
        "frontier": _frontier(rt, loaded.value, now_state, ladder_now),
    }


def _refused_toolsets() -> dict[str, Any]:
    """The engine toolsets the Session tab never loads (``policy/session_refused_toolsets.json``)."""
    import json
    from pathlib import Path

    data = json.loads((Path(__file__).resolve().parent.parent / "policy" / "session_refused_toolsets.json").read_text())
    return {"toolsets": list(data["toolsets"]), "prefixes": list(data["prefixes"])}


def _effective_ladder(rt: Any, state: Any) -> Any:
    try:
        return rt.ladder_of(state)
    except (ValueError, KeyError):
        return None


def _frontier(rt: Any, settings: Any, state: Any, ladder: Any) -> dict[str, Any]:
    """``frontier`` (ADR-0037): the models governed mode allows, whether the ladder (the session's, else the configured
    one) is all frontier, and, for a session that has begun, whether its own model is."""
    from ..governance.frontier import session_refusal, view
    from ..governance.ladder import resolve_ladder

    if ladder is None:
        try:
            ladder = resolve_ladder(settings.ladder)
        except (ValueError, KeyError):
            ladder = None
    out = view(ladder.tiers if ladder is not None else ())
    if state is not None and state.model:
        why = session_refusal(state.provider, state.model)
        out["session_model"] = {"provider": state.provider, "model": state.model, "frontier": why is None, "why": why}
    return out


def _ladder_errors(rt: Any, state: Any) -> list[str]:
    """Why the session's tier ladder cannot run (a provider Hermes has no configuration for, an unknown start tier);
    empty when it can, or when the session is not governed and has no cascade."""
    from ..governance.ladder import ladder_problems

    if state.mode != "governed":
        return []
    try:
        return ladder_problems(rt.ladder_of(state), rt.provider_known, rt.start_tier_of(state))
    except (ValueError, KeyError) as exc:
        return [f"the tier ladder is invalid: {exc}"]


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
    start = params.get("start_tier")
    if start is not None and (not isinstance(start, str) or not start):
        raise InvalidParamsError("start_tier must be the name of a tier", data={"found": repr(start)})
    from .careful import check_pair, check_step

    careful, surface = check_step(params.get("careful"), params.get("surface"))
    check_pair(mode, careful)
    runtime().set_mode(
        sid, mode, ladder=ladder, gate_enabled=enabled, start_tier=start, careful=careful, surface=surface
    )
    return {}


def mode_once(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``mode.once``: the next message of a governed session runs outside governed mode, for that turn only (the owner's
    "@ ... can turn off governed mode for that message"). The mode and toolsets are fixed at the first prompt and stay
    fixed: this arms one turn (``turns.py``). It resets itself when the turn ends, however it ends, and lapses if no
    turn starts within two minutes. ``armed: false`` withdraws it (the message could not be sent). Answers whether the
    session is armed: an ungoverned session has no governance to suspend, so it answers ``armed: false``."""
    from .. import turns

    sid = _session_id(params, session_id)
    armed = params.get("armed", True)
    if not isinstance(armed, bool):
        raise InvalidParamsError("armed must be a boolean", data={"found": repr(armed)})
    rt = runtime()
    return {"armed": turns.arm(rt, rt.state(sid), armed)}


def turns_bind(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``turns.bind``: the turn that just completed was stored as these rows (``message.complete.persisted_turn``), so
    the model that answered, and what the turn showed (a council's member answers, the task cards), survive a resume.
    ``{recorded: false}`` when the plugin saw no model request for it."""
    from .. import turns

    rt = runtime()
    return turns.bind(rt, rt.state(_session_id(params, session_id)), params)


def turns_models(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``turns.models``: the recorded turns of the session, oldest first: ``{model, route, ungoverned, user_row_id,
    row_ids}`` and, when the turn showed them, ``council`` and ``children``; ``model`` as ``provider/model``. A turn
    that is not listed is unknown."""
    from .. import turns

    rt = runtime()
    return turns.models(rt, rt.state(_session_id(params, session_id)))


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


def cascade_start_tier(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``cascade.start_tier``: where the next governed task starts on the ladder (a tier name), or ``null`` for the
    configured start. Unlike ``mode.set`` it is allowed after the first prompt: the start tier is read when a task is
    dispatched, so it does not touch the cached prompt. It is how a person's pick, or the UI's Smart choice, applies in
    governed mode; the gate still escalates past it."""
    sid = _session_id(params, session_id)
    start = params.get("start_tier")
    if start is not None and (not isinstance(start, str) or not start):
        raise InvalidParamsError("start_tier must be the name of a tier or null", data={"found": repr(start)})
    rt = runtime()
    state = rt.state(sid)
    with state.lock:
        if start is not None:
            names = rt.ladder_of(state).names
            if start not in names:
                raise InvalidParamsError(
                    f"start_tier {start!r} is not a tier of the ladder", data={"tiers": list(names)}
                )
        state.start_tier = start
    return {}


def dispatch_roster(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    """``dispatch.roster``: the models the person can use right now (``{models: [{provider, model}]}``, in the order he
    prefers them), so that ``delegate_task`` of a session made *after* this call can name them (``target``). The tools
    of a session are fixed when it is created (prompt caching), so a model signed in later is named by the next session.
    Returns the words each model answers to. Not session-bound: it is the process's menu, set by the desktop."""
    models = params.get("models")
    if not isinstance(models, list):
        raise InvalidParamsError("models must be a list of {provider, model}")
    items: list[Mapping[str, Any]] = []
    for i, item in enumerate(cast("list[Any]", models)):
        if not isinstance(item, Mapping) or not isinstance(item.get("model"), str) or not item.get("model"):
            raise InvalidParamsError(f"models[{i}] must be an object with a model", data={"found": repr(item)})
        items.append(cast("Mapping[str, Any]", item))
    entries = runtime().roster.set_models(items)
    return {"aliases": [{"alias": e.alias, "provider": e.provider, "model": e.model} for e in entries]}


def cascade_state(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """Where the session's cascade is: its ladder, and the current task, tier, attempt and status (``idle`` when no
    task has run). ``governance.engine.state_view`` reads the ledger and the live run."""
    from ..governance.engine import state_view

    sid = _session_id(params, session_id)
    rt = runtime()
    return state_view(rt, rt.state(sid))


def prices_refresh(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """One HTTPS GET of the models.dev catalogue into the profile's cache. Takes no URL: the address is
    fixed, so a caller cannot aim the plugin at another host."""
    rt = runtime()
    if not rt.load_settings().value.prices.refresh_enabled:
        raise PricesDisabledError("prices.refresh_enabled is false in the plugin settings")
    return refresh(rt.home)


def budget_state(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The session's current run against its bot's cap per run, and the team's month (ADR-0050)."""
    from .. import budget

    rt = runtime()
    state = rt.state(_session_id(params, session_id))
    return {"run": budget.run_view(state, rt.bot_rules()), "month": budget.month_view(rt, state)}


def budget_get(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The team's monthly budget and this month's spend, for every profile of the root."""
    from .. import budget

    rt = runtime()
    sid = params.get("session_id") or session_id
    state = rt.state(sid) if isinstance(sid, str) and sid else None
    if state is None or state.book is None:
        from ..session import SessionState

        settings = rt.load_settings().value
        state = SessionState("", settings.mode, settings=settings, book=rt.price_book(settings))
    return budget.month_view(rt, state)


def budget_set(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    """``{monthly_usd: "50.00" | null}``: set or clear the team's monthly budget (``<root>/boopis/budget.json``)."""
    from ..budget import month

    if "monthly_usd" not in params:
        raise InvalidParamsError("monthly_usd is required (dollars like '50.00', or null to clear the budget)")
    from ..hostops.channel import require_owner_grant

    require_owner_grant(dict(params), "budget.set")
    rt = runtime()
    doc = month.write_budget(rt.root, params["monthly_usd"])
    return {"monthly_usd": doc["monthly_usd"]}


def handlers() -> dict[str, Handler]:
    from ..bots.rpc import HANDLERS as BOT_HANDLERS
    from ..forms.rpc import form_cancel, form_list, form_submit
    from ..mods.rpc import HANDLERS as MOD_HANDLERS
    from ..rules.rpc import HANDLERS as RULES_HANDLERS
    from ..store.rpc import HANDLERS as STORE_HANDLERS

    return {
        **RULES_HANDLERS,
        **MOD_HANDLERS,
        **STORE_HANDLERS,
        **BOT_HANDLERS,
        "form.submit": form_submit,
        "form.cancel": form_cancel,
        "form.list": form_list,
        "describe": describe,
        "mode.set": mode_set,
        "mode.once": mode_once,
        "turns.bind": turns_bind,
        "turns.models": turns_models,
        "budget.state": budget_state,
        "budget.get": budget_get,
        "budget.set": budget_set,
        "ledger.tail": ledger_tail,
        "ledger.verify": ledger_verify,
        "ledger.stats": ledger_stats,
        "cascade.state": cascade_state,
        "cascade.start_tier": cascade_start_tier,
        "dispatch.roster": dispatch_roster,
        "prices.refresh": prices_refresh,
        "blank.fill": blank_fill,
        "checkpoint.list": checkpoint_list,
        "checkpoint.diff": checkpoint_diff,
        "checkpoint.rewind": checkpoint_rewind,
        "careful.set": careful_set,
        "continue.arm": continue_arm,
        "continue.chain": continue_chain,
    }


__all__ = ["CAPABILITIES", "handlers"]
