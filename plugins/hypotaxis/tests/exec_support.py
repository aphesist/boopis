"""Test doubles for exec. The plain launcher runs the kernel as an ordinary child (no sandbox) so unit tests can
drive the whole plugin side quickly; it exists only here, and the real-sandbox tests use ``HxLauncher``."""

from __future__ import annotations

import contextlib
import json
import os
import signal
import socket
import subprocess
import sys
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from hypotaxis.exec.launcher import KERNEL_MAIN, ExitInfo, KernelSpec
from support import FakeCtx

ToolFn = Callable[..., Any]


class PlainSpawned:
    def __init__(self, proc: subprocess.Popen[bytes], sock: socket.socket) -> None:
        self._proc = proc
        self.pid = proc.pid
        self.enforcement: Mapping[str, Any] = {"platform": "test-double", "fs": {"status": "unrestricted"}}
        self.sock = sock

    def _info(self, code: int) -> ExitInfo:
        if code < 0:
            return ExitInfo("signaled", f"the kernel was killed by signal {-code}")
        return ExitInfo("exited", f"the kernel exited with code {code}")

    def poll(self) -> ExitInfo | None:
        code = self._proc.poll()
        return None if code is None else self._info(code)

    def kill(self) -> None:
        with contextlib.suppress(OSError):
            os.killpg(self._proc.pid, signal.SIGKILL)

    def reap(self, timeout_s: float) -> ExitInfo | None:
        try:
            return self._info(self._proc.wait(timeout_s))
        except subprocess.TimeoutExpired:
            return None


class PlainLauncher:
    def __init__(self) -> None:
        self.specs: list[KernelSpec] = []

    def spawn(self, spec: KernelSpec) -> PlainSpawned:
        self.specs.append(spec)
        ours, theirs = socket.socketpair()
        env = {
            "PATH": os.environ["PATH"],
            **spec.env,
            "HX_SCRATCH": spec.scratch,
            "HX_CHANNEL_FD": str(theirs.fileno()),
        }
        proc = subprocess.Popen(
            [sys.executable, "-B", "-s", str(KERNEL_MAIN)],
            env=env,
            cwd=spec.workspace,
            pass_fds=[theirs.fileno()],
            start_new_session=True,
        )
        theirs.close()
        return PlainSpawned(proc, ours)


class ExecCtx(FakeCtx):
    """A recording context that can also dispatch tools and call MCP servers."""

    def __init__(self, config: Mapping[str, Any] | None = None, cwd: str = "") -> None:
        super().__init__(config, cwd)
        self.tools_impl: dict[str, ToolFn] = {}
        self.dispatched: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        self.mcp_calls: list[tuple[str, str, dict[str, Any]]] = []
        self.mcp_allowed: set[str] = set()
        self._lock = threading.Lock()

    def dispatch_tool(self, tool_name: str, args: dict[str, Any], **kwargs: Any) -> Any:
        with self._lock:
            self.dispatched.append((tool_name, dict(args), kwargs))
        fn = self.tools_impl.get(tool_name)
        if fn is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        out = fn(**args)
        return out if isinstance(out, str) else json.dumps(out)

    def call_mcp(
        self, server: str, tool: str, arguments: dict[str, Any] | None = None, timeout: float = 30
    ) -> dict[str, Any]:
        if server not in self.mcp_allowed:
            raise PermissionError(f"not allowed to call MCP server {server!r}")
        self.mcp_calls.append((server, tool, dict(arguments or {})))
        return {"ok": True, "result": f"{server}/{tool}"}

    def events(self, name: str) -> list[dict[str, Any]]:
        return [p for _, e, p in self.emitted if e == name]


def scratch_of(home: Path, session_id: str) -> Path:
    return home / "hypotaxis" / "scratch" / session_id
