"""The gate's test command, run through ``hx sandbox.run`` (and, only by the user's explicit choice, without it).

The command is code the agent may have just written (a ``conftest.py``, a ``package.json`` script, a ``Makefile``), so
it runs like exec's kernel, on a **copy** of the workspace (``gatecopy``):

- the copy and a scratch directory (``HOME`` and ``TMPDIR``) are the only writable trees;
- the real workspace is **not mounted at all**. What the tests need from it is in the copy, minus every secret file
  (``.env*``, keys, credential files: ``secrets``), plus the project's installed dependency directories, which are the
  one thing mounted read-only from the real tree (``node_modules``, a virtual environment, ``vendor``);
- the toolchain (``toolchain``) is mounted read-only, with the dependency caches it needs under ``$HOME`` and nothing
  else of ``$HOME``;
- the network is off, and the environment is the allowlist of ``util.proc.safe_env`` with ``HOME`` and ``TMPDIR``
  moved into the scratch: provider keys, tokens and the plugin's own secret source never reach it.

What the command prints goes through hx's redaction **before** it is truncated, recorded in the ledger or shown to a
model; if hx cannot redact it, the output is withheld.

A sandbox that cannot run it is ``SandboxUnavailableError``: the gate blocks (fail closed). ``allow_unsandboxed`` is the
one way past that, and it is logged on every use.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
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
from ..util.redact import redact_or_withhold
from .gatecopy import GateTree, build_copy, gate_data
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
DEPENDENCIES_HINT = (
    "dependencies aren't installed; install them, then ship again. (The gate runs with the network off, so it cannot "
    "fetch them; it sees the dependency directories the project already has.)"
)
KILL_GRACE_MS = 2000
SPAWN_SLACK_S = 30.0


@dataclass(frozen=True, slots=True)
class CommandRun:
    """What the command did, and how it was confined. ``result`` is contraprova's ``RunResult``."""

    result: Any
    enforcement: str
    detail: Mapping[str, str] = field(default_factory=dict)  # hx's per-dimension status, when sandboxed
    hint: str = ""  # a failure's likely cause, when the output says so (``dependency_hint``)
    withheld: int = 0  # secret files left out of the copy


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
    env = safe_env(
        {"HOME": scratch, "TMPDIR": scratch, "TEMP": scratch, "TMP": scratch, "PYTHONDONTWRITEBYTECODE": "1"}
    )
    env.update(extra or {})
    return env


def project_env(tree: GateTree, path: str) -> dict[str, str]:
    """The project's own command directories first in ``PATH`` (the copy's links to them): a virtual environment's
    ``bin`` and ``node_modules/.bin``, so ``pytest`` or ``vitest`` resolve to what the project installed."""
    bins = [
        str(tree.root / name / sub)
        for name, sub in ((".venv", "bin"), ("venv", "bin"), ("node_modules", ".bin"))
        if name in tree.linked
    ]
    env = {"PATH": os.pathsep.join([*bins, path]) if bins else path}
    for name in (".venv", "venv"):
        if name in tree.linked:
            env["VIRTUAL_ENV"] = str(tree.root / name)
            break
    return env


def dependency_hint(text: str, tree: GateTree) -> str:
    """For a failed run: ``DEPENDENCIES_HINT`` when the output shows it wanted the network, or lacked a module of a
    project that declares dependencies and has no installed directory for them. ``""`` otherwise."""
    data = gate_data()
    if any(sig in text for sig in data["offline_failures"]):
        return DEPENDENCIES_HINT
    if any(sig in text for sig in data["missing_dependencies"]):
        for marker, dirs in data["declares_dependencies"].items():
            if (tree.root / marker).is_file() and not tree.has_dependencies(dirs):
                return DEPENDENCIES_HINT
    return ""


def _summary(enforcement: Any) -> tuple[str, dict[str, str]]:
    status = {
        "fs": enforcement.fs.status,
        "network": enforcement.network.status,
        "env": enforcement.env.status,
        "process": enforcement.process.status,
    }
    weak = sorted(name for name, value in status.items() if value != "enforced")
    return (SANDBOXED if not weak else "degraded:" + ",".join(weak)), status


Redact = Callable[[str], str]


def _clean(text: str, redact: Redact, *paths: Path) -> str:
    """Hide the temp paths, which differ every run, so evidence is reproducible; redact secrets; then bound it.
    Redaction comes before the cut, so a secret the cut would have split is still recognised."""
    for path in paths:
        for spelling in {str(path), str(path.resolve())}:
            text = text.replace(spelling, cp_sandbox.WORKSPACE_PLACEHOLDER)
    return str(cp_sandbox.truncate(redact(text)))


def _result(
    command: Sequence[str],
    code: int | None,
    timed_out: bool,
    text: str,
    tree: GateTree,
    scratch: Path,
    redact: Redact,
    *,
    label: str,
    status: Mapping[str, str] | None = None,
) -> CommandRun:
    counts = {} if code is None else cp_sandbox.parse_counts(text)
    hint = dependency_hint(text, tree) if code != 0 else ""
    shown = text + (f"\n[hypotaxis] {hint}" if hint else "")
    cleaned = _clean(shown, redact, tree.root, scratch)
    shown_command = tuple(redact(word) for word in command)  # recorded in the evidence and the ledger
    result = cp_sandbox.RunResult(shown_command, code, timed_out, cleaned, counts)
    return CommandRun(result, label, dict(status or {}), hint, tree.withheld)


def _link_caches(links: Sequence[tuple[str, str]], scratch: Path) -> None:
    """Make the toolchain's symlinks (cargo's registry entries) inside the scratch, and only there."""
    base = os.path.abspath(scratch)
    for raw, target in links:
        dest = os.path.abspath(raw)
        if not dest.startswith(base + os.sep):
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if not os.path.lexists(dest):
            os.symlink(target, dest)


