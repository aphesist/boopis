"""``checkpoint.list`` and ``checkpoint.diff``: what the session's ships changed, read off its ledger and its
checkpoint chain (docs/PROTOCOL.md section 3).

The ledger says which ships were kept (``ship.applied`` then ``checkpoint.committed``); the checkpoint commits hold the
bytes. A restored ship wrote a ``ship.restored`` and has no checkpoint, so it is never listed: it changed nothing.
Nothing here writes: a diff is ``git diff`` of two commits the ledger recorded.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError
from ..hooks import runtime
from ..ledger.store import LedgerEvent


def session_id_of(params: Mapping[str, Any], session_id: str | None) -> str:
    sid = params.get("session_id") or session_id
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    return sid


def checkpoints_of(events: Sequence[LedgerEvent]) -> list[dict[str, Any]]:
    """Every kept ship, oldest first: ``{ship_id, commit, ref, files, ts}`` (``task_id`` when the ship had one)."""
    applied = {e["payload"]["ship_id"]: e for e in events if e["type"] == "ship.applied"}
    out: list[dict[str, Any]] = []
    for event in events:
        if event["type"] != "checkpoint.committed":
            continue
        payload = event["payload"]
        ship = applied.get(payload["ship_id"])
        entry: dict[str, Any] = {
            "ship_id": payload["ship_id"],
            "commit": payload["commit"],
            "ref": payload["ref"],
            "files": [f["path"] for f in ship["payload"]["files"]] if ship else [],
            "ts": event["ts"],
        }
        if ship is not None and "task_id" in ship["payload"]:
            entry["task_id"] = ship["payload"]["task_id"]
        out.append(entry)
    return out


def folder_of(state_cwd: str, events: Sequence[LedgerEvent]) -> str:
    """The session's working directory: what the live state knows, else what ``session.opened`` recorded."""
    if state_cwd:
        return state_cwd
    for event in events:
        if event["type"] == "session.opened" and isinstance(event["payload"].get("cwd"), str):
            return str(event["payload"]["cwd"])
    return ""


def checkpoint_list(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = session_id_of(params, session_id)
    rt = runtime()
    return {"checkpoints": checkpoints_of(rt.ledger(rt.state(sid)).read())}


def checkpoint_diff(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """The files of one ship (``ship_id``), or of every kept ship of the session together (no ``ship_id``): paths,
    status, added and removed line counts and the hunks. ``files`` is empty with ``unavailable`` naming why when there
    is nothing to diff (no kept ship is not a reason: that is an empty list without ``unavailable``)."""
    from ..ship.checkpoint import CheckpointError, diff_between, parent_of
    from ..ship.diffview import parse_unified

    sid = session_id_of(params, session_id)
    wanted = params.get("ship_id")
    if wanted is not None and not isinstance(wanted, str):
        raise InvalidParamsError("ship_id must be a string", data={"found": repr(wanted)})
    rt = runtime()
    state = rt.state(sid)
    events = rt.ledger(state).read()
    kept = checkpoints_of(events)
    if wanted is not None:
        kept = [c for c in kept if c["ship_id"] == wanted]
        if not kept:
            raise InvalidParamsError(f"no kept ship {wanted!r} in this session")
    if not kept:
        return {"files": [], "truncated": False}
    folder = folder_of(state.cwd, events)
    if not folder or not Path(folder).is_dir():
        return {"files": [], "truncated": False, "unavailable": "the session's folder is not known or is gone"}
    root = Path(folder)
    head = kept[-1]["commit"]
    try:
        base = parent_of(root, kept[0]["commit"])
        if base is None:
            return {"files": [], "truncated": False, "unavailable": "the checkpoint has no parent commit to compare"}
        diff = parse_unified(diff_between(root, base, head))
    except CheckpointError as exc:
        return {"files": [], "truncated": False, "unavailable": str(exc)}
    return {"ship_id": kept[-1]["ship_id"] if wanted else None, "base": base, "head": head, **diff}
