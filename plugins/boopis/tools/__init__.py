"""The boopis tools, registered in toolset ``boopis`` (docs/ARCHITECTURE.md section 7).

Handlers take ``(args, **kw)`` and return a JSON string; they never raise (docs/STANDARDS.md
section 3). ``check_fn`` hides a tool while hx is unavailable, so a model never sees a tool that
cannot work. Heavy modules load on the first call.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

TOOLSET = "boopis"
TOOLS = ("pack", "exec", "ship", "dispatch")
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
    """``check_fn`` of exec: hx exists, the platform has the kernel's private channel (Windows has none yet) and a
    sandboxed kernel really starts here (``exec.probe``, cached). A tool that cannot work is hidden, not offered and
    then failed. The first call starts hx and one throwaway kernel."""
    from ..exec import available

    if not (available() and hx_ready()):
        return False
    try:
        from ..exec.probe import sandbox_problem
        from ..hooks import runtime

        rt = runtime()
        client = rt.hx_client()
        return client is not None and not sandbox_problem(client, rt.load_settings().value.exec)
    except Exception:  # noqa: BLE001 - a check that errors hides the tool
        return False


def _session(args: Mapping[str, Any], kw: Mapping[str, Any]) -> Any:
    """The runtime and the caller of a tool call: the session itself, or a worker (a delegated child, which works in
    its parent's session, ledger and workspace). ``(rt, None)`` when Hermes gave no session."""
    from ..hooks import runtime

    rt = runtime()
    sid = str(kw.get("session_id") or "")
    if not sid:
        return rt, None
    return rt, rt.caller(sid)


def _worker_call(caller: Any, name: str, args: Mapping[str, Any], started: float, result: str) -> str:
    """Record a worker's call (Hermes fires no ``post_tool_call`` for a child's tools) and pass ``result`` through."""
    if caller is not None and caller.worker:
        from ..hooks import record_worker_call

        parsed = json.loads(result)
        failed = isinstance(parsed, dict) and "error" in parsed
        record_worker_call(caller, name, args, round((time.monotonic() - started) * 1000), failed)
    return result


def pack_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from .pack import run_pack, to_json

    started = time.monotonic()
    try:
        rt, caller = _session(args, kw)
        if caller is None:
            return to_json({"error": "pack needs a session", "code": "hx.config.invalid"})
        return _worker_call(caller, "pack", args, started, to_json(run_pack(rt, caller.state, args)))
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"pack failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})


def ship_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from ..ship import run_ship

    started = time.monotonic()
    try:
        rt, caller = _session(args, kw)
        if caller is None:
            return json.dumps({"error": "ship needs a session", "code": "hx.config.invalid"})
        shipped = json.dumps(run_ship(rt, caller.state, args, caller.link), ensure_ascii=False)
        return _worker_call(caller, "ship", args, started, shipped)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"ship failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})


def exec_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from ..exec import run_exec, to_json

    started = time.monotonic()
    try:
        rt, caller = _session(args, kw)
        if caller is None:
            return json.dumps({"error": "exec needs a session", "code": "hx.config.invalid"})
        from .. import policy

        decision = policy.check(policy.ToolCall("exec", {}, str(kw.get("session_id") or "")), rt.policy_for(caller))
        if (
            decision.kind == "block"
        ):  # in governed mode exec is a worker's tool; a handler reached any other way refuses too
            return json.dumps({"error": decision.message, "code": "hx.policy.denied"})
        result = to_json(run_exec(rt, caller, args, kw))
        return _worker_call(caller, "exec", args, started, result)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"exec failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})


def dispatch_handler(args: Mapping[str, Any], **kw: Any) -> str:
    from ..governance.engine import dispatch

    try:
        rt, caller = _session(args, kw)
        if caller is None:
            return json.dumps({"error": "dispatch needs a session", "code": "hx.config.invalid"})
        if caller.worker:  # the policy refuses this first; a handler that is reached any other way refuses too
            return json.dumps({"status": "refused", "launched": False, "reason": "a worker cannot dispatch"})
        return json.dumps(dispatch(rt, caller.state, dict(args)), ensure_ascii=False)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": f"dispatch failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"})
