"""A ship after the write: the ledger, the gate, then keep (a checkpoint) or restore (every byte and mode back)."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from ..errors import BoopisError, SandboxUnavailableError
from ..governance.handover import unified_diff
from ..governance.links import WorkerLink
from ..hx import HxClient
from ..hx.types import ApplyResult, JournalRef, RestoreResult
from ..session import Runtime, SessionState
from . import attempt as attempt_mod
from . import gate as gate_mod
from . import results as out
from .checkpoint import Checkpoint, CheckpointError, commit_checkpoint
from .common import T_DISCARD, T_RESTORE, Abort, emit, file_entries, log, read_text, record
from .digest import record_fields
from .evidence import unchanged_files_named


def chain_base(state: SessionState) -> str | None:
    """Where this session's checkpoint chain starts when it continues another in the same folder."""
    link = state.continued
    if link is None or link.get("cwd") != state.cwd:
        return None
    base = link.get("base_commit")
    return base if isinstance(base, str) and base else None


def after_apply(
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
    worker: WorkerLink | None,
) -> dict[str, Any]:
    ship_id = applied.journal_id
    task_id = worker.task_id if worker is not None else f"ship:{ship_id}"
    ref = JournalRef(journal_dir=str(journals), journal_id=ship_id, root=str(root))
    try:
        run = _gate_andrecord(
            rt,
            state,
            client,
            root,
            applied,
            task_id,
            original,
            before_hashes,
            protected,
            allowed,
            argv,
            gate_on,
            worker,
        )
    except Abort as exc:
        return _restore(rt, state, client, ref, applied, f"the ship was undone: {exc}", None, task_id=None)
    except Exception as exc:  # noqa: BLE001 - a gate that cannot run denies (fail closed)
        log.error("gate failed to run", exc_info=True)
        if isinstance(exc, SandboxUnavailableError):
            reason = f"the gate could not run: {exc.message}"
        else:
            reason = f"the gate could not run: {type(exc).__name__}: {exc}"
        if worker is not None:  # no verdict was written, so the attempt is closed as a block by the cascade
            worker.failure = attempt_mod.failure_of(worker, "T0.gate", reason, "", "", {})
        return _restore(rt, state, client, ref, applied, reason, None, task_id)
    if worker is not None:
        attempt_mod.conclude(worker, run)
    if run is None or run.passed:
        return _keep(rt, state, client, root, ref, applied, task_id, run)
    if worker is not None:
        worker.failure = _worker_failure(worker, run, original, root, applied)
    return _restore(rt, state, client, ref, applied, run.payload["reason"], run, task_id)


def _worker_failure(
    worker: WorkerLink, run: gate_mod.GateRun, original: Mapping[str, str], root: Path, applied: ApplyResult
) -> Any:
    """What the next tier is told about this block. The diff is made now: the files are still as the ship wrote them,
    and the restore that follows puts the originals back."""
    blocker = run.blocked_by
    current = {f.path: ("" if f.deleted else read_text(root / f.path)) for f in applied.files}
    before = {f.path: original.get(f.path, "") for f in applied.files if not f.created}
    evidence = blocker.evidence if blocker is not None else {}
    return attempt_mod.failure_of(
        worker,
        blocker.gate if blocker is not None else "",
        run.payload["reason"],
        _failure_output(blocker, run.payload["reason"]),
        unified_diff(before, {p: t for p, t in current.items() if t or p in before}),
        evidence,
    )


def _gate_andrecord(
    rt: Runtime,
    state: SessionState,
    client: HxClient,
    root: Path,
    applied: ApplyResult,
    task_id: str,
    original: Mapping[str, str],
    before_hashes: Mapping[str, str],
    protected: Sequence[str],
    allowed: Sequence[str] | None,
    argv: Sequence[str] | None,
    gate_on: bool,
    worker: WorkerLink | None,
) -> gate_mod.GateRun | None:
    actor = worker.actor if worker is not None else state.actor()
    ship_id = applied.journal_id
    if worker is None:  # a plain ship is its own one-attempt task; a worker's task was created by dispatch
        title = f"ship {', '.join(f.path for f in applied.files)}"[:200]
        scope = list(allowed) if allowed else ["**"]
        record(
            state,
            rt,
            "task.created",
            "plugin",
            {"task_id": task_id, "title": title, "kind": "code", "scope": scope, "max_attempts": 1},
        )
        record(state, rt, "task.claimed", actor, {"task_id": task_id, "worker": actor})
    tags = attempt_mod.gate_tags(worker) if worker is not None else {}
    record(
        state,
        rt,
        "ship.applied",
        actor,
        {"ship_id": ship_id, "files": file_entries(applied.files), "task_id": task_id, "journal_id": ship_id}
        | ({"turn_id": state.track.turn_id} if state.track.turn_id else {}),
    )
    touched = {f.path: ("" if f.deleted else read_text(root / f.path)) for f in applied.files}
    digest = hashlib.sha256(
        "\n".join(f"{p}:{h}" for p, h in sorted((f.path, f.sha256_after or "") for f in applied.files)).encode()
    ).hexdigest()
    record(
        state,
        rt,
        "task.submitted",
        actor,
        {"task_id": task_id, "attempt": 1, "files": sorted(touched), "files_sha256": digest} | tags,
    )
    if not gate_on:
        record(state, rt, "gate.decided", "gate", gate_mod.disabled_payload(task_id) | tags)
        return None
    timeout = float(state.project.settings.gate_timeout_s) if state.project else 600.0
    if worker is not None:
        _announce_gate(rt, state, worker)
    run = gate_mod.run_gate(
        task_id=task_id, workspace=root, touched=touched, original=original, before_hashes=before_hashes,
        protected=protected, allowed=allowed, command=argv, timeout=timeout,
        runner=gate_mod.GateRunner(
            client, state.settings.gate.allow_unsandboxed, bool(state.project and state.project.settings.gate_git)
        ),
    )  # fmt: skip
    record(state, rt, "gate.decided", "gate", run.payload | tags)
    return run


