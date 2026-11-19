"""The gate's test command, run through ``hx sandbox.run`` (and, only by the user's explicit choice, without it).

The command is code the agent may have just written (a ``conftest.py``, a ``package.json`` script, a ``Makefile``), so it
runs like exec's kernel: the **copy** of the workspace is the only writable tree (with a scratch directory for ``HOME``
and ``TMPDIR``), the real workspace is read-only, the network is off, and the environment is the allowlist of
``util.proc.safe_env`` with ``HOME`` and ``TMPDIR`` moved into the scratch: provider keys, tokens and the plugin's own
secret source never reach it. The toolchain the command needs is mounted read-only (``toolchain``).

A sandbox that cannot run it is ``SandboxUnavailableError``: the gate blocks (fail closed). ``allow_unsandboxed`` is the
one way past that, and it is logged on every use.
"""

from __future__ import annotations

import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .. import _vendor
from ..errors import HxCallError, HypotaxisError, SandboxUnavailableError
from ..hx import HxClient
from ..hx.types import (
    ExitedExitOutcome,
    RunResult,
    SandboxRunParams,
    SignaledExitOutcome,
    SpawnFailedExitOutcome,
    TimedOutExitOutcome,
)
from ..util.log import get_logger
from ..util.proc import ProcResult, run_captured, safe_env
from .toolchain import toolchain_for

_log = get_logger("ship.sandbox")
cp_sandbox: Any = _vendor.load("sandbox")

SANDBOXED = "sandboxed"
UNSANDBOXED = "unsandboxed:user_choice"
NOT_RUN = "none"  # the gate stopped before the test command, or none is configured
REQUIRED_CAPABILITIES = ("sandbox.run", "sandbox.fs", "sandbox.net.off")
UNAVAILABLE_HINT = (
    "The gate runs the project's tests inside the hx sandbox and will not run them outside it. To run the gate "
    "unsandboxed anyway, set gate.allow_unsandboxed to true in the hypotaxis plugin settings; that is your choice "
    "alone, it is logged on every run, and the tests then run as you with your files."
)
KILL_GRACE_MS = 2000
SPAWN_SLACK_S = 30.0


@dataclass(frozen=True, slots=True)
class CommandRun:
    """What the command did, and how it was confined. ``result`` is contraprova's ``RunResult``."""

    result: Any
    enforcement: str
    detail: Mapping[str, str] = field(default_factory=dict)  # hx's per-dimension status, when sandboxed


def sandbox_problem(client: HxClient | None) -> str:
    """Why the sandbox cannot run the gate on this machine, or ``""`` when it can. Asks hx (which also starts it)."""
    if client is None:
        return "the hx binary was not found"
    try:
        client.request("sandbox.capabilities", None, timeout=15)  # also performs the handshake
    except HypotaxisError as exc:
        return f"hx could not report its sandbox ({exc.code})"
    missing = [c for c in REQUIRED_CAPABILITIES if c not in client.capabilities]
    if missing:
        return f"this hx cannot enforce {', '.join(missing)} on this machine"
    return ""


