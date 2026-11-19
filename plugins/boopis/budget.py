"""The cost cap: may the next model call happen?

One implementation for every caller: the ``pre_llm_call`` hook (the orchestrator's turn, and each worker's start) and
the cascade (before it launches an attempt, which is a model call it pays for). Dollars are computed from tokens and the
price book on the way in and never stored; the ledger gets the cap value only (docs/STANDARDS.md rule 4, ADR-0012).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .util.log import get_logger

if TYPE_CHECKING:
    from .session import Runtime, SessionState

_log = get_logger("budget")


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


def record_block(rt: Runtime, state: SessionState, reason: str) -> None:
    """``budget.blocked`` in the ledger (the cap, never the spend) and to viewers (with the spend)."""
    cap = state.settings.cost_cap_usd
    if cap is None:
        return
    try:
        rt.ledger(state).append(
            "budget.blocked",
            "plugin",
            {"cap_usd": cap, "price_table": state.book.version if state.book else "", "reason": reason},
        )
        rt.ctx.emit_to_session(state.session_id, "budget.blocked", {"cap_usd": cap, "projected_usd": state.spend_usd})
    except Exception:  # noqa: BLE001 - the block itself must still happen
        _log.error("budget.blocked not recorded", exc_info=True)
