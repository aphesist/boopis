"""The exec kernel: a persistent asyncio Python process that runs inside the ``hx`` OS sandbox.

Started by ``hx sandbox.spawn`` as ``python kernel_main.py``. Standard library only; it never imports the
plugin or Hermes. It talks to the plugin **only** over its private channel (a socket the sandbox
inherited as the descriptor named by ``HX_CHANNEL_FD``), never on stdout: newline-delimited JSON-RPC 2.0,
protocol ``hx-kernel-v1`` (docs/PROTOCOL.md section 5).

Plugin to kernel: ``cell.run``, ``cell.cancel``, ``kernel.reset``, ``kernel.shutdown``.
Kernel to plugin: ``kernel.ready`` and ``cell.output`` notifications, and the requests the ``harness``
module makes (``tool.call``, ``mcp.call``, ``sh.call``, ``sh.done``, ``blank.open``, ``form.open``,
``diagnostics``).

One cell runs at a time. Variables persist across cells. A cancel or a soft timeout cancels the cell's
task and keeps the kernel; only the plugin's hard timeout (code that never yields) kills it.
"""

from __future__ import annotations

import ast
import asyncio
import builtins
import inspect
import io
import itertools
import json
import linecache
import os
import socket
import sys
import threading
import time
import traceback
import types
from collections.abc import AsyncIterator
from typing import Any, TextIO

import kernel_harness as harness

PROTOCOL = "hx-kernel-v1"
FLAGS = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
FRAME_LIMIT = 1 << 26  # the longest line a peer may send: 64 MiB
CHUNK = 16384
TRACEBACK_CAP = 4000
FLUSH_INTERVAL_S = 0.05


# ---------------------------------------------------------------- the channel


