"""The ``harness`` module inside the exec kernel.

Runs in the sandboxed kernel process, never in Hermes: standard library only, no import of the plugin.
Every function that needs something outside the sandbox is a request to the plugin over the kernel's
private channel (docs/PROTOCOL.md section 5); the plugin decides, runs it and writes the ledger.

    await harness.tool("pack", items=[...])                      # any Hermes, plugin or MCP tool
    await harness.parallel([("pack", {...}), ("web_search", {...})], limit=4)
    await harness.sh(["git", "log", "-3"], timeout=20)           # a command in this same sandbox
    await harness.leave_blank("Keep the alias?", ["yes", "no"])  # returns at once with a blank id
    await harness.request_input("question", "Which branch?", schema)
    await harness.diagnostics(["src/a.py"])                      # not available yet: says so

A call that is denied raises ``ToolDenied``; every other failure of the call machinery raises
``ToolError``. A tool that ran and reported its own error (``{"error": ...}``) is a result, as it is
when the model calls it directly.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import os
import shlex
import signal
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from typing import Any

__all__ = [
    "CallLimitExceeded",
    "ToolDenied",
    "ToolError",
    "diagnostics",
    "leave_blank",
    "mcp",
    "parallel",
    "request_credential",
    "request_input",
    "sh",
    "tool",
]

Request = Callable[[str, dict[str, Any]], Awaitable[Any]]
CELL_ID: contextvars.ContextVar[str] = contextvars.ContextVar("hx_cell_id", default="")

scratch = os.environ.get("HX_SCRATCH", "")  # the one writable directory
workspace = os.getcwd()  # read-only
_request: Request | None = None
_limits: dict[str, Any] = {"concurrency": 8, "sh_output_cap": 1 << 20}


class ToolError(Exception):
    """A call could not be carried out. ``code`` is the plugin's stable ``hx.*`` code."""

    def __init__(self, message: str, code: str = "hx.internal_error", data: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = dict(data or {})


class ToolDenied(ToolError):
    """The plugin's permission policy refused the call (``hx.policy.denied``). Do not retry it by another route."""


class CallLimitExceeded(ToolError):
    """The cell made more calls than the per-cell limit allows."""


class RpcError(Exception):
    """An error answer from the plugin, before it is turned into a ``ToolError``."""

    def __init__(self, code: str, message: str, data: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = dict(data or {})


def install(request: Request, *, concurrency: int, sh_output_cap: int) -> None:
    """Called once by the kernel: where requests go, and the defaults ``parallel`` and ``sh`` use."""
    global _request
    _request = request
    _limits["concurrency"] = concurrency
    _limits["sh_output_cap"] = sh_output_cap


def _as_error(exc: RpcError) -> ToolError:
    cls = {"hx.policy.denied": ToolDenied, "hx.exec.call_limit": CallLimitExceeded}.get(exc.code, ToolError)
    return cls(str(exc), exc.code, exc.data)


async def _call(method: str, params: dict[str, Any]) -> Any:
    if _request is None:
        raise ToolError("the harness is not connected to the plugin", "hx.kernel.dead")
    try:
        return await _request(method, {**params, "cell_id": CELL_ID.get()})
    except RpcError as exc:
        raise _as_error(exc) from None


async def tool(name: str, /, **args: Any) -> Any:
    """Call a Hermes, plugin or MCP tool by name and return what it returned (parsed when it is JSON)."""
    reply = await _call("tool.call", {"name": name, "args": args})
    return reply["result"]


async def mcp(server: str, name: str, /, **args: Any) -> Any:
    """Call ``name`` on the MCP server ``server``. The plugin must be allowed that server."""
    reply = await _call("mcp.call", {"server": server, "tool": name, "args": args})
    return reply["result"]


def _coroutine(item: Any) -> Awaitable[Any]:
    if isinstance(item, Mapping):
        return tool(str(item["tool"]), **dict(item.get("args") or {}))
    if isinstance(item, Sequence) and not isinstance(item, (str, bytes)) and len(item) in (1, 2):
        return tool(str(item[0]), **dict(item[1] if len(item) == 2 else {}))
    if hasattr(item, "__await__"):
        return item  # type: ignore[no-any-return]
    raise TypeError(f"parallel() takes (name, args) pairs, {{'tool', 'args'}} dicts or awaitables, got {item!r}")


async def parallel(calls: Iterable[Any], limit: int | None = None) -> list[Any]:
    """Run the calls together, at most ``limit`` at a time, and return their results in order.

    A call that fails does not lose the others: its slot holds the ``ToolError`` it raised, so check
    ``isinstance(result, Exception)``. Cancelling the cell cancels every call.
    """
    gate = asyncio.Semaphore(max(int(limit or _limits["concurrency"]), 1))

    async def one(item: Any) -> Any:
        coro = _coroutine(item)
        async with gate:
            return await coro

    return list(await asyncio.gather(*(one(c) for c in calls), return_exceptions=True))


async def leave_blank(question: str, options: Sequence[str] = (), blocks: Sequence[str] = ()) -> dict[str, Any]:
    """Ask the owner something without stopping: returns at once with ``{blank_id, status}``.

    ``blocks`` names the steps that cannot go on until it is answered (empty: nothing waits).
    """
    reply: dict[str, Any] = await _call(
        "blank.open", {"question": question, "options": list(options), "blocks": list(blocks)}
    )
    return reply


async def request_input(
    kind: str, title: str, schema: Mapping[str, Any], *, body: str = "", wait: bool = False
) -> dict[str, Any]:
    """Open a form (docs/FORMS.md): returns at once with ``{form_id, status: "pending"}``."""
    reply: dict[str, Any] = await _call(
        "form.open", {"kind": kind, "title": title, "body": body, "schema": dict(schema), "wait": wait}
    )
    return reply


async def request_credential(
    host: str = "", provider: str = "", *, title: str = "", reason: str = "", wait: bool = False
) -> dict[str, Any]:
    """Ask the owner for a key. The secret never reaches this process: the answer is a reference."""
    what = host or provider or "a service"
    schema = {"type": "object", "properties": {"value": {"type": "string", "title": "Key", "x-secret": True}}}
    return await request_input(
        "credential", title or f"Add a key for {what}", schema, body=reason or f"Needed to call {what}.", wait=wait
    )


async def diagnostics(paths: Sequence[str]) -> dict[str, Any]:
    """Language-server diagnostics for ``paths``. Not available yet: the answer says so."""
    reply: dict[str, Any] = await _call("diagnostics", {"paths": list(paths)})
    return reply


# ---------------------------------------------------------------- shell


def _descendants(root: int) -> list[int]:
    """Every process below ``root`` by parent links (Linux ``/proc``; empty elsewhere)."""
    parent: dict[int, int] = {}
    try:
        names = os.listdir("/proc")
    except OSError:
        return []
    for name in names:
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as fh:
                stat = fh.read().decode("utf-8", "replace")
            parent[int(name)] = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            continue
    found: list[int] = []
    frontier = [root]
    while frontier:
        pid = frontier.pop()
        for child, ppid in parent.items():
            if ppid == pid and child not in found:
                found.append(child)
                frontier.append(child)
    return found


def kill_tree(pid: int) -> None:
    """SIGKILL ``pid``, its process group and every descendant, including ones that left the group."""
    doomed = [pid, *_descendants(pid)]
    with contextlib.suppress(OSError):
        os.killpg(pid, signal.SIGKILL)
    for victim in doomed:
        with contextlib.suppress(OSError):
            os.kill(victim, signal.SIGKILL)


class _Capped:
    """The first ``cap`` bytes a stream produced and how many it produced in all."""

    def __init__(self, cap: int) -> None:
        self.cap = cap
        self.kept = bytearray()
        self.total = 0

    def add(self, chunk: bytes) -> None:
        self.total += len(chunk)
        if len(self.kept) < self.cap:
            self.kept += chunk[: self.cap - len(self.kept)]

    def text(self) -> str:
        return bytes(self.kept).decode("utf-8", "replace")


async def _reap_group(pgid: int) -> None:
    """Collect the killed group's orphans. The kernel is init of its PID namespace, so processes whose parent
    died become its children and stay zombies (counting against the process limit) until someone waits."""
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            pid, _ = os.waitpid(-pgid, os.WNOHANG)
        except ChildProcessError:
            return  # none left
        if pid == 0:
            await asyncio.sleep(0.01)  # alive, not yet dead from the SIGKILL


async def _drain(stream: asyncio.StreamReader, into: _Capped) -> None:
    """Read to the end, keeping only the head. The child is never blocked by a full buffer."""
    while chunk := await stream.read(65536):
        into.add(chunk)


async def sh(
    argv: Sequence[Any], timeout: float | None = 60, *, cwd: str | None = None, input: str | None = None
) -> dict[str, Any]:
    """Run ``argv`` (a list, never a shell string) in this sandbox: the workspace is read-only, the
    scratch directory is writable, the network is as the plugin's settings say. On timeout or when the
    cell is cancelled the whole process tree dies, whatever session or group its members moved to.
    Returns ``{exit, stdout, stderr, truncated, timed_out, duration_ms}``."""
    if isinstance(argv, str) or not argv or not all(isinstance(a, str) for a in argv):
        raise ToolError("sh takes an argv list of strings, e.g. ['git', 'status']; use ['sh', '-c', text] for a shell")
    reply = await _call("sh.call", {"argv": list(argv), "command": shlex.join(argv)})
    started = time.monotonic()
    done: dict[str, Any] = {"call_id": reply["call_id"], "status": "error"}
    try:
        result = await _run(list(argv), timeout, cwd, input)
        done.update(status="ok", exit=result["exit"], timed_out=result["timed_out"])
        return result
    except asyncio.CancelledError:
        done["status"] = "cancelled"
        raise
    finally:
        done["duration_ms"] = int((time.monotonic() - started) * 1000)
        with contextlib.suppress(Exception):  # the ledger note must not hide the command's own outcome
            await _call("sh.done", done)


async def _run(argv: list[str], timeout: float | None, cwd: str | None, text: str | None) -> dict[str, Any]:
    cap = int(_limits["sh_output_cap"])
    started = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE if text is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd or None,
            start_new_session=True,
        )
    except OSError as exc:
        raise ToolError(f"cannot run {argv[0]!r}: {exc}", "hx.exec.sh_failed") from None
    assert proc.stdout is not None
    assert proc.stderr is not None
    out, err = _Capped(cap), _Capped(cap)
    readers = [asyncio.ensure_future(_drain(s, b)) for s, b in ((proc.stdout, out), (proc.stderr, err))]
    timed_out = False
    try:
        if text is not None and proc.stdin is not None:
            try:
                proc.stdin.write(text.encode())
                await proc.stdin.drain()
                proc.stdin.close()
            except (BrokenPipeError, ConnectionResetError):
                pass  # the command did not read its input
        await asyncio.wait_for(proc.wait(), timeout)
        await asyncio.wait(readers, timeout=0.5)  # a background grandchild may hold the pipes open
    except TimeoutError:
        timed_out = True
    finally:
        straggler = proc.returncode is None or not all(r.done() for r in readers)
        if straggler:
            kill_tree(proc.pid)  # on timeout, on cancel, and on a straggler: nothing outlives the call
        await proc.wait()
        if straggler:
            await _reap_group(proc.pid)
        await asyncio.wait(readers, timeout=1)
        for reader in readers:
            reader.cancel()
    return {
        "exit": proc.returncode,
        "stdout": out.text(),
        "stderr": err.text(),
        "truncated": out.total > len(out.kept) or err.total > len(err.kept),
        "timed_out": timed_out,
        "duration_ms": int((time.monotonic() - started) * 1000),
    }
