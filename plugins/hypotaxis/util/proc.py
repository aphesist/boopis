"""Child processes: an allowlisted environment, their own process group, a bounded stderr tail.

Secrets never reach a child by inheritance (docs/STANDARDS.md section 5): the environment is built
from a short allowlist, not copied.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
from collections import deque
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import IO

ENV_ALLOWLIST = ("PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SYSTEMROOT", "USERPROFILE", "SHELL")
STDERR_TAIL_BYTES = 4096


def safe_env(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The allowlisted subset of this process's environment, plus ``extra``."""
    env = {k: v for k, v in os.environ.items() if k in ENV_ALLOWLIST or k.startswith("LC_")}
    env.update(extra or {})
    return env


class StderrTail:
    """Drains a child's stderr on a thread, keeping only its last few KiB for error messages."""

    def __init__(self, stream: IO[bytes]) -> None:
        self._chunks: deque[bytes] = deque()
        self._size = 0
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._drain, args=(stream,), daemon=True, name="hx-stderr")
        self._thread.start()

    def _drain(self, stream: IO[bytes]) -> None:
        read = getattr(stream, "read1", None) or stream.read
        try:
            while chunk := read(1024):
                with self._lock:
                    self._chunks.append(chunk)
                    self._size += len(chunk)
                    while self._size > STDERR_TAIL_BYTES and len(self._chunks) > 1:
                        self._size -= len(self._chunks.popleft())
        except (OSError, ValueError):
            return

    def text(self) -> str:
        with self._lock:
            return b"".join(self._chunks)[-STDERR_TAIL_BYTES:].decode("utf-8", errors="replace")


def spawn_piped(
    argv: Sequence[str], *, cwd: Path | None = None, env: Mapping[str, str] | None = None
) -> subprocess.Popen[bytes]:
    """A child with piped stdin, stdout and stderr, no shell, in its own process group."""
    kwargs: dict[str, object] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(  # noqa: S603 - argv is a vector, never a shell string
        list(argv),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        env=dict(env) if env is not None else safe_env(),
        **kwargs,  # type: ignore[arg-type]
    )


def kill_group(proc: subprocess.Popen[bytes]) -> None:
    """Terminate the child's whole process group, then the child itself, ignoring races."""
    import signal

    try:
        if sys.platform == "win32":
            proc.kill()
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass
