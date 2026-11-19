"""The ``hx`` client: one warm ``hx serve`` child per Hermes process, JSON-RPC 2.0 over stdio.

Frames are newline-delimited JSON (``crates/hx-proto``). Requests may be concurrent: each gets an id
and a future, a reader thread resolves them. A call that outlives its timeout is cancelled with
``$/cancelRequest``; hx never drops a running handler, so it then answers truthfully (a result if the
work finished, ``hx.cancelled`` only if nothing changed) and that answer is returned. If it stays
silent past a grace period the call raises ``HxTimeoutError`` and the caller must treat the outcome
as unknown.

A crashed child is restarted on the next call, at most ``RESTART_LIMIT`` times per
``RESTART_WINDOW_S`` seconds; after that calls fail fast with ``HxUnavailableError``.
"""

from __future__ import annotations

import itertools
import json
import subprocess
import threading
import time
from collections import deque
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path
from typing import Any

from ..errors import HxCallError, HxTimeoutError, HxUnavailableError
from ..util.log import get_logger
from ..util.proc import StderrTail, kill_group, spawn_piped
from .types import PROTOCOL

JsonObject = dict[str, Any]
RESTART_LIMIT = 3
RESTART_WINDOW_S = 60.0
CANCEL_GRACE_S = 5.0
SHUTDOWN_GRACE_S = 5.0
DEFAULT_TIMEOUT_S = 60.0

_log = get_logger("hx")