def gate_env(scratch: str, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """The child's whole environment: the plugin's allowlist, ``HOME`` and ``TMPDIR`` in the scratch."""
    env = safe_env({"HOME": scratch, "TMPDIR": scratch, "TEMP": scratch, "TMP": scratch, "PYTHONDONTWRITEBYTECODE": "1"})
    env.update(extra or {})
    return env


def _summary(enforcement: Any) -> tuple[str, dict[str, str]]:
    status = {
        "fs": enforcement.fs.status,
        "network": enforcement.network.status,
        "env": enforcement.env.status,
        "process": enforcement.process.status,
    }
    weak = sorted(name for name, value in status.items() if value != "enforced")
    return (SANDBOXED if not weak else "degraded:" + ",".join(weak)), status


def _clean(text: str, *paths: Path) -> str:
    """Hide the temp paths, which differ every run, so evidence is reproducible; then bound it."""
    for path in paths:
        for spelling in {str(path), str(path.resolve())}:
            text = text.replace(spelling, cp_sandbox.WORKSPACE_PLACEHOLDER)
    return str(cp_sandbox.truncate(text))


def _result(
    command: Sequence[str], code: int | None, timed_out: bool, text: str, copy: Path, scratch: Path
) -> Any:
    cleaned = _clean(text, copy, scratch)
    counts = {} if code is None else cp_sandbox.parse_counts(text)
    return cp_sandbox.RunResult(tuple(command), code, timed_out, cleaned, counts)


def run_sandboxed(
    client: HxClient, command: Sequence[str], copy: Path, scratch: Path, workspace: Path, timeout: float
) -> CommandRun:
    """Run ``command`` in ``copy`` through ``sandbox.run``. Raises ``SandboxUnavailableError`` when the sandbox cannot
    start it (a missing capability, a refused grant, a toolchain it cannot mount)."""
    problem = sandbox_problem(client)
    if problem:
        raise SandboxUnavailableError(problem, data={"reason": problem})
    env = gate_env(str(scratch))
    tool = toolchain_for(command, env, str(copy))
    env.update(tool.env)
    ro = [str(workspace.resolve())]
    params = SandboxRunParams(
        argv=list(command),
        cwd=str(copy),
        env=env,
        env_allowlist=[],
        net=False,
        ro=ro,
        rw=[str(copy), str(scratch)],
        runtime_ro=tool.roots,
        system_read=True,
        timeout_ms=int(timeout * 1000),
        kill_grace_ms=KILL_GRACE_MS,
    )
    try:
        wire = client.request("sandbox.run", params.to_wire(), timeout=timeout + SPAWN_SLACK_S)
    except HxCallError as exc:
        if exc.code.startswith("hx.sandbox."):
            raise SandboxUnavailableError(f"the sandbox refused the gate: {exc.message}", data={"reason": exc.message}) from exc
        raise
    run = RunResult.from_wire(wire)
    label, status = _summary(run.enforcement)
    text = run.stdout.text + ("\n" if run.stdout.text and run.stderr.text else "") + run.stderr.text
    exit_ = run.exit
    if isinstance(exit_, SpawnFailedExitOutcome):
        if tool.program is None:  # the command names nothing runnable: the project's mistake, a plain failure
            return CommandRun(_result(command, None, False, f"[could not start: {exit_.reason}]", copy, scratch), label, status)
        raise SandboxUnavailableError(
            f"the gate's command could not start inside the sandbox: {exit_.reason}", data={"reason": exit_.reason}
        )
    if isinstance(exit_, TimedOutExitOutcome):
        return CommandRun(_result(command, None, True, text + f"\n[timed out after {timeout}s]", copy, scratch), label, status)
    if isinstance(exit_, SignaledExitOutcome):
        return CommandRun(_result(command, -int(exit_.signal), False, text, copy, scratch), label, status)
    assert isinstance(exit_, ExitedExitOutcome)
    return CommandRun(_result(command, exit_.code, False, text, copy, scratch), label, status)


def run_unsandboxed(command: Sequence[str], copy: Path, scratch: Path, timeout: float) -> CommandRun:
    """The user's explicit choice (``gate.allow_unsandboxed``) when no sandbox exists: the same copy and scratch and the
    same allowlisted environment, but no confinement. Logged every time."""
    _log.warning("the ship gate runs unsandboxed by the user's choice (gate.allow_unsandboxed): %s", command[0])
    env = gate_env(str(scratch))
    ran: ProcResult = run_captured(list(command), cwd=copy, env=env, timeout_s=timeout)
    if ran.error:
        return CommandRun(_result(command, None, False, f"[could not start: {ran.error}]", copy, scratch), UNSANDBOXED)
    text = ran.stdout + ("\n" if ran.stdout and ran.stderr else "") + ran.stderr
    if ran.timed_out:
        return CommandRun(_result(command, None, True, text + f"\n[timed out after {timeout}s]", copy, scratch), UNSANDBOXED)
    return CommandRun(_result(command, ran.returncode, False, text, copy, scratch), UNSANDBOXED)


def run_gate_command(
    client: HxClient | None,
    command: Sequence[str],
    workspace: Path,
    *,
    timeout: float,
    allow_unsandboxed: bool,
) -> CommandRun:
    """Copy ``workspace`` (the post-apply tree) to a throwaway directory and run ``command`` there, sandboxed.

    Raises ``SandboxUnavailableError`` (with the setting named) when it cannot, unless ``allow_unsandboxed``."""
    with tempfile.TemporaryDirectory(prefix="hx-gate-") as tmp:
        root = Path(tmp)
        copy, scratch = root / "ws", root / "scratch"
        scratch.mkdir()
        cp_sandbox.materialize(workspace, {}, copy)
        try:
            if client is None:
                raise SandboxUnavailableError("the hx binary was not found", data={"reason": "no hx"})
            return run_sandboxed(client, command, copy, scratch, workspace, timeout)
        except SandboxUnavailableError as exc:
            if not allow_unsandboxed:
                raise SandboxUnavailableError(f"{exc.message}. {UNAVAILABLE_HINT}", data=exc.data) from exc
            _log.warning("no sandbox for the gate (%s)", exc.message)
            return run_unsandboxed(command, copy, scratch, timeout)

