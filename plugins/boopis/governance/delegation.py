"""The delegation provider (``delegation.backend: boopis``): the plugin picks the model a worker runs on.

Hermes asks the active delegation provider for one route per ``delegate_task`` task (``route_task``). This one declares
no task parameters, so Hermes refuses a task that carries a ``tier`` or a ``model`` (it refuses what a backend did not
declare), and answers from the ledger: the attempt being launched (``engine.CURRENT``, set by ``dispatch`` on this very
thread) has a ``route.decided``, written by the plugin, that names a tier of the ladder recorded in ``session.opened``.
Called any other way (the model calling ``delegate_task`` itself, another plugin) there is no attempt, and the task is
refused: a tier is never a model's to choose.

A session that is not governed has a second, user-directed path (ADR-0034): ``delegate_task`` declares one task
parameter, ``target``, an enum of the words of the models the person can use (``governance.roster``), and a task that
sets it runs on that model, but only if the person wrote that word in the message that started the turn. The session's
own model splits "this to opus, this to codex" into tasks; it never picks a provider, and never a model nobody named.

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
from .roster import Roster
from .state import replay

DESCRIPTION = (
    "Models are chosen by the boopis plugin from its tier ladder and cannot be requested here. "
    "Governed work goes through the dispatch tool."
)


TARGET = "target"  # the task parameter that names a model (not a reserved name: ``model`` is core's)
DIRECTED = (
    "A session that is not governed may send a task to a model the user named: set `target` on that task to the "
    "word the user wrote (for example opus, codex, grok). Split the message into one task per model, each goal "
    "complete on its own (a child starts with no context beyond `goal` and `context`), then report the results. "
    "Never set `target` to a model the user did not name in the message that started this turn."
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


def user_directed_allowed(state: Any) -> bool:
    """Whether this session may send a task to a model the user named: any session that is not governed. The one place
    that says so, so a turn that runs ungoverned by the user's choice is allowed in exactly the same way."""
    return bool(state.mode != "governed")


def _parent_session(rt: Runtime) -> str:
    session_id = getattr(rt.active_parent(), "session_id", None)
    return session_id if isinstance(session_id, str) else ""


def directed_route(rt: Runtime, roster: Roster, task: Mapping[str, Any], session_id: str) -> dict[str, Any]:
    """The route of a task the user directed: the model of the word in ``target``, if the user named it."""
    word = task.get(TARGET)
    if not word:
        raise RouteRefused(
            "Set `target` to the model the user named for this task. Tasks only go to models the user named in "
            "their message; without one, do the work yourself."
        )
    available = [e.alias for e in roster.entries]
    entry = roster.find(str(word))
    if entry is None:
        listing = ", ".join(available) if available else "none (no model is signed in or configured)"
        raise RouteRefused(
            f"No model called {word!r} is available. The models that can take a task are: {listing}. "
            "Tell the user which one is not available instead of choosing another."
        )
    if not roster.named(session_id, entry.alias):
        raise RouteRefused(
            f"The user did not name {entry.alias!r} in the message that started this turn, so no task goes to it. "
            "Tasks go only to models the user named; do the work yourself or ask which model to use."
        )
    return {"provider": entry.provider, "model": entry.model, "label": entry.alias}


def governed_message() -> str:
    return (
        "This session is governed: tiers are chosen by the plugin's ladder and only for work started with the "
        "dispatch tool. Use dispatch(brief) instead of delegate_task."
    )


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

        def task_parameters(self, config: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
            # Read once when a session's tools are built (the schema is cached prompt), from the roster the desktop
            # set just before it created the session: a model signed in later is named by the next session.
            entries = runtime().roster.entries
            if not entries:
                return {}
            lines = [
                "The model that runs this task. Only for a model the user named in their message; omit otherwise.",
                *(f"{e.alias}: {e.model}" for e in entries),
            ]
            return {TARGET: {"type": "string", "enum": [e.alias for e in entries], "description": "\n".join(lines)}}

        def description(self, config: Mapping[str, Any]) -> str:
            return DESCRIPTION + (" " + DIRECTED if runtime().roster.entries else "")

        def route_task(self, task: Mapping[str, Any], config: Mapping[str, Any]) -> dict[str, Any]:
            # A governed task's route is the ladder's and nothing the model wrote picks it. In a session that is not
            # governed, ``target`` picks a model, only one the user named (``directed_route``).
            rt = runtime()
            try:
                session_id = _parent_session(rt)
                if CURRENT.get() is None and session_id and user_directed_allowed(rt.state(session_id)):
                    return directed_route(rt, rt.roster, task, session_id)
                if task.get(TARGET) and CURRENT.get() is None:
                    raise RouteRefused(governed_message())
                return tier_route(rt)
            except RouteRefused as exc:
                raise DelegationRouteError(str(exc)) from exc

    return BoopisDelegation()
