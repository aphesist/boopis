"""``checkpoint.rewind``: a journaled, ungated ship behind an isolation guard (ADR-0058,
docs/specs/checkpoint-rewind.md).

Rewind to ship S puts every file the session's ships changed after S back to how it was right after S (to the base,
``ship_id: None``: how it was before the first kept ship). Files only: the conversation is not cut, and the model is
told on its next turn (a ``<boopis-rewound>`` block on its user message). It is the person's act, never a tool and
never a bot's verb: an RPC from an owner surface, confirmed in the client's dry-run sheet.

It is a ship: the hx transaction (validate, journal, apply), ``ship.applied`` with ``kind: "rewind"``, a checkpoint of
its own, so it is in ``checkpoint.list``, can be diffed, and can itself be rewound (its undo, and the redo that undo
gives). It is not gated: a failing gate must never trap the person in a bad state, and no ``gate.decided`` is written
because none ran. A ledger or checkpoint failure after the write restores the journal: a rewind that could not be
undone does not stand.

The guard: the folder is this session's own worktree (S1's records; none in S0), or nothing else changed it since the
session's last change, proven by the ``folder_digest`` recorded on the head checkpoint and no other live session
working there. Either way every path must still be as the session left it, checked by hx under its lock
(``expect_sha256``). Every refusal writes nothing.
"""

from __future__ import annotations

import base64
import hashlib
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ..errors import BoopisError, HxCallError, InvalidParamsError
from ..hx.types import ApplyParams, ApplyResult, DeleteEdit, JournalRef, PathsData, PutEdit, RecoverParams
from ..session import Runtime, SessionState
from ..util.proc import safe_env
from .checkpoint import CheckpointError, commit_checkpoint, parent_of, rev_of, run_git
from .common import T_APPLY, T_DISCARD, T_RESTORE, effective_protected, file_entries, log
from .digest import changed_since, folder_state, record_fields
from .recover import journal_dir

MAX_NAMED = 5
WORKING = "Rewind when this turn has finished."
MOVED = "This session changed since you looked; look again."
OTHER_FOLDER = "That change was made in another folder."
OTHER_SESSION = "Another session is working in this folder."
NEEDS = "Rewinding files needs this session's own worktree, or no other changes in this folder."


class Refused(Exception):
    """A rewind that does not run, with the words the person reads and the isolation verdict."""

    def __init__(self, why: str, isolation: str = "refused") -> None:
        super().__init__(why)
        self.why = why
        self.isolation = isolation


def owned_worktree(session_id: str, folder: str) -> bool:
    """Whether ``folder`` is this session's own worktree (S1's worktree records). No such record exists in S0."""
    del session_id, folder
    return False


def _named(paths: Sequence[str]) -> str:
    shown = ", ".join(paths[:MAX_NAMED])
    return shown + (f" and {len(paths) - MAX_NAMED} more" if len(paths) > MAX_NAMED else "")


def kept_in_folder(rt: Runtime, state: SessionState) -> list[dict[str, Any]]:
    """The kept ships of the session's thread (its continuation chain), oldest first, each with its ``session_id``,
    its folder and its ``checkpoint.committed`` payload."""
    from ..rpc.checkpoints import checkpoints_of, folder_of
    from ..rpc.continuation import chain_of

    out: list[dict[str, Any]] = []
    for part, events in chain_of(rt, state.session_id):
        folder = folder_of(state.cwd if part == state.session_id else "", events)
        committed = {e["payload"]["ship_id"]: e["payload"] for e in events if e["type"] == "checkpoint.committed"}
        for entry in checkpoints_of(events):
            out.append(entry | {"session_id": part, "folder": folder, "committed": committed.get(entry["ship_id"], {})})
    return out


def rewind_view(rt: Runtime, state: SessionState) -> dict[str, Any]:
    """``describe``'s ``rewind`` for a session: whether the action can be offered at all (the guard itself runs in
    the dry run, where it can name what it found). Unknown is ``ok: false`` with the reason."""
    if rt.hx_client() is None:
        return {"ok": False, "why": "the hx binary was not found, so nothing can be rewound"}
    if not state.cwd:
        return {"ok": False, "why": "the session's folder is not known yet"}
    try:
        run_git(Path(state.cwd), ["rev-parse", "--is-inside-work-tree"])
    except CheckpointError:
        return {"ok": False, "why": "the session's folder is not a git work tree, so it has no checkpoints"}
    if state.running:
        return {"ok": False, "why": WORKING}
    return {"ok": True}


