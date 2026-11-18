"""Pieces every stage of a ship shares: the ledger write that can undo the ship, the viewer event, small readers."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..errors import HypotaxisError
from ..hx.types import FileChange
from ..policy.data import load_defaults
from ..session import Runtime, SessionState
from ..util.log import get_logger

log = get_logger("ship")
MAX_TEXT = 1_000_000  # bytes read per file for line counts
T_VALIDATE, T_APPLY, T_RESTORE, T_DISCARD = 60.0, 120.0, 120.0, 30.0


class Abort(Exception):
    """The ship cannot stand (a ledger write failed): restore and report."""


def read_text(path: Path) -> str:
    try:
        data = path.read_bytes()[:MAX_TEXT]
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace")


def record(state: SessionState, rt: Runtime, type_: str, actor: str, payload: Mapping[str, Any]) -> None:
    try:
        rt.ledger(state).append(type_, actor, payload)
    except HypotaxisError as exc:
        raise Abort(f"the ledger could not be written ({exc.code}): {exc.message}") from exc


def emit(rt: Runtime, state: SessionState, payload: Mapping[str, Any]) -> None:
    try:
        rt.ctx.emit_to_session(state.session_id, "ship.completed", dict(payload))
    except Exception:
        log.warning("ship.completed not delivered", exc_info=True)


def effective_protected(state: SessionState) -> list[str]:
    """The shared default globs, plus the project's: always sent to hx as an explicit list."""
    project = state.project.settings.protected if state.project else ()
    return [*load_defaults().protected_defaults, *project]


def file_entries(files: Sequence[FileChange]) -> list[dict[str, Any]]:
    return [{"path": f.path, "sha256_before": f.sha256_before, "sha256_after": f.sha256_after} for f in files]
