"""One kernel process, from the plugin's side: its channel, its reader thread, its cells.

Threads: the exec handler's thread calls ``run`` and blocks; one reader thread routes frames; a small pool
serves the kernel's requests (tool calls, blanks, ...) so a slow tool never stalls the channel. The kernel
runs one cell at a time, so ``run`` calls are serialized.

Three ways a cell ends without killing the kernel: it finishes, it is cancelled (``cancel``), or the
kernel's soft timeout cancels it. One way kills it: the cell never yields (``while True: pass``), the
hard deadline (timeout plus grace) passes, and the process is killed with its whole tree. Then every
variable is gone and the caller is told so (``hx.kernel.dead``).
"""

from __future__ import annotations

import contextlib
import itertools
import threading
import time
from collections.abc import Callable, Mapping
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Protocol

from ..config.model import ExecSettings
from ..errors import KernelDeadError, SandboxUnavailableError
from ..util.log import get_logger
from .cell import CallFailure, Cell
from .launcher import ExitInfo, Spawned
from .protocol import PROTOCOL, Channel, ChannelClosedError

_log = get_logger("exec.kernel")
POLL_S = 0.05
RESET_TIMEOUT_S = 10.0
REAP_S = 2.0


class RequestServer(Protocol):
    """Whatever carries out the kernel's requests (the plugin's policy, dispatch and ledger)."""

    def serve(self, cell: Cell, method: str, params: Mapping[str, Any]) -> dict[str, Any]: ...