def _blob(root: Path, commit: str, prefix: str, rel: str) -> tuple[str, bytes] | None:
    """``(mode, bytes)`` of ``rel`` (relative to the folder) in ``commit``, None when absent."""
    listed = run_git(root, ["ls-tree", "-z", "--full-tree", commit, "--", prefix + rel], strip=False)
    item = listed.split("\0")[0]
    if not item:
        return None
    meta, _ = item.split("\t", 1)
    mode, kind, sha = meta.split(" ")
    if kind != "blob" or mode not in ("100644", "100755"):
        raise Refused(f"{rel} is not a regular file in that checkpoint, so it cannot be rewound.")
    data = _bytes(root, sha)
    return mode, data


def _bytes(root: Path, sha: str) -> bytes:
    done = subprocess.run(  # noqa: S603 - a vector, no shell; the id comes from git's own ls-tree
        ["git", "-c", "core.fsmonitor=false", "cat-file", "blob", sha],  # noqa: S607 - as checkpoint.py's git
        cwd=root,
        env=safe_env(
            {"GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0", "GIT_CONFIG_NOSYSTEM": "1", "LC_ALL": "C"}
        ),
        capture_output=True,
        timeout=30,
        check=False,
    )
    if done.returncode != 0:
        raise CheckpointError(f"git cat-file failed: {done.stderr.decode('utf-8', 'replace').strip()[:200]}")
    return done.stdout


def _guard(rt: Runtime, state: SessionState, root: Path, head: Mapping[str, Any]) -> str:
    """The isolation verdict, or ``Refused``."""
    for other in rt.live_states():
        if other is state or other.cwd != state.cwd:
            continue
        if other.running or rt.cascades.active(other.session_id) is not None:
            raise Refused(OTHER_SESSION)
    if owned_worktree(state.session_id, state.cwd):
        return "own_worktree"
    committed = head.get("committed") or {}
    recorded = committed.get("folder_digest")
    if not isinstance(recorded, str):
        raise Refused(f"{NEEDS} This session's last change predates the record that proves it.")
    digest, now = folder_state(root)
    if digest != recorded:
        paths = changed_since(committed.get("folder_entries"), now)
        if paths:
            raise Refused(f"{NEEDS} Changed since this session's last change: {_named(paths)}.")
        if paths is not None:
            raise Refused(f"{NEEDS} A commit or a checkout was made in this folder since this session's last change.")
        raise Refused(f"{NEEDS} Files changed in this folder since this session's last change.")
    return "shared_unchanged"


def rewind(
    rt: Runtime, state: SessionState, ship_id: str | None, *, dry_run: bool = False, expect_head: str | None = None
) -> dict[str, Any]:
    """Run (or plan) a rewind. Returns the result shape of docs/specs/checkpoint-rewind.md section 3; a refusal is
    ``status: refused`` with ``why``, never an exception, and writes nothing."""
    try:
        return _rewind(rt, state, ship_id, dry_run, expect_head)
    except Refused as exc:
        return {"status": "refused", "isolation": exc.isolation, "why": exc.why, "files": []}
    except CheckpointError as exc:
        log.warning("rewind refused: %s", exc)
        return {
            "status": "refused",
            "isolation": "refused",
            "why": f"The checkpoints could not be read: {exc}",
            "files": [],
        }


