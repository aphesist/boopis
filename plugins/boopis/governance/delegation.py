"""The delegation provider (``delegation.backend: boopis``): the plugin picks the model a worker runs on.

Hermes asks the active delegation provider for one route per ``delegate_task`` task (``route_task``). This one declares
no task parameters, so Hermes refuses a task that carries a ``tier`` or a ``model`` (it refuses what a backend did not
declare), and answers from the ledger: the attempt being launched (``engine.CURRENT``, set by ``dispatch`` on this very
thread) has a ``route.decided``, written by the plugin, that names a tier of the ladder recorded in ``session.opened``.
Called any other way (the model calling ``delegate_task`` itself, another plugin) there is no attempt, and the task is
refused: a tier is never a model's to choose.

Everything crossing this interface is plain data, so the provider runs unchanged in-process and under
``plugins.isolation: host`` (agent/delegation_provider.py).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .._vendor.contraprova.interfaces import TierLadder
from ..session import Runtime
from .engine import CURRENT
from .host import BACKEND
from .state import replay

DESCRIPTION = (
    "Models are chosen by the boopis plugin from its tier ladder and cannot be requested here. "
    "Governed work goes through the dispatch tool."
)


class RouteRefused(Exception):
    """The task has no route. The message reaches the model as the tool error, so it says what to do instead."""


def _recorded_ladder(events: list[dict[str, Any]]) -> TierLadder | None:
    """The ladder ``session.opened`` recorded last (the ledger is where the tiers live, as data)."""
    for event in reversed(events):
        if event["type"] == "session.opened" and "ladder" in event["payload"]:
            return TierLadder.from_dict(event["payload"]["ladder"])  # type: ignore[no-any-return]
    return None


def tier_route(rt: Runtime) -> dict[str, Any]:
    """The route of the attempt being launched: its tier's provider, model and effort, read from the ledger."""
    launching = CURRENT.get()
    if launching is None:
        raise RouteRefused(
            "Models are chosen by the boopis plugin, and only for work started with its dispatch tool. "
            "Use dispatch(brief) instead of delegate_task."
        )
    state = rt.state(launching.session_id)
    events = rt.ledger(state).read()
    attempts = replay(events, launching.task_id)
    if not attempts or attempts[-1].tier_index != launching.tier_index or attempts[-1].verdict is not None:
        raise RouteRefused("The ledger has no open attempt for this task, so no tier is decided.")
    ladder = _recorded_ladder(events) or rt.ladder_of(state)
    tier = ladder.tiers[attempts[-1].tier_index]
    return {
        "provider": tier.model.provider,
        "model": tier.model.id,
        "reasoning_effort": tier.effort.value,
        "label": tier.name,
    }


def make_provider() -> Any:
    """The provider object, built where Hermes's ABC is importable (``agent.delegation_provider`` is on the public
    plugin API list). The class is made here so that importing the plugin outside Hermes stays possible."""
    from agent.delegation_provider import (  # pyright: ignore[reportMissingImports]
        DelegationProvider,
        DelegationRouteError,
    )

    from ..hooks import runtime

    class BoopisDelegation(DelegationProvider):  # type: ignore[misc]
        @property
        def name(self) -> str:
            return BACKEND

        @property
        def summary(self) -> str:
            return "boopis: tiers from the plugin's ladder; the gate decides the next one"

        def description(self, config: Mapping[str, Any]) -> str:
            return DESCRIPTION

        def route_task(self, task: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
            # ``task`` and ``config`` are deliberately not read: nothing the model wrote can pick a model
            try:
                return tier_route(runtime())
            except RouteRefused as exc:
                raise DelegationRouteError(str(exc)) from exc

    return BoopisDelegation()
