"""One ``ship`` call: validate, journal and apply, gate, then keep or put everything back.

Order, and why (docs/ARCHITECTURE.md section 7):

1. ``txn.validate``: every edit is checked in memory; a miss writes nothing and returns the closest
   match. Protected paths and scope are enforced by hx with the explicit effective lists (the
   shared defaults plus the project's, and the lane's ``allowed`` scope when there is one).
2. protected files are hashed (the gate binds to these hashes), then ``txn.apply`` journals the
   originals and writes atomically.
3. The ledger gets ``task.created``, ``task.claimed``, ``ship.applied``, ``task.submitted``.
4. The gate runs on a temp copy and ``gate.decided`` is written.
5. Pass: ``txn.discard``, a checkpoint commit, ``checkpoint.committed``. Fail (or a gate that cannot
   run): ``txn.restore`` puts every byte and mode back, ``ship.restored``.

A ledger that cannot be written restores the workspace: a ship with no record does not stand.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from ..errors import HxCallError, HxTimeoutError, HypotaxisError
from ..hx import HxClient
from ..hx.types import (
    ApplyParams,
    ApplyResult,
    FileChange,
    JournalRef,
    PathsData,
    RecoverParams,
    RestoreResult,
    ValidateParams,
    ValidateResult,
)
from ..policy.data import load_defaults
from ..session import Runtime, SessionState
from ..util.log import get_logger
from . import gate as gate_mod
from . import results as out
from .checkpoint import Checkpoint, CheckpointError, commit_checkpoint
from .edits import parse_edits
from .evidence import unchanged_files_named
from .recover import journal_dir

_log = get_logger("ship")
MAX_TEXT = 1_000_000  # bytes read per file for line counts
T_VALIDATE, T_APPLY, T_RESTORE, T_DISCARD = 60.0, 120.0, 120.0, 30.0


class _Abort(Exception):
    """The ship cannot stand (a ledger write failed): restore and report."""


def _read(path: Path) -> str:
    try:
        data = path.read_bytes()[:MAX_TEXT]
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace")


def _record(state: SessionState, rt: Runtime, type_: str, actor: str, payload: Mapping[str, Any]) -> None:
    try:
        rt.ledger(state).append(type_, actor, payload)
    except HypotaxisError as exc:
        raise _Abort(f"the ledger could not be written ({exc.code}): {exc.message}") from exc


def _emit(rt: Runtime, state: SessionState, payload: Mapping[str, Any]) -> None:
    try:
        rt.ctx.emit_to_session(state.session_id, "ship.completed", dict(payload))
    except Exception:  # noqa: BLE001 - a viewer problem never fails a ship
        _log.warning("ship.completed not delivered", exc_info=True)


def effective_protected(state: SessionState) -> list[str]:
    """The shared default globs, plus the project's: always sent to hx as an explicit list."""
    project = state.project.settings.protected if state.project else ()
    return [*load_defaults().protected_defaults, *project]


def _file_entries(files: Sequence[FileChange]) -> list[dict[str, Any]]:
    return [{"path": f.path, "sha256_before": f.sha256_before, "sha256_after": f.sha256_after} for f in files]


def run_ship(rt: Runtime, state: SessionState, args: Mapping[str, Any]) -> dict[str, Any]:
    """Run one ship. Never raises: every failure is a result."""
    try:
        result = _run(rt, state, args)
        if result.get("status") in ("aborted_before_write", "blocked"):
            _emit(
                rt,
                state,
                {
                    "ship_id": None,
                    "status": "aborted_before_write",
                    "files": [],
                    "reason": result.get("code") or result["status"],
                },
            )
        return result
    except HxTimeoutError as exc:
        return out.error(exc) | {"note": "the outcome is unknown; recovery runs when the plugin next starts"}
    except HypotaxisError as exc:
        return out.error(exc)
    except Exception as exc:  # noqa: BLE001 - a tool handler never raises into Hermes
        _log.error("ship failed", exc_info=True)
        return out.error(f"ship failed: {type(exc).__name__}: {exc}")


def _run(rt: Runtime, state: SessionState, args: Mapping[str, Any]) -> dict[str, Any]:
    client = rt.hx_client()
    if client is None:
        return out.error("the hx binary was not found, so nothing can be shipped", "hx.process.unavailable")
    edits, problems = parse_edits(args.get("edits"))
    if problems:
        return out.invalid(problems)
    root = Path(state.cwd)
    if not state.cwd or not root.is_dir():
        return out.error("the session's working directory is not known", "hx.config.invalid")
    project = state.project
    gate_on = state.gate_enabled is not False
    command_text = project.settings.gate_command if project else None
    if state.mode == "governed" and gate_on and not command_text:
        return out.refused(
            "governed mode needs the project's gate command, and none is configured and trusted "
            "(gate.command in .hermes/hypotaxis.yaml, approved by the user). Nothing was written."
        )
    try:
        argv = gate_mod.parse_command(command_text) if command_text else None
    except ValueError as exc:
        return out.refused(f"the gate command cannot be used: {exc}. Nothing was written.")
    protected = effective_protected(state)
    allowed = list(state.allowed) if state.allowed else None
    journals = journal_dir(rt.home, _stem(rt, state))

    validate = ValidateParams(root=str(root), edits=edits, allowed=allowed, protected=protected)
    try:
        planned = ValidateResult.from_wire(client.request("txn.validate", validate.to_wire(), timeout=T_VALIDATE))
    except HxCallError as exc:
        return _before_write(exc)
    original = {f.path: _read(root / f.path) for f in planned.files if f.sha256_before is not None}
    before_hashes = gate_mod.protected_hashes(root, protected, "ship")

    apply = ApplyParams(root=str(root), journal_dir=str(journals), edits=edits, allowed=allowed, protected=protected)
    try:
        applied = ApplyResult.from_wire(client.request("txn.apply", apply.to_wire(), timeout=T_APPLY))
    except HxCallError as exc:
        return _before_write(exc)
    except HxTimeoutError:
        _rollback_best_effort(client, journals)
        raise
    return _after_apply(
        rt, state, client, root, applied, original, before_hashes, protected, allowed, argv, gate_on, journals
    )


def _stem(rt: Runtime, state: SessionState) -> str:
    from ..ledger import ledger_filename

    return ledger_filename(state.session_id).removesuffix(".jsonl")


def _before_write(exc: HxCallError) -> dict[str, Any]:
    if exc.code == "hx.txn.aborted_before_write":
        return out.aborted(exc.data)
    if exc.code in ("hx.txn.scope_violation", "hx.txn.protected_path"):
        paths = PathsData.from_wire(exc.data).paths if "paths" in exc.data else []
        what = "protected" if exc.code.endswith("protected_path") else "outside the allowed scope"
        return out.blocked(exc.code, paths, f"Nothing was written: these paths are {what}.")
    if exc.code == "hx.txn.workspace_busy":
        return out.refused("another ship holds the workspace; try again in a moment")
    return out.error(exc.message, exc.code)


def _rollback_best_effort(client: HxClient, journals: Path) -> None:
    try:
        client.request("txn.recover", RecoverParams(journal_dir=str(journals)).to_wire(), timeout=60)
    except HypotaxisError:
        _log.error("rollback after an apply timeout failed", exc_info=True)


def _after_apply(
    rt: Runtime,
    state: SessionState,
    client: HxClient,
    root: Path,
    applied: ApplyResult,
    original: Mapping[str, str],
    before_hashes: Mapping[str, str],
    protected: Sequence[str],
    allowed: Sequence[str] | None,
    argv: Sequence[str] | None,
    gate_on: bool,
    journals: Path,
) -> dict[str, Any]:
    ship_id = applied.journal_id
    task_id = f"ship:{ship_id}"
    ref = JournalRef(journal_dir=str(journals), journal_id=ship_id)
    try:
        run = _gate_and_record(
            rt, state, root, applied, task_id, original, before_hashes, protected, allowed, argv, gate_on
        )
    except _Abort as exc:
        return _restore(rt, state, client, ref, applied, f"the ship was undone: {exc}", None, task_id=None)
    except Exception as exc:  # noqa: BLE001 - a gate that cannot run denies (fail closed)
        _log.error("gate failed to run", exc_info=True)
        return _restore(
            rt, state, client, ref, applied, f"the gate could not run: {type(exc).__name__}: {exc}", None, task_id
        )
    if run is None or run.passed:
        return _keep(rt, state, client, root, ref, applied, task_id, run)
    return _restore(rt, state, client, ref, applied, run.payload["reason"], run, task_id)


def _gate_and_record(
    rt: Runtime,
    state: SessionState,
    root: Path,
    applied: ApplyResult,
    task_id: str,
    original: Mapping[str, str],
    before_hashes: Mapping[str, str],
    protected: Sequence[str],
    allowed: Sequence[str] | None,
    argv: Sequence[str] | None,
    gate_on: bool,
) -> gate_mod.GateRun | None:
    actor = state.actor()
    ship_id = applied.journal_id
    title = f"ship {', '.join(f.path for f in applied.files)}"[:200]
    scope = list(allowed) if allowed else ["**"]
    _record(
        state,
        rt,
        "task.created",
        "plugin",
        {"task_id": task_id, "title": title, "kind": "code", "scope": scope, "max_attempts": 1},
    )
    _record(state, rt, "task.claimed", actor, {"task_id": task_id, "worker": actor})
    _record(
        state,
        rt,
        "ship.applied",
        actor,
        {"ship_id": ship_id, "files": _file_entries(applied.files), "task_id": task_id, "journal_id": ship_id},
    )
    touched = {f.path: ("" if f.deleted else _read(root / f.path)) for f in applied.files}
    digest = hashlib.sha256(
        "\n".join(f"{p}:{h}" for p, h in sorted((f.path, f.sha256_after or "") for f in applied.files)).encode()
    ).hexdigest()
    _record(
        state,
        rt,
        "task.submitted",
        actor,
        {"task_id": task_id, "attempt": 1, "files": sorted(touched), "files_sha256": digest},
    )
    if not gate_on:
        _record(state, rt, "gate.decided", "gate", gate_mod.disabled_payload(task_id))
        return None
    timeout = float(state.project.settings.gate_timeout_s) if state.project else 600.0
    run = gate_mod.run_gate(
        task_id=task_id, workspace=root, touched=touched, original=original, before_hashes=before_hashes,
        protected=protected, allowed=allowed, command=argv, timeout=timeout,
    )  # fmt: skip
    _record(state, rt, "gate.decided", "gate", run.payload)
    return run


