"""Can this host run the exec kernel? A probe starts a real one, the way ``exec`` does, and waits for it to say ready.

The question is whether the **sandboxed kernel starts** with this interpreter, these read grants, these limits and
this private channel, which no capability list can answer for every host (a kernel limit, a policy that denies the
interpreter, a missing channel). The answer is cached briefly. It backs ``check_fn`` (a tool that cannot work is
hidden, never offered and then failed) and ``plugin.boopis.describe``'s ``kernel``.
"""

from __future__ import annotations

import shutil
import tempfile
import threading
import time
from pathlib import Path

from ..config.model import ExecSettings
from ..errors import BoopisError
from ..hx import HxClient
from ..util.log import get_logger
from .launcher import HxLauncher, kernel_spec
from .protocol import PROTOCOL, Channel

_log = get_logger("exec.probe")
READY_S = 20.0
OK_TTL_S = 300.0
FAILED_TTL_S = 60.0
_lock = threading.Lock()
_cache: tuple[float, str, str] | None = None  # (checked at, hx path, problem: empty means ok)


def probe(client: HxClient, settings: ExecSettings) -> str:
    """Start a kernel in a scratch workspace and return why not, or "" when it said ready. Never raises."""
    base = Path(tempfile.mkdtemp(prefix="hx-exec-probe-"))
    try:
        workspace, scratch = base / "work", base / "scratch"
        workspace.mkdir()
        scratch.mkdir()
        try:
            spawned = HxLauncher(client).spawn(kernel_spec(str(workspace), str(scratch), settings))
        except BoopisError as exc:
            return f"{exc.code}: {exc.message}"
        channel = Channel(spawned.sock)
        try:
            spawned.sock.settimeout(READY_S)
            frame = channel.read()
            params = (frame or {}).get("params") or {}
            if frame is not None and frame.get("method") == "kernel.ready" and params.get("protocol") == PROTOCOL:
                return ""
            info = spawned.reap(2.0)
            return f"the kernel did not say ready: {info if info is not None else 'no answer on its channel'}"
        finally:
            spawned.kill()
            channel.close()
    except Exception as exc:  # noqa: BLE001 - a probe that fails for any reason means the kernel cannot be relied on
        return f"{type(exc).__name__}: {exc}"
    finally:
        shutil.rmtree(base, ignore_errors=True)


def sandbox_problem(client: HxClient, settings: ExecSettings) -> str:
    """The cached probe result: "" when exec can run, else the reason it cannot."""
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache is not None and _cache[1] == client.path:
            age = now - _cache[0]
            if age < (OK_TTL_S if not _cache[2] else FAILED_TTL_S):
                return _cache[2]
    problem = probe(client, settings)
    if problem:
        _log.warning("exec is unavailable: %s", problem)
    with _lock:
        _cache = (time.monotonic(), client.path, problem)
    return problem


def forget() -> None:
    """Drop the cached answer (tests, and a changed hx or setting)."""
    global _cache
    with _lock:
        _cache = None
