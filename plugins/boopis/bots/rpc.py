"""``plugin.boopis.bots.*``: what only boopis does for a teammate.

The rest is Hermes's own ``profiles.*`` and ``cron.manage``.

``bots.read``     every teammate's store: ``{root, bots: [{name, path, record, problem, archived}]}``
``bots.write``    ``{name, look?, settings?, approvals?}``: merge into the teammate's store, answer the whole record
``bots.guide``    ``{name}``: the hand-off skill (use of the kanban board) into the teammate's skills
``bots.toolsets`` ``{name, on?, off?}``: switch toolsets on and off, the same for its chats, workers and room turns
``bots.inspect``  ``{name}``: what deleting it would remove, counted on disk
``bots.archive``  ``{name, paused_jobs?}``: Hermes's ``profile rename`` to ``archived--<name>``; notes paused jobs
``bots.restore``  ``{name}``: the way back; answers the routines to resume
``bots.delete``   ``{name, confirm}``: Hermes's ``profile delete``; ``confirm`` must be the name
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from ..errors import InvalidParamsError
from . import homes
from .cli import SubprocessCli
from .service import BotService

Handler = Callable[..., Any]
MAX_PAUSED = 200


def service() -> BotService:
    """The service over this gateway's Hermes. Tests replace it."""
    from ..hermes_api import hermes_home

    return BotService(homes.default_root(), SubprocessCli(hermes_home()))


def _name(params: Mapping[str, Any]) -> str:
    return homes.check_name(params.get("name"))


def bots_read(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().read_all()


def bots_write(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    record = service().write(_name(params), params.get("look"), params.get("settings"), params.get("approvals"))
    return {"record": record}


def bots_guide(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().guide(_name(params))


def bots_toolsets(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().toolsets(_name(params), params.get("on"), params.get("off"))


def bots_inspect(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().inspect(_name(params))


def bots_archive(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    paused = params.get("paused_jobs", [])
    if (
        not isinstance(paused, list)
        or len(paused) > MAX_PAUSED
        or not all(isinstance(j, str) and 0 < len(j) <= 128 for j in paused)
    ):  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
        raise InvalidParamsError("paused_jobs is a list of job ids", data={"found": repr(paused)[:200]})
    return service().archive(_name(params), paused)  # pyright: ignore[reportUnknownArgumentType]


def bots_restore(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().restore(_name(params))


def bots_delete(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    return service().delete(_name(params), params.get("confirm"))


HANDLERS: dict[str, Handler] = {
    "bots.read": bots_read,
    "bots.write": bots_write,
    "bots.guide": bots_guide,
    "bots.toolsets": bots_toolsets,
    "bots.inspect": bots_inspect,
    "bots.archive": bots_archive,
    "bots.restore": bots_restore,
    "bots.delete": bots_delete,
}