def _rewind(
    rt: Runtime, state: SessionState, ship_id: str | None, dry_run: bool, expect_head: str | None
) -> dict[str, Any]:
    client = rt.hx_client()
    if client is None:
        raise Refused("The hx binary was not found, so nothing can be rewound.")
    if state.running or rt.cascades.active(state.session_id) is not None:
        raise Refused(WORKING)
    if not state.cwd or not Path(state.cwd).is_dir():
        raise Refused("The session's folder is not known, so nothing can be rewound.")
    root = Path(state.cwd)
    kept = kept_in_folder(rt, state)
    here = [k for k in kept if k["folder"] == state.cwd]
    if not here:
        return {
            "status": "nothing_to_do",
            "isolation": "refused",
            "files": [],
            "why": "This session has no kept change here.",
        }
    head = here[-1]
    if ship_id is None:
        target = parent_of(root, here[0]["commit"])
        if target is None:
            raise Refused("The first checkpoint has no parent commit to go back to.")
        rewind_to = "base"
    else:
        found = [k for k in kept if k["ship_id"] == ship_id]
        if not found:
            raise InvalidParamsError(f"no kept ship {ship_id!r} in this session")
        if found[-1]["folder"] != state.cwd:
            raise Refused(OTHER_FOLDER)
        target = found[-1]["commit"]
        rewind_to = ship_id
    if expect_head is not None and expect_head not in (head["ship_id"], head["commit"]):
        raise Refused(MOVED)
    raw = run_git(
        root, ["diff", "--name-only", "-z", "--no-renames", "--relative", target, head["commit"], "--"], strip=False
    )
    paths = sorted(p for p in raw.split("\0") if p)
    if not paths:
        return {
            "status": "nothing_to_do",
            "isolation": "shared_unchanged",
            "from_commit": head["commit"],
            "to_commit": target,
            "files": [],
        }
    isolation = _guard(rt, state, root, head)
    prefix = run_git(root, ["rev-parse", "--show-prefix"])
    edits: list[PutEdit | DeleteEdit] = []
    files: list[dict[str, str]] = []
    for rel in paths:
        want = _blob(root, target, prefix, rel)
        now = _blob(root, head["commit"], prefix, rel)
        expect = hashlib.sha256(now[1]).hexdigest() if now else "absent"
        if want is None:
            edits.append(DeleteEdit(path=rel, expect_sha256=expect if now else None))
            files.append({"path": rel, "action": "delete"})
        else:
            edits.append(
                PutEdit(path=rel, content_b64=base64.b64encode(want[1]).decode(), mode=want[0], expect_sha256=expect)
            )
            files.append({"path": rel, "action": "restore" if now else "recreate"})
    result: dict[str, Any] = {
        "isolation": isolation,
        "from_commit": head["commit"],
        "to_commit": target,
        "files": files,
    }
    if dry_run:
        return {"status": "planned", **result}
    return _apply(rt, state, client, root, edits, result, head, rewind_to)