class Rpc:
    """JSON-RPC 2.0 over one asyncio stream. Everything here runs on the kernel's event loop."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future[Any]] = {}

    async def _send(self, frame: dict[str, Any]) -> None:
        self._writer.write((json.dumps(frame, separators=(",", ":")) + "\n").encode("utf-8"))
        await self._writer.drain()

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def request(self, method: str, params: dict[str, Any]) -> Any:
        rid = next(self._ids)
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[rid] = future
        try:
            await self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
            return await future
        finally:
            self._pending.pop(rid, None)

    async def reply(self, rid: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> None:
        frame: dict[str, Any] = {"jsonrpc": "2.0", "id": rid}
        if error is not None:
            frame["error"] = error
        else:
            frame["result"] = result
        await self._send(frame)

    def resolve(self, frame: dict[str, Any]) -> None:
        future = self._pending.get(frame.get("id"))  # type: ignore[arg-type]
        if future is None or future.done():
            return  # the cell that asked was cancelled; nobody wants the answer
        error = frame.get("error")
        if error is None:
            future.set_result(frame.get("result"))
            return
        data = error.get("data") or {}
        code = str(data.get("code") or "hx.internal_error")
        future.set_exception(harness.RpcError(code, str(error.get("message", "")), data))

    async def frames(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            try:
                line = await self._reader.readline()
            except (ValueError, OSError):
                return
            if not line:
                return
            try:
                frame = json.loads(line)
            except ValueError:
                continue
            if isinstance(frame, dict):
                yield frame

    def fail_all(self, message: str) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(harness.RpcError("hx.kernel.dead", message))


# ---------------------------------------------------------------- output capture and spill


class _Lane:
    """One stream of one cell: the head kept in memory and streamed to the plugin, the rest spilled."""

    def __init__(self) -> None:
        self.total = 0
        self.head: list[str] = []
        self.head_bytes = 0
        self.pending: list[str] = []
        self.spill: TextIO | None = None
        self.spill_path = ""
        self.spilled = 0
        self.spill_cut = False


class Output:
    """Captures a cell's stdout and stderr. The first ``cap`` bytes of each go to the plugin as
    ``cell.output``; once a stream passes the cap, all of it (up to ``spill_cap``) is also written to a file
    in the scratch directory. Writes may come from any thread."""

    def __init__(self, cell_id: str, cap: int, spill_cap: int, spill_dir: str) -> None:
        self.cell_id, self.cap, self.spill_cap, self.spill_dir = cell_id, cap, spill_cap, spill_dir
        self.lanes = {"stdout": _Lane(), "stderr": _Lane()}
        self._lock = threading.Lock()

    def add(self, name: str, text: str) -> None:
        if not text:
            return
        with self._lock:
            lane = self.lanes[name]
            data = text.encode("utf-8", "replace")
            kept = data[: max(self.cap - lane.head_bytes, 0)]
            if kept:
                shown = kept.decode("utf-8", "ignore")
                lane.head.append(shown)
                lane.pending.append(shown)
                lane.head_bytes += len(kept)
            lane.total += len(data)
            if len(data) > len(kept):
                self._spill(name, lane, data[len(kept) :])

    def _spill(self, name: str, lane: _Lane, rest: bytes) -> None:
        if lane.spill is None and not lane.spill_cut:
            try:
                os.makedirs(self.spill_dir, mode=0o700, exist_ok=True)
                lane.spill_path = os.path.join(self.spill_dir, f"{self.cell_id}.{name}.txt")
                lane.spill = open(lane.spill_path, "w", encoding="utf-8", errors="replace")  # noqa: SIM115
                head = "".join(lane.head)
                lane.spill.write(head)
                lane.spilled = len(head.encode("utf-8"))
            except OSError:
                lane.spill, lane.spill_path, lane.spill_cut = None, "", True  # no scratch: the cap is all there is
                return
        if lane.spill is None:
            return
        room = max(self.spill_cap - lane.spilled, 0)
        if len(rest) > room:
            lane.spill_cut = True
        lane.spill.write(rest[:room].decode("utf-8", "replace"))
        lane.spilled += min(len(rest), room)

    async def flush(self, rpc: Rpc) -> None:
        """Stream what has been captured since the last flush."""
        for name, lane in self.lanes.items():
            with self._lock:
                text, lane.pending = "".join(lane.pending), []
            for i in range(0, len(text), CHUNK):
                await rpc.notify("cell.output", {"cell_id": self.cell_id, "stream": name, "text": text[i : i + CHUNK]})

    def close(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        with self._lock:
            for name, lane in self.lanes.items():
                if lane.spill is not None:
                    lane.spill.close()
                out[name] = {
                    "bytes": lane.total,
                    "shown": lane.head_bytes,
                    "spill": lane.spill_path or None,
                    "spill_truncated": lane.spill_cut,
                }
        return out


class _Stdio(io.TextIOBase):
    """``sys.stdout`` / ``sys.stderr`` in the kernel: into the running cell's capture, never to fd 1 or 2.
    Output written while no cell runs (a leftover thread) is dropped."""

    def __init__(self, kernel: Kernel, name: str) -> None:
        self._kernel, self._name = kernel, name

    def write(self, text: str) -> int:
        sink = self._kernel.sink
        if sink is not None:
            sink.add(self._name, text)
        return len(text)

    def writable(self) -> bool:
        return True

    encoding = "utf-8"


# ---------------------------------------------------------------- cells


class CellExit(Exception):
    """The cell called ``exit()`` or raised ``KeyboardInterrupt``: reported as an error, the kernel stays up."""


def compile_cell(code: str, filename: str) -> tuple[types.CodeType, types.CodeType | None]:
    """The cell's statements, and its last expression apart (its value is the cell's result). Both accept
    top-level ``await``."""
    tree = ast.parse(code, filename, "exec")
    last: ast.Expression | None = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)  # type: ignore[attr-defined]
    body = compile(tree, filename, "exec", flags=FLAGS)
    return body, (compile(last, filename, "eval", flags=FLAGS) if last is not None else None)


async def run_code(code: types.CodeType, namespace: dict[str, Any]) -> Any:
    """Run a code object compiled with top-level await: a coroutine when it awaits, a value when not."""
    result = types.FunctionType(code, namespace)()
    if code.co_flags & inspect.CO_COROUTINE:
        result = await result
    return result


def format_error(exc: BaseException) -> dict[str, str]:
    """The cell's own frames only: the kernel's and the harness's are noise to the model."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename.startswith("<cell")]
    text = "Traceback (most recent call last):\n" + "".join(traceback.format_list(frames)) if frames else ""
    text += "".join(traceback.format_exception_only(type(exc), exc))
    if len(text) > TRACEBACK_CAP:
        text = "...\n" + text[-TRACEBACK_CAP:]
    return {"type": type(exc).__name__, "message": str(exc), "traceback": text}


