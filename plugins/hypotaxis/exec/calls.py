"""What the plugin does for a cell: every kernel-originated call passes the plugin's own policy and ledger.

``ctx.dispatch_tool`` bypasses Hermes's hooks (docs/research/spike-s0.md), so ``pre_tool_call`` never sees
what a cell calls. This module is the second entry point of the **same** decision, in order:

1. the per-cell call limit (the plugin counts; the kernel is not trusted to);
2. ``policy.check`` with ``source="kernel"``, the function the hook uses: governed mode refuses the write
   tools, a ``terminal`` call (shell work is ``harness.sh``) and ``exec`` itself; deny rules and protected
   paths apply in every mode. An ``approve`` answer is a refusal here: a cell cannot ask a human mid-call;
3. ``ctx.dispatch_tool`` (or ``ctx.call_mcp``) with the exec call's task and session ids;
4. a ``tool.called`` ledger entry, the same payload the hook writes (``hooks.tool_called_payload``), whatever
   the outcome, with ``via: "exec"``. Arguments are hashed, never stored.

Any error before step 3 refuses (fail closed). The kernel's answer is the tool's own JSON, parsed.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Mapping
from typing import Any

from .. import policy
from ..hooks import tool_called_payload
from ..policy import Decision, ToolCall
from ..session import Runtime, SessionState
from ..util.log import get_logger
from .blanks import open_blank, open_form
from .cell import CallFailure, CallRecord, Cell

_log = get_logger("exec.calls")
TRUNCATION_NOTE = "\n[cut by exec.call_result_cap_bytes; ask the tool for less]"
UNSUPPORTED_DIAGNOSTICS = (
    "diagnostics are not available: Hermes's language-server integration reports only the delta of its own "
    "writes, and exec never writes the workspace. Run the project's checker with harness.sh instead."
)


def _decode(raw: Any, cap: int) -> tuple[Any, bool]:
    """A tool's answer as a Python value (JSON parsed when it is JSON), and whether it was cut."""
    if not isinstance(raw, str):
        return raw, False
    if len(raw) > cap:
        return raw[:cap] + TRUNCATION_NOTE, True
    try:
        return json.loads(raw), False
    except ValueError:
        return raw, False


def _reports_error(value: Any) -> bool:
    return (isinstance(value, Mapping) and bool(value.get("error"))) or (
        isinstance(value, Mapping) and value.get("ok") is False
    )  # type: ignore[union-attr]


def _mcp_tool_name(server: str, tool: str) -> str:
    """Hermes's sanitised name for an MCP tool, which is the name user rules match (``mcp__srv__tool``)."""
    return f"mcp_{re.sub(r'[-.]', '_', server)}_{re.sub(r'[-.]', '_', tool)}"