class HxClient:
    """A lazily started, self-restarting connection to ``hx serve``. Thread-safe."""

    def __init__(self, path: str | Path, *, log_file: Path | None = None, extra_args: tuple[str, ...] = ()) -> None:
        self.path = str(path)
        self._args = ["serve", *(["--log-file", str(log_file)] if log_file else []), *extra_args]
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._ids = itertools.count(1)
        self._proc: subprocess.Popen[bytes] | None = None
        self._stderr: StderrTail | None = None
        self._pending: dict[int, Future[JsonObject]] = {}
        self._starts: deque[float] = deque()
        self._closed = False
        self.capabilities: frozenset[str] = frozenset()
        self.version: str = ""

    # ------------------------------------------------------------------ lifecycle

    def _recent_restarts(self) -> int:
        now = time.monotonic()
        while self._starts and now - self._starts[0] > RESTART_WINDOW_S:
            self._starts.popleft()
        return len(self._starts)

    def _alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def _ensure(self) -> subprocess.Popen[bytes]:
        with self._lock:
            if self._closed:
                raise HxUnavailableError("the hx client is shut down")
            if self._alive():
                assert self._proc is not None
                return self._proc
            if self._starts and self._recent_restarts() > RESTART_LIMIT:  # the first start is not a restart
                raise HxUnavailableError(
                    f"hx crashed {RESTART_LIMIT} times in {RESTART_WINDOW_S:.0f} s; not restarting",
                    data={"stderr": self.stderr_tail()},
                )
            try:
                proc = spawn_piped([self.path, *self._args])
            except OSError as exc:
                raise HxUnavailableError(f"cannot start {self.path}: {exc}") from exc
            self._starts.append(time.monotonic())
            self._proc = proc
            assert proc.stderr is not None
            self._stderr = StderrTail(proc.stderr)
            threading.Thread(target=self._reader, args=(proc,), daemon=True, name="hx-reader").start()
        self._handshake()
        return proc

    def _handshake(self) -> None:
        described = self._request("hx.describe", None, 15.0, ensure=False)
        if described.get("protocol") != PROTOCOL:
            self._kill()
            raise HxUnavailableError(f"hx speaks {described.get('protocol')!r}, this plugin needs {PROTOCOL!r}")
        self.capabilities = frozenset(described.get("capabilities", ()))
        self.version = str(described.get("version", ""))

    def _kill(self) -> None:
        with self._lock:
            proc, self._proc = self._proc, None
        if proc is not None:
            kill_group(proc)

    @property
    def running(self) -> bool:
        """Whether the child process is alive now (``available`` is also true before the first start)."""
        with self._lock:
            return self._alive()

    def stderr_tail(self) -> str:
        return self._stderr.text() if self._stderr is not None else ""

    def close(self) -> None:
        """Clean shutdown: close stdin (hx finishes accepted requests and exits 0), then escalate."""
        with self._lock:
            self._closed = True
            proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
            proc.wait(timeout=SHUTDOWN_GRACE_S)
        except (subprocess.TimeoutExpired, OSError):
            kill_group(proc)
            proc.wait(timeout=SHUTDOWN_GRACE_S)

    def available(self) -> bool:
        """Whether a call could be made now: the child is alive, or may still be (re)started."""
        with self._lock:
            if self._closed:
                return False
            if self._alive():
                return True
            return not self._starts or self._recent_restarts() <= RESTART_LIMIT

    # ------------------------------------------------------------------ frames

    def _reader(self, proc: subprocess.Popen[bytes]) -> None:
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                if not line.strip():
                    continue
                try:
                    frame: JsonObject = json.loads(line)
                except ValueError:
                    _log.error("hx sent a line that is not JSON")
                    continue
                fid = frame.get("id")
                with self._lock:
                    fut = self._pending.pop(fid, None) if isinstance(fid, int) else None
                if fut is not None and not fut.done():
                    fut.set_result(frame)
        except (OSError, ValueError):
            pass
        finally:
            self._on_exit(proc)

    def _on_exit(self, proc: subprocess.Popen[bytes]) -> None:
        proc.wait()
        with self._lock:
            if self._proc is proc:
                self._proc = None
            doomed, self._pending = self._pending, {}
        exc = HxUnavailableError(f"hx exited (code {proc.returncode})", data={"stderr": self.stderr_tail()})
        for fut in doomed.values():
            if not fut.done():
                fut.set_exception(exc)

    def _send(self, proc: subprocess.Popen[bytes], frame: JsonObject) -> None:
        data = (json.dumps(frame, separators=(",", ":")) + "\n").encode()
        assert proc.stdin is not None
        try:
            with self._write_lock:
                proc.stdin.write(data)
                proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as exc:
            raise HxUnavailableError(f"cannot write to hx: {exc}", data={"stderr": self.stderr_tail()}) from exc

    # ------------------------------------------------------------------ calls

    def request(self, method: str, params: JsonObject | None = None, timeout: float = DEFAULT_TIMEOUT_S) -> Any:
        """Call ``method`` and return its ``result``. Raises ``HxCallError`` for an error answered by
        hx, ``HxTimeoutError`` when it did not answer in time, ``HxUnavailableError`` when hx is gone."""
        return self._request(method, params, timeout, ensure=True)

    def _request(self, method: str, params: JsonObject | None, timeout: float, *, ensure: bool) -> Any:
        proc = self._ensure() if ensure else self._proc
        if proc is None:
            raise HxUnavailableError("hx is not running")
        rid = next(self._ids)
        fut: Future[JsonObject] = Future()
        with self._lock:
            self._pending[rid] = fut
        frame: JsonObject = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            frame["params"] = params
        try:
            self._send(proc, frame)
            reply = fut.result(timeout)
        except FutureTimeout:
            reply = self._cancel(rid, fut, method, proc)
        except HxUnavailableError:
            with self._lock:
                self._pending.pop(rid, None)
            raise
        if "error" in reply:
            err: JsonObject = reply["error"]
            data = err.get("data") or {}
            raise HxCallError(str(data.get("code") or f"rpc.{err.get('code')}"), str(err.get("message", "")), data=data)
        result: Any = reply.get("result")
        return result

    def _cancel(self, rid: int, fut: Future[JsonObject], method: str, proc: subprocess.Popen[bytes]) -> JsonObject:
        """After a timeout: ask hx to stop, and return its truthful answer if it gives one."""
        try:
            self._send(proc, {"jsonrpc": "2.0", "method": "$/cancelRequest", "params": {"id": rid}})
            return fut.result(CANCEL_GRACE_S)
        except (FutureTimeout, HxUnavailableError):
            with self._lock:
                self._pending.pop(rid, None)
            raise HxTimeoutError(
                f"{method} did not answer; its outcome is unknown", data={"method": method, "cancelled": False}
            ) from None
