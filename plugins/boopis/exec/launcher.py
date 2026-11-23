"""Starting the kernel inside the OS sandbox: ``sandbox.spawn`` with a private channel.

``Launcher`` is the seam: production uses ``HxLauncher`` (the real sandbox); tests may give the kernel
a different launcher, but nothing here ever falls back to running unsandboxed (docs/STANDARDS.md
rule 5; ADR-0017: a dimension the host cannot enforce is ``hx.sandbox.unavailable``).
"""

from __future__ import annotations

import os
import shutil
import socket
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..config.model import ExecSettings
from ..errors import BoopisError, HxCallError, SandboxUnavailableError
from ..hx import HxClient
from ..hx.types import (
    ChannelRequest,
    ExitedExitOutcome,
    SandboxSpawnParams,
    SandboxSpawnResult,
    SandboxWaitResult,
    SignaledExitOutcome,
    SpawnFailedExitOutcome,
    TimedOutExitOutcome,
)
from ..util.log import get_logger
from ..util.roots import vet_runtime_roots
from . import sockdir

_log = get_logger("exec.launcher")
EXEC_DIR = Path(__file__).resolve().parent
KERNEL_MAIN = EXEC_DIR / "kernel_main.py"
CONNECT_TIMEOUT_S = 10.0
SPAWN_TIMEOUT_S = 30.0
CHANNEL_CAPABILITY = "sandbox.channel.unix_socket"
FS_CAPABILITY = "sandbox.fs"
SPAWN_FAILED = "hx.sandbox.spawn_failed"


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
    runtime_ro: Sequence[str] = ()  # the interpreter's own roots, vetted by hx (see ``interpreter_roots``)


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


def kernel_spec(workspace: str, scratch: str, settings: ExecSettings) -> KernelSpec:
    """The sandbox a kernel runs in, from the settings. One function, so the probe tests what a real kernel gets."""
    return KernelSpec(
        workspace=workspace,
        scratch=scratch,
        net=settings.network,
        memory_bytes=settings.memory_mb << 20,
        max_processes=settings.max_processes,
        lifetime_ms=settings.max_lifetime_s * 1000,
        env={
            "HX_CONCURRENCY": str(settings.max_concurrency),
            "HX_SH_OUTPUT_CAP": str(settings.sh_output_cap_bytes),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
        },
        ro=read_paths(workspace),
        runtime_ro=interpreter_roots(workspace),
    )


def read_paths(workspace: str, extra: Sequence[str] = ()) -> list[str]:
    """The plain read-only grants of a kernel besides the system's (which hx adds, ``system_read``) and the
    interpreter's (``interpreter_roots``): this package's kernel files and the workspace."""
    found: list[str] = []
    for raw in (str(EXEC_DIR), workspace, *extra):
        real = os.path.realpath(raw) if raw else ""
        if real and os.path.exists(real) and real not in found:
            found.append(real)
    return found


def interpreter_roots(workspace: str) -> list[str]:
    """The directories the kernel's interpreter lives in, to mount read-only: its base prefix, its virtual
    environment and the real directory of its executable. A Python managed under the user's home (uv, as
    Hermes's own) is outside the system paths, and without these the sandbox cannot start it.

    Resolved to real paths, and filtered to what hx accepts for ``runtime_ro``: directories that are not ``/``, not
    the home directory or a parent of it, and not inside or above the workspace (the workspace is granted already)."""
    candidates = (sys.base_prefix, sys.prefix, sys.exec_prefix, os.path.dirname(os.path.realpath(sys.executable)))
    return vet_runtime_roots(candidates, cwd=workspace)


def _describe_exit(result: SandboxWaitResult) -> ExitInfo:
    exit_ = result.exit
    if isinstance(exit_, ExitedExitOutcome):
        detail = f"the kernel exited with code {exit_.code}"
    elif isinstance(exit_, SignaledExitOutcome):
        detail = f"the kernel was killed by signal {exit_.signal}"
    elif isinstance(exit_, TimedOutExitOutcome):
        detail = "the kernel reached its maximum lifetime and was killed"
    elif isinstance(exit_, SpawnFailedExitOutcome):
        detail = f"the kernel did not start: {exit_.reason}"
    else:
        detail = "the kernel ended"
    kind = type(exit_).__name__.removesuffix("ExitOutcome").lower() or "exited"
    return ExitInfo(kind, detail, result.stderr.text)


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
        result = SandboxWaitResult.from_wire(wire)
        if not result.running:
            self._exit = _describe_exit(result)
        return self._exit

    def poll(self) -> ExitInfo | None:
        return self._wait(0)

    def kill(self) -> None:
        try:
            self._client.request("sandbox.kill", {"handle": self._handle}, timeout=10)
        except BoopisError as exc:  # already gone is fine
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
        # the socket's own short, private directory, never under TMPDIR (``sockdir``); gone once the plugin is connected
        channel_dir = sockdir.new_channel_dir()
        try:
            return self._spawn(spec, env, channel_dir)
        finally:
            shutil.rmtree(channel_dir, ignore_errors=True)

    def _spawn(self, spec: KernelSpec, env: dict[str, str], channel_dir: Path) -> Spawned:
        params = SandboxSpawnParams(
            argv=[sys.executable, "-B", "-s", str(KERNEL_MAIN)],
            cwd=spec.workspace,
            channel=ChannelRequest(
                accept_timeout_ms=int(CONNECT_TIMEOUT_S * 1000), dir=str(channel_dir), env="HX_CHANNEL_FD"
            ),
            env=env,
            net={"off": False, "loopback": "loopback", "on": True}[spec.net],
            ro=list(spec.ro),
            runtime_ro=list(spec.runtime_ro),
            system_read=True,
            rw=[spec.scratch],
            timeout_ms=spec.lifetime_ms,
            memory_bytes=spec.memory_bytes,
            max_processes=spec.max_processes,
        )
        try:
            wire = self._client.request("sandbox.spawn", params.to_wire(), timeout=SPAWN_TIMEOUT_S)
        except HxCallError as exc:
            if exc.code != SPAWN_FAILED:
                raise
            # hx refuses to start a program its grants do not cover (an interpreter outside the read paths, as with a
            # uv-managed one), before any process exists. That is the same fact as a kernel that dies before
            # ``kernel.ready`` (``KernelProcess.start``): the sandbox cannot run it, so exec is unavailable.
            raise SandboxUnavailableError(
                f"the kernel did not start inside the sandbox: {exc.message}", data={"reason": exc.message}
            ) from exc
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