def _apply(
    rt: Runtime,
    state: SessionState,
    client: Any,
    root: Path,
    edits: Sequence[PutEdit | DeleteEdit],
    result: dict[str, Any],
    head: Mapping[str, Any],
    rewind_to: str,
) -> dict[str, Any]:
    from ..ledger import ledger_filename

    journals = journal_dir(rt.home, ledger_filename(state.session_id).removesuffix(".jsonl"))
    protected = effective_protected(state)
    allowed = list(state.allowed) if state.allowed else None
    params = ApplyParams(
        root=str(root), journal_dir=str(journals), edits=list(edits), allowed=allowed, protected=protected
    )
    try:
        applied = ApplyResult.from_wire(client.request("txn.apply", params.to_wire(), timeout=T_APPLY))
    except HxCallError as exc:
        named = PathsData.from_wire(exc.data).paths if "paths" in exc.data else []
        if exc.code == "hx.txn.changed_since":
            raise Refused(f"{NEEDS} Changed since this session's last change: {_named(named)}.") from exc
        if exc.code in ("hx.txn.protected_path", "hx.txn.scope_violation"):
            what = "protected" if exc.code.endswith("protected_path") else "outside this session's scope"
            raise Refused(f"Nothing was rewound: these files are {what}: {_named(named)}.") from exc
        if exc.code == "hx.txn.workspace_busy":
            raise Refused("A change is being written in this folder; try again in a moment.") from exc
        raise Refused(f"Nothing was rewound: {exc.message}") from exc
    ship_id = applied.journal_id
    ref = JournalRef(journal_dir=str(journals), journal_id=ship_id, root=str(root))
    applied_written = False
    try:
        payload: dict[str, Any] = {
            "ship_id": ship_id,
            "files": file_entries(applied.files),
            "journal_id": ship_id,
            "kind": "rewind",
            "rewind_to": rewind_to,
            "from_commit": result["from_commit"],
            "to_commit": result["to_commit"],
            "decided_by": "user",
            "surface": state.surface,
        }
        if state.track.turn_id:
            payload["turn_id"] = state.track.turn_id
        rt.ledger(state).append("ship.applied", "user", payload)
        applied_written = True
        checkpoint = commit_checkpoint(root, state.session_id, applied.files, f"boopis rewind {ship_id} to {rewind_to}")
        rt.ledger(state).append(
            "checkpoint.committed",
            "plugin",
            {"ship_id": ship_id, "ref": checkpoint.ref, "commit": checkpoint.commit} | record_fields(root),
        )
    except (BoopisError, CheckpointError) as exc:
        _undo(rt, state, client, ref, ship_id, applied_written, str(exc))
        why = exc.message if isinstance(exc, BoopisError) else str(exc)
        raise Refused(f"Nothing was rewound: the change could not be recorded, so it was undone ({why}).") from exc
    try:
        client.request("txn.discard", ref.to_wire(), timeout=T_DISCARD)
    except BoopisError:
        log.warning("the rewind's journal %s was not discarded; the change stands", ship_id, exc_info=True)
    out = {
        "status": "rewound",
        **result,
        "rewind_ship_id": ship_id,
        "undo": {"ship_id": head["ship_id"]},
    }
    _notice(state, root, rewind_to, result)
    try:
        rt.ctx.emit_to_session(state.session_id, "checkpoint.rewound", dict(out))
    except Exception:  # noqa: BLE001 - the change stands; a client that missed it reads checkpoint.list
        log.warning("checkpoint.rewound not delivered", exc_info=True)
    return out


def _undo(
    rt: Runtime, state: SessionState, client: Any, ref: JournalRef, ship_id: str, written: bool, reason: str
) -> None:
    try:
        client.request("txn.restore", ref.to_wire(), timeout=T_RESTORE)
    except BoopisError:
        log.error(
            "the rewind %s could not be restored; recovery runs when the plugin next starts", ship_id, exc_info=True
        )
        try:
            client.request(
                "txn.recover", RecoverParams(journal_dir=ref.journal_dir, root=ref.root).to_wire(), timeout=60
            )
        except BoopisError:
            log.error("recovery of %s failed too", ship_id, exc_info=True)
        return
    if written:
        try:
            rt.ledger(state).append("ship.restored", "plugin", {"ship_id": ship_id, "reason": reason[:500]})
        except BoopisError:
            log.error("ship.restored not recorded for the rewind %s", ship_id)


def _tree(root: Path, commit: str) -> str | None:
    return rev_of(root, commit) and run_git(root, ["rev-parse", f"{commit}^{{tree}}"])


def _notice(state: SessionState, root: Path, rewind_to: str, result: Mapping[str, Any]) -> None:
    """Arm the model's notice for its next turn: one block naming the final state; a rewind back to what the model
    last saw (an undo before any turn) cancels it."""
    notice = state.rewound
    base = notice["base"] if notice else result["from_commit"]
    try:
        back = _tree(root, base) == _tree(root, result["to_commit"])
    except CheckpointError:
        back = False
    if back:
        state.rewound = None
        return
    names = sorted({*(notice["files"] if notice else []), *(f["path"] for f in result["files"])})
    state.rewound = {"base": base, "to": rewind_to, "files": names}


def notice_text(notice: Mapping[str, Any]) -> str:
    to = str(notice["to"])
    where = "before this session's changes" if to == "base" else f"after {to}"
    names: list[str] = list(notice["files"])
    undone = ", ".join(names[:10]) + (f" (and {len(names) - 10} more)" if len(names) > 10 else "")
    return (
        f'<boopis-rewound v="1" to="{to}">Files were put back to how they were {where}. Undone: {undone}. '
        "Read them again before editing.</boopis-rewound>"
    )
