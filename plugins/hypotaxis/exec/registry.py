"""The process's kernels: one per session, a least-recently-used limit, an idle reaper.

A kernel that is evicted, reaped, killed or that dies loses its variables; the registry remembers why, and
the next ``exec`` of that session says so in its answer (``kernel.restarted``) so the model does not trust
variables that are gone.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path

from ..config.model import ExecSettings
from ..errors import HypotaxisError
from ..hx import HxClient
from ..ledger import ledger_filename
from ..session import Caller, Runtime
from ..util.log import get_logger
from .calls import CellServices
from .cell import CallFailure
from .kernel import KernelProcess
from .launcher import HxLauncher, Launcher, kernel_spec

_log = get_logger("exec.registry")
REAP_INTERVAL_S = 30.0

LauncherFor = Callable[[Runtime], Launcher | None]


def scratch_dir(rt: Runtime, session_id: str) -> Path:
    """``<profile home>/hypotaxis/scratch/<session>/``: the one place a kernel may write."""
    stem = ledger_filename(session_id).removesuffix(".jsonl")
    return rt.home / "hypotaxis" / "scratch" / stem


def hx_launcher(rt: Runtime) -> Launcher | None:
    client: HxClient | None = rt.hx_client()
    return HxLauncher(client) if client is not None else None


class KernelRegistry:
    def __init__(self, launcher_for: LauncherFor = hx_launcher) -> None:
        self._launcher_for = launcher_for
        self._lock = threading.RLock()
        self._kernels: OrderedDict[str, KernelProcess] = OrderedDict()
        self._lost: dict[str, str] = {}
        self._owner: dict[str, str] = {}  # kernel's session id -> the root session it works for
        self._reaper: threading.Thread | None = None
        self._stop = threading.Event()

    # ------------------------------------------------------------------ acquiring

    def acquire(self, rt: Runtime, caller: Caller, session_id: str) -> tuple[KernelProcess, str]:
        """The live kernel of the Hermes session ``session_id`` (a worker has its own, working for its root's
        ledger and policy), started if needed, and a note when its predecessor was lost."""
        state = caller.state
        settings = state.settings.exec
        with self._lock:
            found = self._kernels.get(session_id)
            if found is not None and found.alive:
                self._kernels.move_to_end(session_id)
                return found, ""
            self._kernels.pop(session_id, None)
            victims = self._make_room(settings)
            try:
                kernel = self._start(rt, caller, session_id, settings)
            except HypotaxisError:
                self._stop_all(victims)  # they were already given up; do not leave them running
                raise
            self._kernels[session_id] = kernel
            self._owner[session_id] = state.session_id
            self._ensure_reaper(settings)
            note = self._lost.pop(session_id, "")
        self._stop_all(victims)  # outside the lock: a stopping kernel's reader thread takes it
        return kernel, note

    def _start(self, rt: Runtime, caller: Caller, session_id: str, settings: ExecSettings) -> KernelProcess:
        state = caller.state
        launcher = self._launcher_for(rt)
        if launcher is None:
            raise HypotaxisError("the hx binary was not found, so exec has no sandbox to run in")
        scratch = scratch_dir(rt, session_id)
        scratch.mkdir(parents=True, exist_ok=True)
        os.chmod(scratch, 0o700)
        spec = kernel_spec(state.cwd, str(scratch), settings)
        spawned = launcher.spawn(spec)
        kernel = KernelProcess(session_id, spawned, settings, CellServices(rt, caller, session_id))
        kernel.on_gone = self._gone
        try:
            kernel.start()
        except HypotaxisError:
            self._lost.pop(session_id, None)
            raise
        _log.info("exec kernel started for session %s (pid %s)", session_id, spawned.pid)
        return kernel

    def _make_room(self, settings: ExecSettings) -> list[tuple[KernelProcess, str]]:
        victims: list[tuple[KernelProcess, str]] = []
        while len(self._kernels) >= settings.max_kernels:
            idle = next((sid for sid, k in self._kernels.items() if not k.busy), None)
            if idle is None:
                self._stop_all(victims)
                raise CallFailure(
                    "hx.exec.busy", f"{len(self._kernels)} kernels are running cells; wait for one to finish"
                )
            victims.append(
                self._evict(idle, "it was the least recently used kernel and another session needed the room")
            )
        return victims

    @staticmethod
    def _stop_all(victims: list[tuple[KernelProcess, str]]) -> None:
        for kernel, why in victims:
            kernel.stop(why)

    # ------------------------------------------------------------------ leaving

    def _evict(self, session_id: str, why: str) -> tuple[KernelProcess, str]:
        """Take the kernel out of the table (call under the lock); the caller stops it after releasing it."""
        kernel = self._kernels.pop(session_id)
        self._lost[session_id] = f"the previous kernel was stopped: {why}"
        return kernel, why

    def _gone(self, kernel: KernelProcess) -> None:
        """A kernel ended by itself or by a kill: forget it, remember why."""
        with self._lock:
            if self._kernels.get(kernel.session_id) is kernel:
                del self._kernels[kernel.session_id]
                self._lost[kernel.session_id] = f"the previous kernel was lost: {kernel.dead}"

    def stop_session(self, session_id: str, why: str) -> None:
        """Stop the kernel of ``session_id`` and those of the workers that worked for it."""
        with self._lock:
            keys = [k for k in self._kernels if k == session_id or self._owner.get(k) == session_id]
            kernels = [self._kernels.pop(k) for k in keys]
            for key in keys:
                self._lost.pop(key, None)
                self._owner.pop(key, None)
        for kernel in kernels:
            kernel.stop(why)

    def interrupt(self, key: str) -> bool:
        """Cancel the running cell of ``key``'s kernel; the kernel and its variables stay."""
        with self._lock:
            kernel = self._kernels.get(key)
        return kernel.cancel() if kernel is not None else False

    def abandon(self, session_id: str) -> bool:
        return self.interrupt(session_id)

    def shutdown(self) -> None:
        self._stop.set()
        with self._lock:
            kernels, self._kernels = list(self._kernels.values()), OrderedDict()
        for kernel in kernels:
            kernel.stop("the plugin is unloading")

    # ------------------------------------------------------------------ idle reaping

    def _ensure_reaper(self, settings: ExecSettings) -> None:
        if self._reaper is None or not self._reaper.is_alive():
            self._stop.clear()
            self._reaper = threading.Thread(
                target=self._reap_loop, args=(settings,), daemon=True, name="hx-exec-reaper"
            )
            self._reaper.start()

    def _reap_loop(self, settings: ExecSettings) -> None:
        while not self._stop.wait(min(REAP_INTERVAL_S, settings.idle_timeout_s / 2)):
            self.reap_idle(settings.idle_timeout_s)

    def reap_idle(self, idle_timeout_s: float) -> list[str]:
        """Stop every kernel idle for longer than ``idle_timeout_s``. Returns the session ids stopped."""
        now = time.monotonic()
        with self._lock:
            stale = [sid for sid, k in self._kernels.items() if not k.busy and now - k.last_used > idle_timeout_s]
            victims = [self._evict(sid, f"it was idle for more than {idle_timeout_s:.0f} s") for sid in stale]
        self._stop_all(victims)
        return stale


_registry: KernelRegistry | None = None
_registry_lock = threading.Lock()


def registry() -> KernelRegistry:
    global _registry
    with _registry_lock:
        if _registry is None:
            _registry = KernelRegistry()
        return _registry


def install(replacement: KernelRegistry | None) -> None:
    """Replace the process's registry (tests give it a launcher of their own)."""
    global _registry
    with _registry_lock:
        _registry = replacement