class Kernel:
    def __init__(self, rpc: Rpc) -> None:
        self.rpc = rpc
        self.sink: Output | None = None
        self.namespace = self._fresh()
        self.count = 0
        self.task: asyncio.Task[dict[str, Any]] | None = None
        self.timed_out = False
        self.stop = asyncio.Event()

    @staticmethod
    def _fresh() -> dict[str, Any]:
        return {"__name__": "__main__", "__builtins__": builtins, "harness": harness}

    async def run_cell(self, params: dict[str, Any]) -> dict[str, Any]:
        if self.task is not None:
            raise harness.RpcError("hx.exec.busy", "a cell is already running in this kernel")
        loop = asyncio.get_running_loop()
        cell_id = str(params["cell_id"])
        self.count += 1
        sink = Output(
            cell_id,
            int(params.get("output_cap_bytes", 30000)),
            int(params.get("spill_cap_bytes", 16 << 20)),
            os.path.join(harness.scratch or os.getcwd(), "spill"),
        )
        self.sink, self.timed_out = sink, False
        harness.CELL_ID.set(cell_id)  # copied into the cell's task and every task it starts
        started = time.monotonic()
        before = asyncio.all_tasks()
        cap = int(params.get("result_cap_bytes", 10000))
        task = self.task = loop.create_task(self._execute(str(params["code"]), f"<cell {self.count}>", cap))
        timer = (
            loop.call_later(int(params["timeout_ms"]) / 1000, self._soft_timeout, task)
            if params.get("timeout_ms")
            else None
        )
        flusher = loop.create_task(self._flush_loop(sink))
        try:
            await asyncio.wait({task})
        finally:
            if timer is not None:
                timer.cancel()
            flusher.cancel()
        reply = self._outcome(task)
        if reply["status"] in ("cancelled", "timeout"):
            await self._cancel_strays(before, task)
        self.task, self.sink = None, None
        await sink.flush(self.rpc)
        duration = int((time.monotonic() - started) * 1000)
        reply.update(cell_id=cell_id, execution_count=self.count, output=sink.close(), duration_ms=duration)
        return reply

    async def _execute(self, code: str, filename: str, result_cap: int) -> dict[str, Any]:
        linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
        try:
            body, tail = compile_cell(code, filename)
            await run_code(body, self.namespace)
            value = await run_code(tail, self.namespace) if tail is not None else None
            text = repr(value) if value is not None else ""
        except (SystemExit, KeyboardInterrupt) as exc:  # in a task these would stop the whole event loop
            raise CellExit(f"the cell called {type(exc).__name__}({exc}); the kernel stays up") from None
        if value is None:
            return {}
        return {"result_repr": text[:result_cap], "result_truncated": len(text) > result_cap}

    def _outcome(self, task: asyncio.Task[dict[str, Any]]) -> dict[str, Any]:
        if task.cancelled():
            return {"status": "timeout" if self.timed_out else "cancelled"}
        exc = task.exception()
        if exc is not None:
            return {"status": "error", "error": format_error(exc)}
        return {"status": "ok", **task.result()}

    @staticmethod
    async def _cancel_strays(before: set[asyncio.Task[Any]], cell: asyncio.Task[Any]) -> None:
        """Tasks the cell started and left running go with it: a cancelled cell leaves nothing behind."""
        strays = [t for t in asyncio.all_tasks() - before - {cell, asyncio.current_task()} if not t.done()]
        for stray in strays:
            stray.cancel()
        if strays:
            await asyncio.wait(strays, timeout=2)

    def _soft_timeout(self, task: asyncio.Task[Any]) -> None:
        self.timed_out = True
        task.cancel()

    async def _flush_loop(self, sink: Output) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            await sink.flush(self.rpc)

    def cancel(self) -> bool:
        if self.task is None or self.task.done():
            return False
        self.task.cancel()
        return True

    # ---------------------------------------------------------------- the plugin's requests

    async def handle(self, frame: dict[str, Any]) -> None:
        method, rid = frame.get("method"), frame.get("id")
        params: dict[str, Any] = frame.get("params") or {}
        try:
            result = await self._dispatch(str(method), params)
        except harness.RpcError as exc:
            error = {"code": -32000, "message": str(exc), "data": {"code": exc.code}}
        except Exception as exc:  # noqa: BLE001 - the kernel must outlive any one request
            error = {"code": -32603, "message": f"{type(exc).__name__}: {exc}", "data": {"code": "hx.internal_error"}}
        else:
            if rid is not None:
                await self.rpc.reply(rid, result=result)
            return
        if rid is not None:
            await self.rpc.reply(rid, error=error)

    async def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if method == "cell.run":
            return await self.run_cell(params)
        if method == "cell.cancel":
            return {"cancelled": self.cancel()}
        if method == "kernel.reset":
            if self.task is not None:
                raise harness.RpcError("hx.exec.busy", "a cell is running; cancel it before resetting")
            self.namespace = self._fresh()
            return {}
        if method == "kernel.shutdown":
            self.stop.set()
            return {}
        raise harness.RpcError("hx.method_not_found", f"unknown method {method!r}")

    async def serve(self) -> None:
        sys.stdout, sys.stderr = _Stdio(self, "stdout"), _Stdio(self, "stderr")  # type: ignore[assignment]
        sys.stdin = io.StringIO("")
        sys.modules["harness"] = harness
        ready = {
            "protocol": PROTOCOL,
            "pid": os.getpid(),
            "python": sys.version.split()[0],
            "cwd": os.getcwd(),
            "scratch": harness.scratch,
        }
        await self.rpc.notify("kernel.ready", ready)
        background: set[asyncio.Task[None]] = set()

        async def pump() -> None:
            async for frame in self.rpc.frames():
                if "method" in frame:
                    task = asyncio.get_running_loop().create_task(self.handle(frame))
                    background.add(task)
                    task.add_done_callback(background.discard)
                else:
                    self.rpc.resolve(frame)
            self.stop.set()  # the plugin closed the channel: nobody is left to serve

        reader = asyncio.get_running_loop().create_task(pump())
        await self.stop.wait()
        self.cancel()
        self.rpc.fail_all("the channel to the plugin closed")
        reader.cancel()


async def amain(sock: socket.socket) -> None:
    reader, writer = await asyncio.open_connection(sock=sock, limit=FRAME_LIMIT)
    rpc = Rpc(reader, writer)
    harness.install(
        rpc.request,
        concurrency=int(os.environ.get("HX_CONCURRENCY", "8")),
        sh_output_cap=int(os.environ.get("HX_SH_OUTPUT_CAP", str(1 << 20))),
    )
    await Kernel(rpc).serve()


def main() -> None:
    sock = socket.socket(fileno=int(os.environ["HX_CHANNEL_FD"]))
    sock.setblocking(False)
    asyncio.run(amain(sock))
    os._exit(0)  # threads a cell left behind must not keep a finished kernel alive


if __name__ == "__main__":
    main()
