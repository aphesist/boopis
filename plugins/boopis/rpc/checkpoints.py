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
    """Every kept ship, oldest first: ``{ship_id, commit, ref, files, ts, kind}`` (``kind`` ``ship`` or ``rewind``),
    with ``task_id``, ``turn_id`` and ``rewind_to`` when the ship had them."""
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
        entry["kind"] = "rewind" if ship is not None and ship["payload"].get("kind") == "rewind" else "ship"
        for key in ("task_id", "turn_id", "rewind_to"):
            if ship is not None and key in ship["payload"]:
                entry[key] = ship["payload"][key]
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
    """The kept ships of the session, each with its ``session_id``; with ``chain: true`` those of every engine session
    of its thread (``continue.chain``), oldest first."""
    sid = session_id_of(params, session_id)
    chain = params.get("chain", False)
    if not isinstance(chain, bool):
        raise InvalidParamsError("chain must be a boolean", data={"found": repr(chain)})
    rt = runtime()
    if not chain:
        return {"checkpoints": [c | {"session_id": sid} for c in checkpoints_of(rt.ledger(rt.state(sid)).read())]}
    from .continuation import chain_of

    out: list[dict[str, Any]] = []
    for part, events in chain_of(rt, sid):
        out.extend(c | {"session_id": part} for c in checkpoints_of(events))
    return {"checkpoints": out}


def checkpoint_rewind(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    """``checkpoint.rewind {session_id, ship_id | null, dry_run?, expect_head?}`` (docs/specs/checkpoint-rewind.md
    section 3): files only in S0, so ``conversation: true`` is invalid."""
    from ..ship.rewind import rewind

    sid = session_id_of(params, session_id)
    if "ship_id" not in params:
        raise InvalidParamsError("ship_id is required (a kept ship's id, or null for before the session's changes)")
    ship_id = params["ship_id"]
    if ship_id is not None and (not isinstance(ship_id, str) or not ship_id):
        raise InvalidParamsError("ship_id must be a ship id or null", data={"found": repr(ship_id)})
    dry_run = params.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise InvalidParamsError("dry_run must be a boolean")
    expect = params.get("expect_head")
    if expect is not None and (not isinstance(expect, str) or not expect):
        raise InvalidParamsError("expect_head must be a ship id or a commit")
    if params.get("conversation", False) is not False:
        raise InvalidParamsError("rewinding the conversation is not available yet: only files can be rewound")
    rt = runtime()
    return rewind(rt, rt.state(sid), ship_id, dry_run=dry_run, expect_head=expect)


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