class KernelProcess:
    def __init__(self, session_id: str, spawned: Spawned, settings: ExecSettings, server: RequestServer) -> None:
        self.session_id = session_id
        self.settings = settings
        self.dead = ""  # why the kernel is gone; empty while it lives
        self.exit_info: ExitInfo | None = None
        self.last_used = time.monotonic()
        self.on_gone: Callable[[KernelProcess], None] | None = None
        self.info: Mapping[str, Any] = {}
        self._spawned = spawned
        self._channel = Channel(spawned.sock)
        self._server = server
        self._ids = itertools.count(1)
        self._pending: dict[int, Future[Any]] = {}
        self._pending_lock = threading.Lock()
        self._cell: Cell | None = None
        self._cell_lock = threading.Lock()
        self._ready = threading.Event()
        self._stopping = False
        self._kill_reason = ""
        self._cancel_at: float | None = None
        self._pool = ThreadPoolExecutor(max_workers=max(settings.max_concurrency, 2), thread_name_prefix="hx-exec-call")
        self._reader = threading.Thread(target=self._read_loop, daemon=True, name="hx-exec-reader")

    # ------------------------------------------------------------------ lifecycle

    @property
    def busy(self) -> bool:
        return self._cell is not None

    @property
    def alive(self) -> bool:
        return not self.dead

    def start(self) -> None:
        """Wait for ``kernel.ready``. Raises ``KernelDeadError`` when it never comes."""
        self._reader.start()
        if not self._ready.wait(self.settings.start_timeout_ms / 1000):
            self._kill(f"the kernel did not say ready within {self.settings.start_timeout_ms} ms")
            self._reader.join(REAP_S * 2)
        if self.dead:
            # never reached ``kernel.ready``: the sandbox could not run the kernel, which is not a kernel that died
            raise SandboxUnavailableError(
                f"the kernel did not start inside the sandbox: {self.dead}", data={"reason": self.dead}
            )

    def stop(self, reason: str) -> None:
        """Ask the kernel to leave, then make sure it has. State is lost, on purpose."""
        if self.dead:
            return
        self._stopping = True
        self._kill_reason = reason
        with contextlib.suppress(ChannelClosedError):
            self._channel.send({"id": next(self._ids), "method": "kernel.shutdown", "params": {}})
        info = self._spawned.reap(REAP_S)
        if info is None:
            self._spawned.kill()
        self._channel.close()
        self._reader.join(REAP_S * 2)

    def _kill(self, reason: str) -> None:
        self._kill_reason = self._kill_reason or reason
        _log.warning("killing the exec kernel of session %s: %s", self.session_id, reason)
        self._spawned.kill()
        self._channel.close()

    # ------------------------------------------------------------------ frames

    def _read_loop(self) -> None:
        try:
            while (frame := self._channel.read()) is not None:
                self._route(frame)
        except Exception:  # noqa: BLE001 - a routing bug must end in a clean "dead", not a silent hang
            _log.error("exec kernel reader failed", exc_info=True)
        finally:
            self._closed()

    def _route(self, frame: dict[str, Any]) -> None:
        method = frame.get("method")
        if method is None:
            with self._pending_lock:
                future = self._pending.pop(frame.get("id"), None)  # type: ignore[arg-type]
            if future is not None and not future.done():
                error = frame.get("error")
                if error is None:
                    future.set_result(frame.get("result"))
                else:
                    data = error.get("data") or {}
                    future.set_exception(
                        CallFailure(str(data.get("code") or "hx.internal_error"), str(error.get("message", "")), data)
                    )
        elif frame.get("id") is not None:
            try:
                self._pool.submit(self._serve, frame)
            except RuntimeError:  # the pool is shut down: the kernel is going away
                return
        elif method == "cell.output":
            params = frame.get("params") or {}
            cell = self._cell
            if cell is not None and params.get("cell_id") == cell.id:
                cell.add_output(str(params.get("stream")), str(params.get("text", "")))
        elif method == "kernel.ready":
            params = frame.get("params") or {}
            if params.get("protocol") != PROTOCOL:
                self._kill(f"the kernel speaks {params.get('protocol')!r}, this plugin needs {PROTOCOL!r}")
                return
            self.info = params
            self._ready.set()

    def _serve(self, frame: dict[str, Any]) -> None:
        rid = frame["id"]
        params: Mapping[str, Any] = frame.get("params") or {}
        cell = self._cell
        try:
            if cell is None or params.get("cell_id") != cell.id:
                raise CallFailure("hx.exec.invalid", "this request does not belong to the running cell")
            result = cell.context.copy().run(self._server.serve, cell, str(frame["method"]), params)
            self._reply(rid, {"result": result})
        except CallFailure as failure:
            self._reply(
                rid,
                {"error": {"code": -32000, "message": failure.message, "data": {"code": failure.code, **failure.data}}},
            )
        except Exception as exc:  # noqa: BLE001 - the kernel gets an error, never silence
            _log.error("exec request %s failed", frame.get("method"), exc_info=True)
            error = {"code": -32603, "message": f"{type(exc).__name__}: {exc}", "data": {"code": "hx.internal_error"}}
            self._reply(rid, {"error": error})

    def _reply(self, rid: Any, body: dict[str, Any]) -> None:
        with contextlib.suppress(ChannelClosedError):  # the kernel is gone; its death is handled by the reader
            self._channel.send({"id": rid, **body})

    def _request(self, method: str, params: Mapping[str, Any]) -> Future[Any]:
        rid = next(self._ids)
        future: Future[Any] = Future()
        with self._pending_lock:
            if self.dead:
                raise KernelDeadError(self.dead)
            self._pending[rid] = future
        try:
            self._channel.send({"id": rid, "method": method, "params": dict(params)})
        except ChannelClosedError as exc:
            with self._pending_lock:
                self._pending.pop(rid, None)
            raise KernelDeadError(self.dead or f"the channel to the kernel closed: {exc}") from exc
        return future

    def _closed(self) -> None:
        """The channel ended: find out how the process ended, fail what waits, tell the registry."""
        info = self._spawned.reap(REAP_S) if self._stopping else self._reap_dead()
        self.exit_info = info
        if self._kill_reason:
            reason = self._kill_reason
        elif info is not None:
            reason = str(info)
        else:
            reason = "the channel to the kernel closed"
        with self._pending_lock:
            self.dead = reason
            doomed, self._pending = self._pending, {}
        for future in doomed.values():
            if not future.done():
                future.set_exception(KernelDeadError(reason))
        self._pool.shutdown(wait=False, cancel_futures=True)
        self._ready.set()
        _log.info("exec kernel of session %s %s: %s", self.session_id, "stopped" if self._stopping else "died", reason)
        if self.on_gone is not None:
            self.on_gone(self)

    def _reap_dead(self) -> ExitInfo | None:
        info = self._spawned.reap(REAP_S)
        if info is None:  # the channel closed but the process did not: it cannot be talked to, so it goes
            self._spawned.kill()
            info = self._spawned.reap(REAP_S)
        return info

    # ------------------------------------------------------------------ cells

    def run(self, cell: Cell, code: str, timeout_ms: int) -> dict[str, Any]:
        """Run one cell and return the kernel's answer. Raises ``KernelDeadError`` when the kernel is lost
        (including by this call's hard timeout) and ``CallFailure`` when the kernel refuses the cell."""
        with self._cell_lock:
            if self.dead:
                raise KernelDeadError(self.dead)
            self._cell, self._cancel_at = cell, None
            try:
                params = {
                    "cell_id": cell.id,
                    "code": code,
                    "timeout_ms": timeout_ms,
                    "output_cap_bytes": cell.output_cap,
                    "spill_cap_bytes": self.settings.spill_cap_bytes,
                    "result_cap_bytes": self.settings.result_cap_bytes,
                }
                future = self._request("cell.run", params)
                return self._await(future, time.monotonic() + (timeout_ms + self.settings.kill_grace_ms) / 1000)
            finally:
                self._cell = None
                self.last_used = time.monotonic()

    def _await(self, future: Future[Any], hard_deadline: float) -> dict[str, Any]:
        while True:
            try:
                result: dict[str, Any] = future.result(POLL_S)
                return result
            except TimeoutError:
                pass
            now = time.monotonic()
            if now >= hard_deadline:
                self._kill(
                    "the cell did not finish within its timeout plus the grace period, so the kernel was killed "
                    "(a cell that never yields, such as a busy loop, cannot be cancelled)"
                )
                break
            if self._cancel_at is not None and now >= self._cancel_at:
                self._kill("the kernel did not answer a cancel, so it was killed (the cell never yields)")
                break
        self._reader.join(REAP_S * 3)
        raise KernelDeadError(self.dead or self._kill_reason)

    def cancel(self) -> bool:
        """Cancel the running cell without killing the kernel: its variables survive. If the kernel does
        not react within the grace period (code that never yields) the waiting ``run`` kills it."""
        cell = self._cell
        if cell is None:
            return False
        self._cancel_at = time.monotonic() + self.settings.kill_grace_ms / 1000
        try:
            self._request("cell.cancel", {"cell_id": cell.id})
        except KernelDeadError:
            return False
        return True

    def reset(self) -> None:
        """Forget every variable; the process stays."""
        with self._cell_lock:
            self._request("kernel.reset", {}).result(RESET_TIMEOUT_S)
