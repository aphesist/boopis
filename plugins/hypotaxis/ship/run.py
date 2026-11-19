"""One ``ship`` call, up to the write: validate, journal and apply. ``finish`` runs the gate and keeps or restores.

Order, and why (docs/ARCHITECTURE.md section 7):

1. ``txn.validate``: every edit is checked in memory; a miss writes nothing and returns the closest
   match. Protected paths and scope are enforced by hx with the explicit effective lists (the
   shared defaults plus the project's, and the lane's ``allowed`` scope when there is one).
2. protected files are hashed (the gate binds to these hashes), then ``txn.apply`` journals the
   originals and writes atomically.
3. ``finish``: the ledger gets ``task.created``, ``task.claimed``, ``ship.applied``, ``task.submitted``;
   the gate runs on a temp copy and ``gate.decided`` is written; a pass discards the journal and commits a
   checkpoint, a fail (or a gate that cannot run) restores every byte and mode and writes ``ship.restored``.

A ledger that cannot be written restores the workspace: a ship with no record does not stand.

A *worker* of the governed cascade (``worker`` is its link) ships into the task ``dispatch`` already created: it writes
no ``task.created``/``task.claimed`` of its own, its events carry the worker's actor, the attempt and the tier, and
the scope is the brief's. Whatever the gate decides, or hx refuses before writing for scope, ends the attempt
(``attempt``), and a block keeps the rejected change as a diff for the next tier, taken just before the restore.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..errors import HxCallError, HxTimeoutError, HypotaxisError
from ..governance.links import WorkerLink
from ..hx import HxClient
from ..hx.types import (
    ApplyParams,
    ApplyResult,
    PathsData,
    RecoverParams,
    ValidateParams,
    ValidateResult,
)
from ..session import Runtime, SessionState
from . import attempt as attempt_mod
from . import gate as gate_mod
from . import results as out
from .common import T_APPLY, T_VALIDATE, effective_protected, emit, log, read_text
from .edits import parse_edits
from .finish import after_apply
from .recover import journal_dir
from .sandboxrun import UNAVAILABLE_HINT, sandbox_problem


def run_ship(
    rt: Runtime, state: SessionState, args: Mapping[str, Any], worker: WorkerLink | None = None
) -> dict[str, Any]:
    """Run one ship. Never raises: every failure is a result."""
    try:
        result = _run(rt, state, args, worker)
        if result.get("status") in ("aborted_before_write", "blocked"):
            emit(
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
        log.error("ship failed", exc_info=True)
        return out.error(f"ship failed: {type(exc).__name__}: {exc}")


def _run(rt: Runtime, state: SessionState, args: Mapping[str, Any], worker: WorkerLink | None) -> dict[str, Any]:
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
    if gate_on and argv is not None and not state.settings.gate.allow_unsandboxed:
        problem = sandbox_problem(client)  # decided before anything is written, so a ship is not undone for it
        if problem:
            return out.refused(f"the gate cannot run: {problem}. {UNAVAILABLE_HINT} Nothing was written.")
    protected = effective_protected(state)
    scope = worker.scope if worker is not None else state.allowed
    allowed = list(scope) if scope else None
    journals = journal_dir(rt.home, _stem(rt, state))

    validate = ValidateParams(root=str(root), edits=edits, allowed=allowed, protected=protected)
    try:
        planned = ValidateResult.from_wire(client.request("txn.validate", validate.to_wire(), timeout=T_VALIDATE))
    except HxCallError as exc:
        return _before_write(rt, state, worker, exc, protected)
    original = {f.path: read_text(root / f.path) for f in planned.files if f.sha256_before is not None}
    before_hashes = gate_mod.protected_hashes(root, protected, "ship")

    apply = ApplyParams(root=str(root), journal_dir=str(journals), edits=edits, allowed=allowed, protected=protected)
    try:
        applied = ApplyResult.from_wire(client.request("txn.apply", apply.to_wire(), timeout=T_APPLY))
    except HxCallError as exc:
        return _before_write(rt, state, worker, exc, protected)
    except HxTimeoutError:
        _rollback_best_effort(client, journals)
        raise
    return after_apply(
        rt, state, client, root, applied, original, before_hashes, protected, allowed, argv, gate_on, journals, worker
    )


def _stem(rt: Runtime, state: SessionState) -> str:
    from ..ledger import ledger_filename

    return ledger_filename(state.session_id).removesuffix(".jsonl")


def _before_write(
    rt: Runtime, state: SessionState, worker: WorkerLink | None, exc: HxCallError, protected: Sequence[str]
) -> dict[str, Any]:
    if worker is not None:
        verdict = attempt_mod.reject_before_write(rt, state, worker, exc, protected)
        if verdict is not None:
            return verdict
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
        log.error("rollback after an apply timeout failed", exc_info=True)
