"""``form.submit``, ``form.cancel`` and ``form.list`` (docs/PROTOCOL.md section 3). Handlers raise a ``HypotaxisError``;
Hermes reports it as ``plugin_rpc_failed`` with the stable code first in the text."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from ..errors import InvalidParamsError
from .tools import service


def _form_id(params: Mapping[str, Any]) -> str:
    form_id = params.get("form_id")
    if not isinstance(form_id, str) or not form_id:
        raise InvalidParamsError("form_id is required")
    return form_id


def form_submit(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``{form_id, values, provided?}``. Secret fields are not in ``values``: the UI saved them with the host and names
    them in ``provided``. Returns ``{status}``; the agent's answer is built here and never contains a secret."""
    from ..hooks import runtime

    provided = params.get("provided", [])
    if not isinstance(provided, list) or not all(isinstance(p, str) for p in cast("list[Any]", provided)):
        raise InvalidParamsError("provided must be a list of secret field names")
    result = service(runtime()).submit(
        _form_id(params), params.get("values", {}), cast("list[str]", provided), session_id=session_id
    )
    return {"form_id": result["form_id"], "status": result["status"]}


def form_cancel(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    from ..hooks import runtime

    result = service(runtime()).cancel(_form_id(params), session_id=session_id)
    return {"form_id": result["form_id"], "status": result["status"]}


def form_list(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The session's open forms, in the shape of ``form.opened``, so a client that reconnects can draw them again."""
    from ..hooks import runtime

    sid = params.get("session_id") or session_id
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    return {"forms": [f.opened_payload() for f in service(runtime()).open_forms(sid)]}
