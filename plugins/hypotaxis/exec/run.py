"""The ``exec`` tool: one call runs one cell and returns when the cell ends (docs/ARCHITECTURE.md section 7).

Never raises: an infrastructure failure (no sandbox, the kernel is gone) is an ``{"error", "code"}`` object, and
what the cell did (raised, timed out, was cancelled) is a successful call whose ``status`` says so.
"""

from __future__ import annotations

import contextvars
import json
import sys
from collections.abc import Mapping
from typing import Any

from ..config.model import ExecSettings
from ..errors import HypotaxisError, KernelDeadError, SandboxUnavailableError
from ..session import Runtime, SessionState
from ..util.log import get_logger
from .calls import CellServices
from .cell import CallFailure, Cell
from .registry import registry

_log = get_logger("exec")
MIN_TIMEOUT_MS = 100
LOG_LINES = 30
DEAD_NOTE = "Every variable from earlier cells is gone; the next exec call starts a fresh kernel."


def _timeout(args: Mapping[str, Any], settings: ExecSettings) -> tuple[int, str]:
    """The cell's timeout in ms, and a note when the model's value was changed."""
    asked = args.get("timeout_ms")
    if isinstance(asked, bool) or not isinstance(asked, int):
        return settings.timeout_ms, ""
    clamped = min(max(asked, MIN_TIMEOUT_MS), settings.max_timeout_ms)
    return clamped, ("" if clamped == asked else f"timeout_ms {asked} was changed to {clamped} (exec.max_timeout_ms)")


def _calls(cell: Cell) -> dict[str, Any] | None:
    with cell.lock:
        if not cell.calls and not cell.limit_hit:
            return None
        lines = [c.line() for c in cell.calls[:LOG_LINES]]
        if len(cell.calls) > LOG_LINES:
            lines.append(f"... and {len(cell.calls) - LOG_LINES} more")
        summary: dict[str, Any] = {"total": len(cell.calls), "log": lines}
        if cell.limit_hit:
            summary["refused_over_limit"] = cell.limit_hit
        if cell.in_flight:
            summary["still_running"] = cell.in_flight
        return summary


def _streams(cell: Cell, outcome: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, stream in (("stdout", cell.stdout), ("stderr", cell.stderr)):
        text = stream.text()
        if text:
            out[name] = text
    cut: dict[str, Any] = {}
    for name, info in (outcome.get("output") or {}).items():
        if info.get("bytes", 0) > info.get("shown", 0):
            cut[name] = {"bytes": info["bytes"], "shown": info["shown"], "full_text_in": info.get("spill")}
    if cut:
        out["truncated"] = cut
    return out


def render(cell: Cell, outcome: Mapping[str, Any], notes: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {"status": outcome["status"], **_streams(cell, outcome)}
    if "result_repr" in outcome:
        result["result"] = outcome["result_repr"]
        if outcome.get("result_truncated"):
            result["result_truncated"] = True
    if "error" in outcome:
        result["error"] = outcome["error"]
    if (calls := _calls(cell)) is not None:
        result["calls"] = calls
    if cell.blanks:
        result["blanks"] = list(cell.blanks)
    if cell.forms:
        result["forms"] = list(cell.forms)
    result["duration_ms"] = outcome.get("duration_ms", 0)
    result["cell"] = outcome.get("execution_count")
    if notes:
        result["notes"] = notes
    return result


def render_dead(cell: Cell, reason: str, notes: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "dead",
        "code": KernelDeadError.code,
        "error": f"{reason}. {DEAD_NOTE}",
        **_streams(cell, {}),
    }
    if (calls := _calls(cell)) is not None:
        result["calls"] = calls
    if cell.blanks:
        result["blanks"] = list(cell.blanks)
    if cell.forms:
        result["forms"] = list(cell.forms)
    if notes:
        result["notes"] = notes
    return result


def _preconditions(state: SessionState, args: Mapping[str, Any]) -> dict[str, Any] | None:
    if sys.platform == "win32":
        return {
            "error": "exec is not available on Windows yet: it needs the sandbox's private channel, and running the "
            "kernel unsandboxed is not an option.",
            "code": SandboxUnavailableError.code,
        }
    code = args.get("code")
    if not isinstance(code, str) or not code.strip():
        return {"error": "exec needs `code`: the Python source of one cell.", "code": "hx.exec.invalid"}
    if not state.cwd:
        return {
            "error": "the session's working directory is not known, so exec has no workspace to mount.",
            "code": "hx.exec.invalid",
        }
    return None


def run_exec(rt: Runtime, state: SessionState, args: Mapping[str, Any], kw: Mapping[str, Any]) -> dict[str, Any]:
    """One ``exec`` call. ``kw`` is what Hermes handed the handler (task and session ids, forwarded to the
    tools the cell calls)."""
    if (problem := _preconditions(state, args)) is not None:
        return problem
    settings = state.settings.exec
    timeout_ms, note = _timeout(args, settings)
    notes = [note] if note else []
    try:
        kernel, restarted = registry().acquire(rt, state)
    except SandboxUnavailableError as exc:
        return {"error": exc.message, "code": exc.code}
    except CallFailure as failure:
        return {"error": failure.message, "code": failure.code}
    except HypotaxisError as exc:
        return {"error": exc.message, "code": exc.code}
    if restarted:
        notes.append(f"a new kernel was started; its variables are empty. {restarted}.")
    dispatch = {k: kw[k] for k in ("task_id", "session_id", "conversation_id") if kw.get(k)}
    cell = Cell.create(
        state.session_id,
        str(kw.get("tool_call_id") or ""),
        max_calls=settings.max_calls_per_cell,
        output_cap=settings.output_cap_bytes,
        context=contextvars.copy_context(),
        dispatch_kwargs={"session_id": state.session_id, **dispatch},
    )
    try:
        outcome = kernel.run(cell, str(args["code"]), timeout_ms)
    except KernelDeadError as exc:
        return render_dead(cell, exc.message, notes)
    except CallFailure as failure:
        return {"error": failure.message, "code": failure.code}
    except Exception as exc:  # noqa: BLE001 - a tool handler never raises into Hermes
        _log.error("exec failed", exc_info=True)
        return {"error": f"exec failed: {type(exc).__name__}: {exc}", "code": "hx.internal_error"}
    finally:
        _close(kernel, cell)
    return render(cell, outcome, notes)


def _close(kernel: Any, cell: Cell) -> None:
    server = getattr(kernel, "_server", None)
    if isinstance(server, CellServices):
        server.close_cell(cell)


def to_json(result: Mapping[str, Any]) -> str:
    return json.dumps(result, ensure_ascii=False)
