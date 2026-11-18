"""The hypotaxis tools, registered in toolset ``hypotaxis`` (docs/ARCHITECTURE.md section 7).

Handlers take ``(args, **kw)`` and return a JSON string; they never raise (docs/STANDARDS.md
section 3). ``check_fn`` hides a tool while hx is unavailable, so a model never sees a tool that
cannot work. Heavy modules load on the first call.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

TOOLSET = "hypotaxis"
TOOLS = ("pack", "exec", "ship")
SCHEMAS = Path(__file__).with_name("schemas.json")


def tool_schemas() -> dict[str, Any]:
    schemas: dict[str, Any] = json.loads(SCHEMAS.read_text(encoding="utf-8"))
    return schemas


def hx_ready() -> bool:
    """``check_fn``: a usable hx binary exists. Never starts it."""
    from .. import hx
    from ..hooks import runtime

    try:
        return hx.available(runtime().load_settings().value.hx_path)
    except Exception:  # noqa: BLE001 - a check that errors hides the tool
        return False


def exec_ready() -> bool:
    """``check_fn`` of exec: hx exists and the platform has the kernel's private channel. Windows has none
    yet, so exec is hidden there rather than offered and then refused."""
    from ..exec import available

    return available() and hx_ready()


def _session(args: Mapping[str, Any], kw: Mapping[str, Any]) -> Any:
    from ..hooks import runtime

    rt = runtime()
    sid = str(kw.get("session_id") or "")
    if not sid:
        return rt, None
    return rt, rt.lock(sid)


def pack_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from .pack import run_pack, to_json

    try:
        rt, state = _session(args, kw)
        if state is None:
            return to_json({"error": "pack needs a session", "code": "hx.config.invalid"})
        return to_json(run_pack(rt, state, args))
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"pack failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})


def ship_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from ..ship import run_ship

    try:
        rt, state = _session(args, kw)
        if state is None:
            return json.dumps({"error": "ship needs a session", "code": "hx.config.invalid"})
        return json.dumps(run_ship(rt, state, args), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"ship failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})


def exec_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from ..exec import run_exec, to_json

    try:
        rt, state = _session(args, kw)
        if state is None:
            return json.dumps({"error": "exec needs a session", "code": "hx.config.invalid"})
        return to_json(run_exec(rt, state, args, kw))
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"exec failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})
