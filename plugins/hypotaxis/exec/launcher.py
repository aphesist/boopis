"""Starting the kernel inside the OS sandbox: ``sandbox.spawn`` with a private channel.

``Launcher`` is the seam: production uses ``HxLauncher`` (the real sandbox); tests may give the kernel
a different launcher, but nothing here ever falls back to running unsandboxed (docs/STANDARDS.md
rule 5; ADR-0017: a dimension the host cannot enforce is ``hx.sandbox.unavailable``).
"""

from __future__ import annotations

import json
import os
import socket
import sys
import sysconfig
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..errors import HxCallError, HypotaxisError, SandboxUnavailableError
from ..hx import HxClient
from ..hx.types import ChannelRequest, SandboxSpawnParams, SandboxSpawnResult
from ..util.log import get_logger

_log = get_logger("exec.launcher")
EXEC_DIR = Path(__file__).resolve().parent
KERNEL_MAIN = EXEC_DIR / "kernel_main.py"
_DATA = EXEC_DIR / "data" / "system_read.json"
CONNECT_TIMEOUT_S = 10.0
SPAWN_TIMEOUT_S = 30.0
CHANNEL_CAPABILITY = "sandbox.channel.unix_socket"
FS_CAPABILITY = "sandbox.fs"


@dataclass(frozen=True, slots=True)
class KernelSpec:
    """What the kernel may do. ``ro`` and ``rw`` are absolute; the workspace is always in ``ro``."""

    workspace: str
    scratch: str
    net: str  # off | loopback | on
    memory_bytes: int
    max_processes: int
    lifetime_ms: int
    env: Mapping[str, str] = field(default_factory=dict)
    ro: Sequence[str] = ()


@dataclass(frozen=True, slots=True)
class ExitInfo:
    """How a kernel ended: ``exited``/``signaled``/``timed_out``/``spawn_failed``, and what it printed."""

    kind: str
    detail: str
    stderr: str = ""

    def __str__(self) -> str:
        return f"{self.detail}" + (f"; stderr: {self.stderr.strip()[-400:]}" if self.stderr.strip() else "")


class Spawned(Protocol):
    """A running kernel process and its connected channel socket."""

    @property
    def pid(self) -> int: ...

    @property
    def enforcement(self) -> Mapping[str, Any]: ...

    @property
    def sock(self) -> socket.socket: ...

    def poll(self) -> ExitInfo | None: ...
    def kill(self) -> None: ...
    def reap(self, timeout_s: float) -> ExitInfo | None: ...


class Launcher(Protocol):
    def spawn(self, spec: KernelSpec) -> Spawned: ...


def read_paths(workspace: str, extra: Sequence[str] = ()) -> list[str]:
    """The read-only grants of a kernel: the system, the interpreter, this package's kernel files and the
    workspace. Existing paths only, resolved, without duplicates."""
    data: Mapping[str, Sequence[str]] = json.loads(_DATA.read_text(encoding="utf-8"))
    system = data.get("darwin" if sys.platform == "darwin" else "linux", ())
    interpreter = {
        sys.prefix,
        sys.base_prefix,
        sys.exec_prefix,
        sysconfig.get_path("stdlib"),
        sysconfig.get_path("purelib"),
    }
    found: list[str] = []
    for raw in (*system, *interpreter, str(EXEC_DIR), workspace, *extra):
        if not raw:
            continue
        try:
            real = os.path.realpath(raw)
        except OSError:
            continue
        if os.path.exists(real) and real not in found:
            found.append(real)
    return found


def _describe_exit(wire: Mapping[str, Any]) -> ExitInfo:
    """From the raw ``sandbox.wait`` answer. (The generated ``SandboxWaitResult.from_wire`` reads the exit's
    tag as ``op``, while hx sends ``kind``, so it cannot parse a finished child.)"""
    exit_: Mapping[str, Any] = wire.get("exit") or {}
    kind = str(exit_.get("kind", "exited"))
    if kind == "exited":
        detail = f"the kernel exited with code {exit_.get('code', '?')}"
    elif kind == "signaled":
        detail = f"the kernel was killed by signal {exit_.get('signal', '?')}"
    elif kind == "timed_out":
        detail = "the kernel reached its maximum lifetime and was killed"
    else:
        detail = f"the kernel did not start: {exit_.get('reason', '')}"
    return ExitInfo(kind, detail, str((wire.get("stderr") or {}).get("text", "")))


