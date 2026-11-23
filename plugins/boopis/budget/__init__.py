"""Budgets: may the next model call, or the next tool call of a run, happen?

The hierarchy, tightest first wins (ADR-0048):

1. **a bot's cap per run** (``bot.json`` ``settings.cap``, ``run.py``): every turn of that bot, checked before each tool
   call, paused at the engine's approval gate;
2. **a room's budget**: not built yet (the room id of a member's turn is not in what a plugin hook receives; see the
   ADR);
3. **the team's monthly budget** (``<root>/boopis/budget.json``, ``month.py``): every profile of the root, checked when
   a turn starts and before each tool call, a stop (raising it is the owner's change, not a run's);
4. and, beside them, **a session's cost cap** (the plugin's ``cost_cap_usd``, below): billed dollars of one session,
   checked when a turn starts, as before.

Caps 1 and 3 count API-equivalent dollars, so a subscription's tokens count against them as a token budget; cap 4 counts
billed dollars, where a subscription costs nothing. Dollars are computed from tokens and the price book on the way in
and never stored; the ledger gets the cap value only (docs/STANDARDS.md rule 4, ADR-0012).

One implementation for every caller: the ``pre_llm_call`` and ``pre_tool_call`` hooks and the cascade (before it
launches an attempt, which is a model call it pays for).
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from ..util.log import get_logger
from . import month, run

if TYPE_CHECKING:
    from ..bots.rules import BotRules
    from ..session import Runtime, SessionState

_log = get_logger("budget")
BASIS = "api_equivalent"  # what the bot cap and the team budget count: tokens priced as the API bills them


def usd(value: float) -> str:
    return f"${value:.4f}"


def cap_block(state: SessionState, provider: str, model: str) -> tuple[str, str] | None:
    """``(message, reason)`` when a call to ``provider``/``model`` must not run: ``cap_reached`` or ``unpriced`` (a
    capped session blocks on a cost it cannot compute). None when there is no cap or the call may go ahead."""
    cap = state.settings.cost_cap_usd
    if cap is None:
        return None
    subscription = provider in state.settings.subscription_providers
    unpriced = sorted(state.unpriced)
    if model and not subscription and state.book is not None and not state.book.has(provider, model):
        unpriced = sorted({*unpriced, model})
    if unpriced:
        message = (
            f"The cost cap is {usd(cap)} but no price is configured for {', '.join(unpriced)}, "
            "so the spend cannot be computed. Add it to the plugin's prices setting or remove the cap."
        )
        return message, "unpriced"
    if state.spend_usd >= cap:
        message = (
            f"Cost cap reached: this session has spent {usd(state.spend_usd)} of the {usd(cap)} cap. "
            "Raise cost_cap_usd in the plugin settings to continue."
        )
        return message, "cap_reached"
    return None


def record_block(rt: Runtime, state: SessionState, reason: str, cap: float | None = None, scope: str = "") -> None:
    """``budget.blocked`` in the ledger (the cap, never the spend) and to viewers (with the spend). ``cap`` and
    ``scope`` name another cap than the session's (``run`` for a bot's cap per run, ``month`` for the team budget)."""
    value = state.settings.cost_cap_usd if cap is None else cap
    if value is None:
        return
    payload: dict[str, Any] = {
        "cap_usd": value,
        "price_table": state.book.version if state.book else "",
        "reason": reason,
    }
    if scope:
        payload["scope"] = scope
    try:
        rt.ledger(state).append("budget.blocked", "plugin", payload)
        projected = state.spend_usd if not scope else (state.run.spent_usd if scope == "run" else None)
        rt.ctx.emit_to_session(
            state.session_id,
            "budget.blocked",
            {"cap_usd": value, "projected_usd": projected} | ({"scope": scope} if scope else {}),
        )
    except Exception:  # noqa: BLE001 - the block itself must still happen
        _log.error("budget.blocked not recorded", exc_info=True)


# ---------------------------------------------------------------- the team's month


def month_view(rt: Runtime, state: SessionState, now: datetime | None = None) -> dict[str, Any]:
    """``{budget_usd, spent_usd, unpriced, since, until, problem}`` of the team's month. Never raises."""
    when = now or datetime.now(UTC)
    root = rt.root
    amount, problem = month.read_budget(root)
    view: dict[str, Any] = {"budget_usd": amount, "problem": problem, "basis": BASIS}
    if state.book is None:
        return view | {"spent_usd": None, "unpriced": [], "since": None, "until": None}
    try:
        spent = rt.month_scanner.spend(root, state.book, when, extra=rt.own_ledger_dirs(state))
    except Exception:  # noqa: BLE001 - an unreadable month is unknown, never zero
        _log.error("the month's spend could not be computed", exc_info=True)
        return view | {"spent_usd": None, "unpriced": [], "since": None, "until": None}
    return view | {
        "spent_usd": spent.spent_usd,
        "unpriced": list(spent.unpriced),
        "since": spent.since,
        "until": month.next_month(when).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }


def month_stop(rt: Runtime, state: SessionState, provider: str, model: str) -> tuple[str, float] | None:
    """``(message, budget)`` when the team's monthly budget refuses this session's next step. Fail closed: a budget
    file that cannot be read, a spend that cannot be computed, or a session model with no price refuses."""
    view = month_view(rt, state)
    if view["problem"]:
        return (f"boopis stopped this turn: {view['problem']}. Fix or remove the file to go on.", 0.0)
    amount = view["budget_usd"]
    if amount is None:
        return None
    if view["spent_usd"] is None:
        return (
            "boopis stopped this turn: the team's monthly budget is set, but this month's spend could not be computed.",
            amount,
        )
    if model and state.book is not None and not state.book.has(provider, model):
        return (
            f"boopis stopped this turn: the team's monthly budget is {run.money(amount)}, but no price is known for "
            f"{model}, so what it spends cannot be counted. Add a price for it, or clear the budget.",
            amount,
        )
    if view["spent_usd"] >= amount:
        until = str(view["until"] or "")[:10]
        return (
            f"The team's monthly budget is spent: {run.money(view['spent_usd'])} of {run.money(amount)} this month "
            f"(what the tokens cost on the API, subscriptions included). Nothing more runs until {until}, unless the "
            "owner raises the budget.",
            amount,
        )
    return None


# ---------------------------------------------------------------- a bot's run


def bot_turn_refusal(bot: BotRules | None) -> str | None:
    """A bot whose record cannot be trusted does not run (fail closed)."""
    if bot is None or not bot.problem:
        return None
    return (
        f"boopis did not run {bot.name}: its rules could not be read ({bot.problem}). Fix or remove bot.json to go on."
    )


def spend_tier(bot: BotRules) -> str:
    """What the bot does at its cap: Block stops there, anything else asks. Allow is read as Ask: a cap is never
    passed without a person (ADR-0048, ADR-0021's protected spend class)."""
    return "block" if bot.approvals.get("spend") == "block" else "ask"


def run_gate(state: SessionState, bot: BotRules | None, asked_by: str) -> run.Verdict | None:
    """The bot's cap per run before a tool call. None when there is no cap or the run may go on."""
    if bot is None or bot.cap_usd is None:
        return None
    return run.check(
        state.run,
        cap=bot.cap_usd,
        spend_tier=spend_tier(bot),
        bot=bot.name,
        asked_by=asked_by,
        session_id=state.session_id,
    )


def note_usage(rt: Runtime, state: SessionState, payload: Mapping[str, Any]) -> None:
    """One model request: add its API-equivalent to the run and tell viewers the run's spend against its cap."""
    if state.book is None:
        return
    from ..ledger import project_costs

    costs = project_costs([payload], state.book, ())
    run.add(state.run, costs.api_equivalent_usd, costs.unpriced)
    bot = rt.bot_rules()
    try:
        rt.ctx.emit_to_session(state.session_id, "budget.updated", run_view(state, bot))
    except Exception:  # noqa: BLE001 - a viewer that misses one update reads the next
        _log.debug("budget.updated not emitted", exc_info=True)


def run_view(state: SessionState, bot: BotRules | None) -> dict[str, Any]:
    """The current run as viewers see it: ``{turn_id, spent_usd, cap_usd, limit_usd, unpriced, stopped, basis}``.
    ``spent_usd`` is None while a model of the run has no price (unknown, never a partial sum)."""
    r = state.run
    with r.lock:
        cap = bot.cap_usd if bot is not None else None
        return {
            "turn_id": r.turn_id,
            "spent_usd": None if r.unpriced else r.spent_usd,
            "unpriced": sorted(r.unpriced),
            "cap_usd": cap,
            "limit_usd": run.limit(r, cap) if cap is not None else None,
            "raises": r.raises,
            "stopped": r.stopped or None,
            "bot": bot.name if bot is not None else None,
            "basis": BASIS,
        }


__all__ = [
    "BASIS",
    "bot_turn_refusal",
    "cap_block",
    "month_stop",
    "month_view",
    "note_usage",
    "record_block",
    "run_gate",
    "run_view",
    "spend_tier",
    "usd",
]