class CellServices:
    """The ``RequestServer`` of one session's kernel."""

    def __init__(self, rt: Runtime, state: SessionState) -> None:
        self._rt = rt
        self._state = state
        self._handlers: dict[str, Callable[[Cell, Mapping[str, Any]], dict[str, Any]]] = {
            "tool.call": self._tool,
            "mcp.call": self._mcp,
            "sh.call": self._sh_begin,
            "sh.done": self._sh_done,
            "blank.open": self._blank,
            "form.open": self._form,
            "diagnostics": self._diagnostics,
        }

    def serve(self, cell: Cell, method: str, params: Mapping[str, Any]) -> dict[str, Any]:
        handler = self._handlers.get(method)
        if handler is None:
            raise CallFailure("hx.method_not_found", f"the plugin does not serve {method!r}")
        return handler(cell, params)

    # ------------------------------------------------------------------ the shared step

    def _judge(self, tool: str, args: Mapping[str, Any], call_id: str, source: str = "kernel") -> Decision:
        session_policy = self._state.policy
        if session_policy is None:
            return policy.Decision(
                "block", message="the session's policy is not loaded, so the call was refused.", reason="fail_closed"
            )
        call = ToolCall(tool, args, self._state.session_id, call_id, source=source)  # type: ignore[arg-type]
        decision = policy.check(call, session_policy)
        if decision.kind == "approve":
            return policy.Decision(
                "block",
                message=f"{decision.message} A cell cannot ask for that confirmation: make this call directly, "
                "outside exec, so the owner can approve it.",
                reason="approval_needed",
                rule=decision.rule,
            )
        return decision

    def _record(
        self,
        cell: Cell,
        record: CallRecord,
        tool: str,
        args: Any,
        started: float,
        status: str,
        code: str = "",
        **extra: Any,
    ) -> None:
        """Close the call's record and write its ``tool.called``."""
        record.status, record.code = status, code
        record.ms = int((time.monotonic() - started) * 1000)
        try:
            payload = tool_called_payload(cell.call_id(record), tool, status, record.ms, args, error_code=code)
            payload.update(via="exec", cell_id=cell.id, **extra)
            self._rt.ledger(self._state).append("tool.called", self._state.actor(), payload)
        except Exception:  # noqa: BLE001 - the call already happened; a ledger fault is logged, never hidden by lying
            _log.error("tool.called for exec call %s not recorded", record.n, exc_info=True)

    def _governed(
        self,
        cell: Cell,
        tool: str,
        args: Mapping[str, Any],
        run: Callable[[Mapping[str, Any]], tuple[Any, bool]],
        source: str = "kernel",
    ) -> dict[str, Any]:
        record = cell.begin_call(tool)
        if record is None:
            raise CallFailure(
                "hx.exec.call_limit",
                f"this cell already made {cell.max_calls} calls (exec.max_calls_per_cell); do the rest next cell",
            )
        started = time.monotonic()
        try:
            decision = self._judge(tool, args, cell.call_id(record), source)
            if not decision.allowed:
                self._record(cell, record, tool, args, started, "blocked", "hx.policy.denied", reason=decision.reason)
                raise CallFailure(
                    "hx.policy.denied",
                    decision.message or f"{tool} is not allowed from exec",
                    {"reason": decision.reason},
                )
            use = dict(decision.args) if decision.kind == "modify" and decision.args is not None else dict(args)
            try:
                value, truncated = run(use)
            except CallFailure as failure:
                self._record(
                    cell,
                    record,
                    tool,
                    args,
                    started,
                    "blocked" if failure.code == "hx.policy.denied" else "error",
                    failure.code,
                )
                raise
            except Exception as exc:
                self._record(cell, record, tool, args, started, "error", "hx.internal_error")
                raise CallFailure("hx.internal_error", f"{tool} failed: {type(exc).__name__}: {exc}") from exc
            status = "error" if _reports_error(value) else "ok"
            self._record(cell, record, tool, args, started, status, "hx.tool.error" if status == "error" else "")
            return {"result": value, "status": status, "truncated": truncated}
        finally:
            cell.end_call()

    # ------------------------------------------------------------------ tools

    def _tool(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        name, args = params.get("name"), params.get("args", {})
        if not isinstance(name, str) or not name or not isinstance(args, Mapping):
            raise CallFailure("hx.exec.invalid", "tool.call needs a tool name and an object of arguments")
        cap = self._state.settings.exec.call_result_cap_bytes

        def run(use: Mapping[str, Any]) -> tuple[Any, bool]:
            raw = self._rt.ctx.dispatch_tool(name, dict(use), **cell.dispatch_kwargs)
            return _decode(raw, cap)

        return self._governed(cell, name, args, run)

    def _mcp(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        server, tool, args = params.get("server"), params.get("tool"), params.get("args", {})
        if not (isinstance(server, str) and server and isinstance(tool, str) and tool and isinstance(args, Mapping)):
            raise CallFailure("hx.exec.invalid", "mcp.call needs a server, a tool and an object of arguments")
        cap = self._state.settings.exec.call_result_cap_bytes

        def run(use: Mapping[str, Any]) -> tuple[Any, bool]:
            try:
                envelope = self._rt.ctx.call_mcp(server, tool, dict(use))
            except PermissionError as exc:  # Hermes: the server is not in this plugin's mcp_allowlist
                raise CallFailure("hx.policy.denied", str(exc)) from exc
            text = json.dumps(envelope, ensure_ascii=False)
            return (envelope, False) if len(text) <= cap else (text[:cap] + TRUNCATION_NOTE, True)

        return self._governed(cell, _mcp_tool_name(server, tool), args, run)

    # ------------------------------------------------------------------ shell (runs in the kernel's own sandbox)

    def _sh_begin(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        argv, command = params.get("argv"), params.get("command")
        if not (isinstance(argv, list) and argv and isinstance(command, str)):
            raise CallFailure("hx.exec.invalid", "sh.call needs an argv list")
        record = cell.begin_call("harness.sh")
        if record is None:
            raise CallFailure(
                "hx.exec.call_limit", f"this cell already made {cell.max_calls} calls (exec.max_calls_per_cell)"
            )
        started = time.monotonic()
        args = {"command": command}
        decision = self._judge("terminal", args, cell.call_id(record), "kernel_sh")
        if not decision.allowed:
            self._record(
                cell,
                record,
                "harness.sh",
                {"argv": argv},
                started,
                "blocked",
                "hx.policy.denied",
                reason=decision.reason,
            )
            cell.end_call()
            raise CallFailure("hx.policy.denied", decision.message, {"reason": decision.reason})
        with cell.lock:
            cell.open_sh[cell.call_id(record)] = (record, started, command)
        return {"call_id": cell.call_id(record)}

    def _sh_done(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        with cell.lock:
            entry = cell.open_sh.pop(str(params.get("call_id")), None)
        if entry is None:
            raise CallFailure("hx.exec.invalid", "sh.done for a command that is not running")
        record, started, command = entry
        kernel_status = params.get("status")
        status = "ok" if kernel_status == "ok" else "error"
        code = "" if status == "ok" else ("hx.exec.cancelled" if kernel_status == "cancelled" else "hx.exec.sh_failed")
        extra = {k: params[k] for k in ("exit", "timed_out") if k in params}
        self._record(cell, record, "harness.sh", {"command": command}, started, status, code, **extra)
        cell.end_call()
        return {}

    def close_cell(self, cell: Cell) -> None:
        """A cell that ended with a command still open (cancelled in an unlucky moment): write what is known."""
        with cell.lock:
            leftover, cell.open_sh = list(cell.open_sh.values()), {}
        for record, started, command in leftover:
            self._record(cell, record, "harness.sh", {"command": command}, started, "error", "hx.exec.cancelled")
            cell.end_call()

    # ------------------------------------------------------------------ the owner, and what is not available

    def _blank(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        return self._counted(
            cell, "harness.leave_blank", lambda: open_blank(self._rt, self._state, cell, params), params
        )

    def _form(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        tool = "harness.request_credential" if params.get("kind") == "credential" else "harness.request_input"
        return self._counted(cell, tool, lambda: open_form(self._rt, self._state, cell, params), params)

    def _diagnostics(self, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
        def unsupported() -> dict[str, Any]:
            raise CallFailure("hx.exec.unsupported", UNSUPPORTED_DIAGNOSTICS)

        try:
            return self._counted(cell, "harness.diagnostics", unsupported, params)
        except CallFailure as failure:
            if failure.code != "hx.exec.unsupported":
                raise
            return {"status": "unsupported", "reason": failure.message}  # an honest answer, not an error to catch

    def _counted(
        self, cell: Cell, tool: str, act: Callable[[], dict[str, Any]], args: Mapping[str, Any]
    ) -> dict[str, Any]:
        """A request that is not a Hermes tool (a blank, a form, diagnostics) still counts toward the limit and
        leaves a ``tool.called`` (a blank also writes ``blank.opened``)."""
        record = cell.begin_call(tool)
        if record is None:
            raise CallFailure(
                "hx.exec.call_limit", f"this cell already made {cell.max_calls} calls (exec.max_calls_per_cell)"
            )
        started = time.monotonic()
        try:
            result = act()
        except CallFailure as failure:
            self._record(cell, record, tool, args, started, "error", failure.code)
            raise
        else:
            extra = {k: result[k] for k in ("blank_id", "form_id") if k in result}
            self._record(cell, record, tool, args, started, "ok", **extra)
            return result
        finally:
            cell.end_call()
