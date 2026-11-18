"""Child processes: an allowlisted environment, their own process group, a bounded stderr tail.

Secrets never reach a child by inheritance (docs/STANDARDS.md section 5): the environment is built
from a short allowlist, not copied.
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import sys
import threading
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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


# ---------------------------------------------------------------------------------------------
# One-shot children with captured output (hook commands, `!` injections).
#
# `run_captured` takes an argument vector and never a shell. `run_shell` takes a shell string and is
# the single exception to the no-shell-string rule (docs/DECISIONS.md ADR-0013): a Claude Code hook
# command *is* a shell string. Its callers must have established trust first; this module cannot.
# ---------------------------------------------------------------------------------------------

DEFAULT_OUTPUT_CAP = 1 << 20  # per stream; the rest is read and discarded so the child never blocks


@dataclass(frozen=True, slots=True)
class ProcResult:
    """How a one-shot child ended. ``returncode`` is None when it was killed or never started."""

    returncode: int | None
    stdout: str
    stderr: str
    timed_out: bool = False
    truncated: bool = False
    error: str = ""  # why the child could not start


class _Capture:
    """Drains one stream on a thread, keeping at most ``cap`` bytes and noting any overflow."""

    def __init__(self, stream: IO[bytes], cap: int) -> None:
        self._stream, self._cap = stream, cap
        self.data = bytearray()
        self.truncated = False
        self._thread = threading.Thread(target=self._drain, daemon=True, name="hx-capture")
        self._thread.start()

    def _drain(self) -> None:
        read = getattr(self._stream, "read1", None) or self._stream.read
        try:
            while chunk := read(65536):
                room = self._cap - len(self.data)
                if room > 0:
                    self.data += chunk[:room]
                if len(chunk) > room:
                    self.truncated = True
        except (OSError, ValueError):
            return

    def finish(self, timeout: float) -> str:
        self._thread.join(timeout)
        return bytes(self.data).decode("utf-8", errors="replace")


def _feed(stream: IO[bytes], data: bytes) -> None:
    try:
        stream.write(data)
    except (OSError, ValueError):
        pass  # the child may exit without reading its input
    finally:
        with contextlib.suppress(OSError, ValueError):
            stream.close()


def _run(
    command: str | Sequence[str],
    *,
    shell: bool,
    stdin: bytes,
    cwd: Path | None,
    env: Mapping[str, str] | None,
    timeout_s: float,
    output_cap: int,
) -> ProcResult:
    kwargs: dict[str, object] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen(  # noqa: S603 - a vector, or the ADR-0013 shell string from run_shell
            command if shell else list(command),
            shell=shell,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=cwd,
            env=dict(env) if env is not None else safe_env(),
            **kwargs,  # type: ignore[arg-type]
        )
    except (OSError, ValueError) as exc:
        return ProcResult(None, "", "", error=f"{type(exc).__name__}: {exc}")
    assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None
    feeder = threading.Thread(target=_feed, args=(proc.stdin, stdin), daemon=True, name="hx-feed")
    feeder.start()
    out, err = _Capture(proc.stdout, output_cap), _Capture(proc.stderr, output_cap)
    timed_out = False
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_group(proc)
        proc.wait()
    else:
        kill_group(proc)  # a grandchild that outlived the shell must not keep our pipes open
    feeder.join(1.0)
    stdout, stderr = out.finish(2.0), err.finish(2.0)
    return ProcResult(None if timed_out else proc.returncode, stdout, stderr, timed_out, out.truncated or err.truncated)


def run_captured(
    argv: Sequence[str],
    *,
    stdin: bytes = b"",
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    timeout_s: float,
    output_cap: int = DEFAULT_OUTPUT_CAP,
) -> ProcResult:
    """Run ``argv`` (no shell) to completion, killing its process group on timeout."""
    return _run(argv, shell=False, stdin=stdin, cwd=cwd, env=env, timeout_s=timeout_s, output_cap=output_cap)


def run_shell(
    command: str,
    *,
    stdin: bytes = b"",
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
    timeout_s: float,
    output_cap: int = DEFAULT_OUTPUT_CAP,
) -> ProcResult:
    """Run a shell string through the platform shell (``sh -c``, ``cmd /c``). ADR-0013: trusted input only."""
    return _run(  # noqa: S604 - the one shell-string exception, ADR-0013
        command, shell=True, stdin=stdin, cwd=cwd, env=env, timeout_s=timeout_s, output_cap=output_cap
    )