def _announce_gate(rt: Runtime, state: SessionState, worker: WorkerLink) -> None:
    """``cascade.updated`` with status ``gate``: a worker's ship is at the project's gate."""
    from ..governance.lifecycle import announce

    found = rt.cascades.find(worker.task_id)
    if found is not None:
        found.gating = True
        announce(rt, state, found, "gate", worker.tier_index, worker.attempt)


def _gate_view(run: gate_mod.GateRun | None) -> dict[str, Any]:
    if run is None:
        return {"verdict": "pass", "gates": [], "note": "the gate is switched off for this session"}
    return {
        "verdict": run.results[-1].verdict,
        "gates": [r.gate for r in run.results],
        "enforcement": run.payload["enforcement"],
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
    except BoopisError as exc:
        warnings.append(f"the journal was not discarded ({exc.code}); the changes stand")
    checkpoint: Checkpoint | None = None
    try:
        checkpoint = commit_checkpoint(
            root, state.session_id, applied.files, f"boopis ship {ship_id}", base=chain_base(state)
        )
        record(
            state,
            rt,
            "checkpoint.committed",
            "plugin",
            {"ship_id": ship_id, "ref": checkpoint.ref, "commit": checkpoint.commit} | record_fields(root),
        )
    except CheckpointError as exc:
        warnings.append(f"no checkpoint: {exc}")
    except Abort as exc:
        warnings.append(str(exc))
    warnings += _switch_off_hooks(rt, state, root, applied)
    result: dict[str, Any] = {
        "status": "shipped",
        "ship_id": ship_id,
        "files": out.files_view(applied.files),
        "gate": _gate_view(run),
        "checkpoint": {"ref": checkpoint.ref, "commit": checkpoint.commit} if checkpoint else None,
    }
    if warnings:
        result["warnings"] = warnings
    emit(
        rt,
        state,
        {"ship_id": ship_id, "status": "shipped", "files": out.files_view(applied.files), "gate": _gate_view(run)},
    )
    return result


def _switch_off_hooks(rt: Runtime, state: SessionState, root: Path, applied: ApplyResult) -> list[str]:
    """A kept ship that touched a file the project's trusted hooks load (or one of their scripts) switches those hooks
    off and asks the user, in a ``permission`` form, to trust them again (``compat.rearm``). Returns the warnings for
    the ship's answer. If it cannot tell, it fails closed: every hook approval of the project is withdrawn."""
    paths = [str(root / f.path) for f in applied.files]
    try:
        from ..compat.rearm import effect, form_text, suspend
        from ..forms.presets import Draft
        from ..forms.tools import service

        suspension = suspend(rt.home, state.cwd, paths)
        if suspension is None:
            return []
        title, body = form_text(suspension)
        schema = {
            "type": "object",
            "properties": {"decision": {"type": "string", "title": "Your hooks", "enum": ["trust", "leave_off"]}},
            "required": ["decision"],
        }
        service(rt).open(
            state.session_id, None, Draft("permission", title, body, schema, effect=effect(suspension)), origin="plugin"
        )
        return [
            "this change touches files the project's hooks load ("
            + ", ".join(suspension.touched[:5])
            + "): the hooks are switched off until the owner trusts them again"
        ]
    except Exception:  # noqa: BLE001 - could not tell, so no hook approval is kept (fail closed)
        log.error("could not check the hooks against this ship", exc_info=True)
        try:
            from ..compat.trust import KIND_HOOKS
            from ..config.trust import TrustStore

            TrustStore(rt.home).revoke(state.cwd, KIND_HOOKS)
        except Exception:  # noqa: BLE001
            log.error("hook approvals could not be withdrawn", exc_info=True)
        return ["the project's hooks were switched off: this ship could not be checked against what they load"]


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
    except BoopisError as exc:
        log.error("txn.restore failed for %s", ship_id, exc_info=True)
        return out.error(
            f"the workspace could not be restored ({getattr(exc, 'code', 'hx.txn.restore_failed')}); the journal "
            f"{ship_id} is kept and recovery runs when the plugin next starts",
            "hx.txn.restore_failed",
        )
    payload: dict[str, Any] = {"ship_id": ship_id, "reason": reason[:500]}
    if task_id is not None:
        payload["task_id"] = task_id
    try:
        record(state, rt, "ship.restored", "plugin", payload)
    except Abort:
        log.error("ship.restored not recorded for %s", ship_id)
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
    emit(
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