def run_sandboxed(
    client: HxClient, command: Sequence[str], tree: GateTree, scratch: Path, timeout: float
) -> CommandRun:
    """Run ``command`` in the copy ``tree`` through ``sandbox.run``. Raises ``SandboxUnavailableError`` when the sandbox
    cannot start it (a missing capability, a refused grant, a toolchain it cannot mount)."""
    problem = sandbox_problem(client)
    if problem:
        raise SandboxUnavailableError(problem, data={"reason": problem})
    copy = tree.root
    env = gate_env(str(scratch))
    env.update(project_env(tree, env.get("PATH", "")))
    tool = toolchain_for(command, env, str(copy), str(scratch))
    env.update(tool.env)
    _link_caches(tool.links, scratch)
    mounted = [os.path.realpath(m) for m in tree.mounts]
    runtime = [r for r in tool.roots if not any(os.path.realpath(r).startswith(m + os.sep) for m in mounted)]
    params = SandboxRunParams(
        argv=list(command),
        cwd=str(copy),
        env=env,
        env_allowlist=[],
        net=False,
        ro=list(tree.mounts),  # the dependency directories only; the real workspace is not mounted
        rw=[str(copy), str(scratch)],
        runtime_ro=runtime,
        system_read=True,
        timeout_ms=int(timeout * 1000),
        kill_grace_ms=KILL_GRACE_MS,
    )
    try:
        wire = client.request("sandbox.run", params.to_wire(), timeout=timeout + SPAWN_SLACK_S)
    except HxCallError as exc:
        if exc.code.startswith("hx.sandbox."):
            raise SandboxUnavailableError(
                f"the sandbox refused the gate: {exc.message}", data={"reason": exc.message}
            ) from exc
        raise
    run = RunResult.from_wire(wire)
    label, status = _summary(run.enforcement)
    text = run.stdout.text + ("\n" if run.stdout.text and run.stderr.text else "") + run.stderr.text
    exit_ = run.exit

    def redact(raw: str) -> str:
        return redact_or_withhold(client, raw)

    def done(code: int | None, timed_out: bool, shown: str) -> CommandRun:
        return _result(command, code, timed_out, shown, tree, scratch, redact, label=label, status=status)

    if isinstance(exit_, SpawnFailedExitOutcome):
        if tool.program is None:  # the command names nothing runnable: the project's mistake, a plain failure
            return done(None, False, f"[could not start: {exit_.reason}]")
        raise SandboxUnavailableError(
            f"the gate's command could not start inside the sandbox: {exit_.reason}", data={"reason": exit_.reason}
        )
    if isinstance(exit_, TimedOutExitOutcome):
        return done(None, True, text + f"\n[timed out after {timeout}s]")
    if isinstance(exit_, SignaledExitOutcome):
        return done(-int(exit_.signal), False, text)
    assert isinstance(exit_, ExitedExitOutcome)
    return done(exit_.code, False, text)


def run_unsandboxed(
    command: Sequence[str], tree: GateTree, scratch: Path, timeout: float, client: HxClient | None = None
) -> CommandRun:
    """The user's explicit choice (``gate.allow_unsandboxed``) when no sandbox exists: the same copy and scratch and the
    same allowlisted environment, but no confinement. Logged every time. The output is still redacted."""
    _log.warning("the ship gate runs unsandboxed by the user's choice (gate.allow_unsandboxed): %s", command[0])
    env = gate_env(str(scratch))
    env.update(project_env(tree, env.get("PATH", "")))

    def redact(raw: str) -> str:
        return redact_or_withhold(client, raw)

    def done(code: int | None, timed_out: bool, shown: str) -> CommandRun:
        return _result(command, code, timed_out, shown, tree, scratch, redact, label=UNSANDBOXED)

    ran: ProcResult = run_captured(list(command), cwd=tree.root, env=env, timeout_s=timeout)
    if ran.error:
        return done(None, False, f"[could not start: {ran.error}]")
    text = ran.stdout + ("\n" if ran.stdout and ran.stderr else "") + ran.stderr
    if ran.timed_out:
        return done(None, True, text + f"\n[timed out after {timeout}s]")
    return done(ran.returncode, False, text)


def run_gate_command(
    client: HxClient | None,
    command: Sequence[str],
    workspace: Path,
    *,
    timeout: float,
    allow_unsandboxed: bool,
    git_metadata: bool = False,
) -> CommandRun:
    """Copy ``workspace`` (the post-apply tree) to a throwaway directory, without its secrets and with its installed
    dependencies linked, and run ``command`` there, sandboxed. ``git_metadata`` also links ``.git`` read-only.

    Raises ``SandboxUnavailableError`` (with the setting named) when it cannot, unless ``allow_unsandboxed``."""
    with tempfile.TemporaryDirectory(prefix="hx-gate-") as tmp:
        root = Path(tmp)
        copy, scratch = root / "ws", root / "scratch"
        scratch.mkdir()
        tree = build_copy(workspace, copy, git=git_metadata)
        try:
            if client is None:
                raise SandboxUnavailableError("the hx binary was not found", data={"reason": "no hx"})
            return run_sandboxed(client, command, tree, scratch, timeout)
        except SandboxUnavailableError as exc:
            if not allow_unsandboxed:
                raise SandboxUnavailableError(f"{exc.message}. {UNAVAILABLE_HINT}", data=exc.data) from exc
            _log.warning("no sandbox for the gate (%s)", exc.message)
            return run_unsandboxed(command, tree, scratch, timeout, client)