def _gate_view(run: gate_mod.GateRun | None) -> dict[str, Any]:
    if run is None:
        return {"verdict": "pass", "gates": [], "note": "the gate is switched off for this session"}
    return {
        "verdict": run.results[-1].verdict,
        "gates": [r.gate for r in run.results],
        "enforcement": gate_mod.ENFORCEMENT,
    }


def _keep(
    rt: Runtime,
    state: SessionState,
    client: HxClient,
    root: Path,
    ref: JournalRef,
    applied: ApplyResult,
    task_id: str,
    run: gate_mod.GateRun | None,
) -> dict[str, Any]:
    ship_id = applied.journal_id
    warnings: list[str] = []
    try:
        client.request("txn.discard", ref.to_wire(), timeout=T_DISCARD)
    except HypotaxisError as exc:
        warnings.append(f"the journal was not discarded ({exc.code}); the changes stand")
    checkpoint: Checkpoint | None = None
    try:
        checkpoint = commit_checkpoint(root, state.session_id, applied.files, f"hypotaxis ship {ship_id}")
        _record(
            state,
            rt,
            "checkpoint.committed",
            "plugin",
            {"ship_id": ship_id, "ref": checkpoint.ref, "commit": checkpoint.commit},
        )
    except CheckpointError as exc:
        warnings.append(f"no checkpoint: {exc}")
    except _Abort as exc:
        warnings.append(str(exc))
    result: dict[str, Any] = {
        "status": "shipped",
        "ship_id": ship_id,
        "files": out.files_view(applied.files),
        "gate": _gate_view(run),
        "checkpoint": {"ref": checkpoint.ref, "commit": checkpoint.commit} if checkpoint else None,
    }
    if warnings:
        result["warnings"] = warnings
    _emit(
        rt,
        state,
        {"ship_id": ship_id, "status": "shipped", "files": out.files_view(applied.files), "gate": _gate_view(run)},
    )
    return result


def _restore(
    rt: Runtime,
    state: SessionState,
    client: HxClient,
    ref: JournalRef,
    applied: ApplyResult,
    reason: str,
    run: gate_mod.GateRun | None,
    task_id: str | None,
) -> dict[str, Any]:
    ship_id = applied.journal_id
    try:
        restored = RestoreResult.from_wire(client.request("txn.restore", ref.to_wire(), timeout=T_RESTORE))
    except HypotaxisError as exc:
        _log.error("txn.restore failed for %s", ship_id, exc_info=True)
        return out.error(
            f"the workspace could not be restored ({getattr(exc, 'code', 'hx.txn.restore_failed')}); the journal "
            f"{ship_id} is kept and recovery runs when the plugin next starts",
            "hx.txn.restore_failed",
        )
    payload: dict[str, Any] = {"ship_id": ship_id, "reason": reason[:500]}
    if task_id is not None:
        payload["task_id"] = task_id
    try:
        _record(state, rt, "ship.restored", "plugin", payload)
    except _Abort:
        _log.error("ship.restored not recorded for %s", ship_id)
    changed = [f.path for f in applied.files]
    blocker = run.blocked_by if run else None
    output = _failure_output(blocker, reason)
    result: dict[str, Any] = {
        "status": "restored",
        "ship_id": ship_id,
        "restored": restored.restored,
        "removed": restored.removed,
        "reason": reason,
        "gate": _gate_view(run) if run else None,
        "output": output,
        "note": "Every file is back to its exact bytes and mode. Fix the cause and send the edits again.",
    }
    named = unchanged_files_named(output, Path(state.cwd), changed)
    if named:
        result["failure_points_at_files_this_call_did_not_change"] = named
    _emit(
        rt,
        state,
        {
            "ship_id": ship_id,
            "status": "restored",
            "files": out.files_view(applied.files),
            "gate": _gate_view(run) if run else None,
        },
    )
    return result


def _failure_output(blocker: Any, reason: str) -> str:
    if blocker is None:
        return reason
    tests = cast("Mapping[str, Any]", blocker.evidence.get("tests") or {})
    return str(tests.get("output") or blocker.reason)
