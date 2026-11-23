"""A bot's cap per run, enforced while the run works.

**A run is one turn** of the bot: a message in its chat, its answer in a room, a kanban card's worker, a scheduled run,
one step of ``boopis run --bot``. It starts at ``pre_llm_call`` and its spend is every model request of that turn
(``post_api_request`` and the engine's side calls), the cascade's workers included, which work for the session.

**What is counted.** Dollars computed from the tokens and the price book, as the API would bill them, for every
provider: on a subscription the plan bills nothing per token, so the API-equivalent is what makes the cap mean
something there, as a token budget (``Costs.api_equivalent_usd``). Nothing is stored but the cap.

**Where it stops.** ``pre_llm_call`` fires once per turn, before anything is spent, and ``pre_api_request`` cannot block
(engine v0.23.2), so the cap is checked before every tool call of the turn (``pre_tool_call``): a run overshoots by at
most the model request that asked for the tool, plus the reply it writes once it is told to stop.

**The pause.** At the cap the call is held at the engine's own approval gate (the ``approve`` directive), so the card
reaches every surface that shows approvals: the app, the local API's inbox, the island. Allow (once, or any approving
answer) raises this run's cap by the cap again; Deny, a timeout or a withdrawn card stops the run, and every later tool
call of the turn is refused with a sentence that tells the model to stop. The rule key is new for every pause, so an
"always" answer on a chat platform cannot approve the next one. When the engine lets the call through without asking
anyone (``approvals.mode: off``, yolo, a cron set to approve), no answer is recorded, and the next call stops the run:
only a person raises a cap. A bot whose rule for spending past the cap is Block stops at the cap without a card.
"""

from __future__ import annotations

import threading
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

APPROVING = frozenset({"once", "session", "always"})
RULE_PREFIX = "boopis:budget:"


def money(value: float) -> str:
    """Dollars for a sentence a person reads."""
    return f"${value:.2f}"


@dataclass(slots=True)
class RunBudget:
    """One session's current run. Workers add to it from their own threads, so every change holds ``lock``."""

    turn_id: str = ""
    spent_usd: float = 0.0
    unpriced: set[str] = field(default_factory=set)
    raises: int = 0  # how many times a person raised the cap for this run
    unpriced_ok: bool = False  # a person let this run go on although its spend cannot be measured
    pending: str = ""  # the rule key of the pause card waiting for an answer
    stopped: str = ""  # why the run stopped; empty while it runs
    pauses: int = 0
    stop_recorded: bool = False  # the ledger has this run's stop already
    lock: threading.RLock = field(default_factory=threading.RLock)


@dataclass(frozen=True, slots=True)
class Verdict:
    """``pause``: hold the call at the approval gate with ``message`` under ``rule_key``. ``stop``: refuse it."""

    kind: Literal["pause", "stop"]
    message: str
    reason: str
    rule_key: str = ""


def begin(run: RunBudget, turn_id: str) -> None:
    """A new turn is a new run: what the last one spent or was allowed does not carry over."""
    with run.lock:
        run.turn_id = turn_id
        run.spent_usd = 0.0
        run.unpriced.clear()
        run.raises = 0
        run.unpriced_ok = False
        run.pending = ""
        run.stopped = ""
        run.stop_recorded = False


def stop(run: RunBudget, why: str) -> bool:
    """Stop the run for ``why`` (``month``: the team's budget). True the first time, when the stop is recorded."""
    with run.lock:
        run.stopped = run.stopped or why
        first = not run.stop_recorded
        run.stop_recorded = True
        return first


def first_stop(run: RunBudget) -> bool:
    """True once per run: the first refusal after the run stopped is the one the ledger records."""
    with run.lock:
        first = not run.stop_recorded
        run.stop_recorded = True
        return first


def add(run: RunBudget, api_usd: float | None, unpriced: Iterable[str]) -> None:
    """One model request of the run: its API-equivalent dollars, or the models that have no price."""
    with run.lock:
        if api_usd is not None:
            run.spent_usd += api_usd
        run.unpriced.update(unpriced)


def limit(run: RunBudget, cap: float) -> float:
    return cap * (1 + run.raises)


def check(run: RunBudget, *, cap: float, spend_tier: str, bot: str, asked_by: str, session_id: str) -> Verdict | None:
    """May the run make its next tool call? None when it may."""
    with run.lock:
        if run.pending:  # the last pause was let through with no answer recorded: nobody raised the cap
            run.pending = ""
            run.stopped = "no_answer"
        if run.stopped:
            return Verdict("stop", stopped_message(bot, run.stopped, cap), "run_cap_stopped")
        unmeasured = bool(run.unpriced) and not run.unpriced_ok
        if not unmeasured and run.spent_usd < limit(run, cap):
            return None
        if spend_tier == "block":
            run.stopped = "rule"
            return Verdict("stop", stopped_message(bot, "rule", cap, run.spent_usd), "run_cap_stopped")
        run.pauses += 1
        run.pending = f"{RULE_PREFIX}{session_id}:{run.turn_id}:{run.pauses}"
        message = (
            _unmeasured_message(bot, cap, sorted(run.unpriced))
            if unmeasured
            else _pause_message(bot, cap, run.spent_usd, limit(run, cap) + cap, run.raises)
        )
        return Verdict("pause", f"{message} {asked_by}".strip(), "run_cap_paused", run.pending)


def answered(run: RunBudget, rule_key: str, choice: str) -> bool:
    """The engine's ``post_approval_response`` for a pause of this run. True when it was this run's."""
    with run.lock:
        if not run.pending or rule_key != run.pending:
            return False
        run.pending = ""
        if choice in APPROVING:
            if run.unpriced and not run.unpriced_ok:
                run.unpriced_ok = True
            else:
                run.raises += 1
        else:
            run.stopped = "denied" if choice == "deny" else "no_answer"
        return True


def _pause_message(bot: str, cap: float, spent: float, next_limit: float, raises: int) -> str:
    raised = f" (raised {raises} {'time' if raises == 1 else 'times'} for this run)" if raises else ""
    return (
        f"{bot} has spent {money(spent)} of its {money(cap)} cap for this run{raised}. "
        f"Allow: this run may spend up to {money(next_limit)}. Deny, or no answer: the run stops here. "
        "The dollars are what these tokens cost on the API, also on a subscription, so the cap works as a token budget."
    )


def _unmeasured_message(bot: str, cap: float, models: list[str]) -> str:
    return (
        f"{bot} has a {money(cap)} cap for this run, but no price is known for {', '.join(models)}, "
        "so its spend cannot be measured. Allow: this run goes on without a measured cap. "
        "Deny, or no answer: the run stops here."
    )


def stopped_message(bot: str, why: str, cap: float, spent: float | None = None) -> str:
    """What the model reads instead of a tool's result once the run is stopped: stop working, say what was done."""
    cause = {
        "rule": f"it reached its {money(cap)} cap for this run"
        + (f" ({money(spent)} spent)" if spent is not None else "")
        + " and its rule for spending past the cap is Block",
        "denied": f"the owner did not raise its {money(cap)} cap for this run",
        "no_answer": f"nobody answered at its {money(cap)} cap for this run",
    }.get(why, f"it reached its {money(cap)} cap for this run")
    return (
        f"The run of {bot} has stopped: {cause}. Do not call more tools in this turn. "
        "Reply with what you did so far and what is left, then stop."
    )