class _HxSpawned:
    def __init__(self, client: HxClient, handle: str, result: SandboxSpawnResult, sock: socket.socket) -> None:
        self._client, self._handle = client, handle
        self.pid = result.pid
        self.enforcement = result.enforcement.to_wire()
        self.sock = sock
        self._exit: ExitInfo | None = None

    def _wait(self, timeout_ms: int) -> ExitInfo | None:
        if self._exit is not None:
            return self._exit
        try:
            wire = self._client.request(
                "sandbox.wait", {"handle": self._handle, "timeout_ms": timeout_ms}, timeout=timeout_ms / 1000 + 10
            )
        except HxCallError as exc:
            if exc.code != "hx.sandbox.unknown_handle":
                raise
            return self._exit or ExitInfo("exited", "the kernel is gone")  # already collected
        if not wire.get("running"):
            self._exit = _describe_exit(wire)
        return self._exit

    def poll(self) -> ExitInfo | None:
        return self._wait(0)

    def kill(self) -> None:
        try:
            self._client.request("sandbox.kill", {"handle": self._handle}, timeout=10)
        except HypotaxisError as exc:  # already gone is fine
            _log.debug("sandbox.kill: %s", exc)

    def reap(self, timeout_s: float) -> ExitInfo | None:
        return self._wait(int(timeout_s * 1000))


class HxLauncher:
    """``sandbox.spawn`` through the process's warm hx client."""

    def __init__(self, client: HxClient) -> None:
        self._client = client

    def _require(self) -> None:
        if sys.platform == "win32":
            raise SandboxUnavailableError(
                "exec needs the sandbox's private channel, which does not exist on Windows yet: the kernel cannot "
                "run safely there, so exec is unavailable instead of running unsandboxed",
                data={"dimension": "channel", "reason": "windows"},
            )
        self._client.request("sandbox.capabilities", None, timeout=15)  # also performs the handshake
        missing = [c for c in (CHANNEL_CAPABILITY, FS_CAPABILITY) if c not in self._client.capabilities]
        if missing:
            raise SandboxUnavailableError(
                f"this hx cannot sandbox the kernel: missing {', '.join(missing)}", data={"missing": missing}
            )

    def spawn(self, spec: KernelSpec) -> Spawned:
        self._require()
        env = {**spec.env, "HX_SCRATCH": spec.scratch, "HOME": spec.scratch, "TMPDIR": spec.scratch}
        params = SandboxSpawnParams(
            argv=[sys.executable, "-B", "-s", str(KERNEL_MAIN)],
            cwd=spec.workspace,
            channel=ChannelRequest(accept_timeout_ms=int(CONNECT_TIMEOUT_S * 1000), env="HX_CHANNEL_FD"),
            env=env,
            net={"off": False, "loopback": "loopback", "on": True}[spec.net],
            ro=list(spec.ro),
            rw=[spec.scratch],
            timeout_ms=spec.lifetime_ms,
            memory_bytes=spec.memory_bytes,
            max_processes=spec.max_processes,
        )
        wire = self._client.request("sandbox.spawn", params.to_wire(), timeout=SPAWN_TIMEOUT_S)
        result = SandboxSpawnResult.from_wire(wire)
        if result.channel is None:
            self._client.request("sandbox.kill", {"handle": result.handle}, timeout=10)
            raise SandboxUnavailableError("sandbox.spawn returned no channel")
        try:
            sock = _connect(result.channel.path)
        except OSError as exc:
            self._client.request("sandbox.kill", {"handle": result.handle}, timeout=10)
            raise SandboxUnavailableError(f"cannot connect to the kernel's channel: {exc}") from exc
        return _HxSpawned(self._client, result.handle, result, sock)


def _connect(path: str) -> socket.socket:
    """hx binds the socket before ``sandbox.spawn`` answers, so one attempt is enough."""
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.settimeout(CONNECT_TIMEOUT_S)
        sock.connect(path)
        sock.settimeout(None)
    except OSError:
        sock.close()
        raise
    return sock
