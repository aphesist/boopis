"""``mod.*``: what the UI sends about mods (docs/PROTOCOL.md). Handlers raise a ``HypotaxisError`` and return JSON.

The UI never runs mod code. It draws the trees in ``mod.render`` and answers with the handler id of the element the
user used (``mod.press``, ``mod.input``, ``mod.select``); the handler runs in the worker.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError


def _service() -> Any:
    from . import current

    return current()


def _sid(params: Mapping[str, Any], session_id: str | None) -> str:
    sid = params.get("session_id") or session_id
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    return sid


def _text(params: Mapping[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str):
        raise InvalidParamsError(f"{key} must be a string")
    return value


def mod_press(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    return {"handled": _service().press(_sid(params, session_id), _text(params, "handler"))}


def mod_input(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    return {"handled": _service().input(_sid(params, session_id), _text(params, "handler"), _text(params, "value"))}


def mod_select(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    return {"handled": _service().select(_sid(params, session_id), _text(params, "handler"), _text(params, "value"))}


def mod_props(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The UI tells a site's props (``AbovePrompt``'s ``isWorking``, a pane's width) and asks for a redraw."""
    props = params.get("props") or {}
    if not isinstance(props, Mapping):
        raise InvalidParamsError("props must be an object")
    site = params.get("id")
    _service().set_props(
        _sid(params, session_id), _text(params, "component"), site if isinstance(site, str) else None, props
    )
    return {}


def mod_list(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = params.get("session_id") or session_id
    return {
        "capabilities": _service().availability(),
        "sessions": _service().list(sid if isinstance(sid, str) else None),
    }


def mod_unload(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """Disable one mod of the session, or every mod (no ``plugin``): the kill switch."""
    plugin = params.get("plugin")
    return {"unloaded": _service().unload(_sid(params, session_id), plugin if isinstance(plugin, str) else None)}


def mod_install_prepare(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from ..hooks import runtime
    from .install import prepare

    return prepare(runtime(), Path(_text(params, "source")))


def mod_install_confirm(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    from ..hooks import runtime
    from .install import install

    cwd = params.get("cwd")
    return install(
        runtime(),
        Path(_text(params, "source")),
        expect_sha256=_text(params, "tree_sha256"),
        cwd=cwd if isinstance(cwd, str) else "",
    )


HANDLERS = {
    "mod.press": mod_press,
    "mod.input": mod_input,
    "mod.select": mod_select,
    "mod.props": mod_props,
    "mod.list": mod_list,
    "mod.unload": mod_unload,
    "mod.install.prepare": mod_install_prepare,
    "mod.install.confirm": mod_install_confirm,
}
