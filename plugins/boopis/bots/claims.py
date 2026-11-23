"""One bot, one body: a bot holds at most one claim on work at a time (ADR-0048, T1).

Work comes to a bot from several places that run at once: a room turn (in the gateway), a kanban card's worker (its own
process), a scheduled run, a forwarded message. Without a claim, one bot works in a room and in a worker at the same
time, two of them editing the same file (playtest B17, B18, B21, B31). So the turn that starts work takes the bot's
claim, and a turn of other work is refused while a live claim is held, unless the bot's record allows it to work in
parallel (``settings.parallel: on``). The owner's own chat with the bot takes no claim and is never refused: it is told
what else the bot is doing.

**Where.** One file per bot, ``<bot home>/boopis/claims/body.json``, because the holders are in different processes.
It is created with ``O_EXCL``, so of two turns that start together exactly one gets it. A claim names its work
(``room:<room>:<discussion>``, ``kanban:<card>``, ``cron:<session>``, ``a2a:<session>``): the same work claims again
freely (a member's next round in the same discussion, a card's next turn); other work waits until it is released.

**Release.** The turn's end (``on_session_end``), the session's end, a card's completion or block (the engine's
``kanban_task_completed`` and ``kanban_task_blocked`` hooks, in the worker), and a holder that is gone: a process that
no longer runs on this machine, or a claim older than ``MAX_AGE_S``. A claim that cannot be read is treated as held
(fail closed) until it is that old.
"""

from __future__ import annotations

import contextlib
import json
import os
import secrets
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

SCHEMA_VERSION = 1
MAX_AGE_S = 12 * 3600.0
CLAIM_FILE = ("boopis", "claims", "body.json")


@dataclass(frozen=True, slots=True)
class Claim:
    work: str
    session_id: str
    pid: int
    host: str
    at: float
    token: str
    label: str = ""

    def view(self) -> dict[str, Any]:
        """What viewers are told: the work (``claimed_by`` is the bot whose file this is), and since when."""
        return {"work": self.work, "label": self.label, "session_id": self.session_id, "since": self.at}


def claim_path(home: Path) -> Path:
    return home.joinpath(*CLAIM_FILE)


def _alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # it runs, as someone else
    except OSError:
        return False
    return True


def read(home: Path) -> Claim | str | None:
    """The claim held now: a ``Claim``, None when there is none, or a problem (a file that cannot be read)."""
    path = claim_path(home)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        return f"the claim file could not be read: {exc}"
    if not isinstance(doc, dict):
        return "the claim file is not an object"
    d = cast("dict[str, Any]", doc)
    try:
        return Claim(
            str(d["work"]),
            str(d["session_id"]),
            int(d["pid"]),
            str(d["host"]),
            float(d["at"]),
            str(d["token"]),
            str(d.get("label") or ""),
        )
    except (KeyError, TypeError, ValueError):
        return "the claim file is not a claim"


def stale(claim: Claim, now: float, host: str | None = None, alive: Callable[[int], bool] = _alive) -> bool:
    """A holder that is gone: too old, or a process of this machine that no longer runs."""
    if now - claim.at > MAX_AGE_S:
        return True
    return claim.host == (host or socket.gethostname()) and not alive(claim.pid)


@dataclass(frozen=True, slots=True)
class Outcome:
    """``held``: the claim is this turn's now. ``busy``: another live claim holds the bot (``by``)."""

    held: bool
    by: Claim | None = None
    problem: str = ""


def take(
    home: Path,
    work: str,
    session_id: str,
    label: str = "",
    *,
    now: float | None = None,
    pid: int | None = None,
    alive: Callable[[int], bool] = _alive,
) -> Outcome:
    """Take the bot's claim for ``work``, or say who holds it. The same work (or the same session) takes it again."""
    when = time.time() if now is None else now
    mine = Claim(
        work, session_id, os.getpid() if pid is None else pid, socket.gethostname(), when, secrets.token_hex(8), label
    )
    path = claim_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        if _create(path, mine):
            return Outcome(True, mine)
        held = read(home)
        if held is None:
            continue  # released in between: try again
        if isinstance(held, str):
            if _age(path, when) <= MAX_AGE_S:
                return Outcome(False, None, held)
            _replace(path, mine)
            return Outcome(True, mine)
        if held.work == work or held.session_id == session_id:
            _replace(path, mine)
            return Outcome(True, mine)
        if not stale(held, when, alive=alive):
            return Outcome(False, held)
        _replace(path, mine)  # the holder is gone
        return Outcome(True, mine)
    return Outcome(False, None, "the claim file kept changing")


def release(home: Path, *, session_id: str = "", work: str = "") -> bool:
    """Drop the claim when it is this session's or this work's. True when one was dropped."""
    held = read(home)
    if not isinstance(held, Claim):
        return False
    if (session_id and held.session_id == session_id) or (work and held.work == work):
        with contextlib.suppress(FileNotFoundError):
            claim_path(home).unlink()
        return True
    return False


def _doc(claim: Claim) -> bytes:
    return json.dumps(
        {
            "schema_version": SCHEMA_VERSION,
            "work": claim.work,
            "label": claim.label,
            "session_id": claim.session_id,
            "pid": claim.pid,
            "host": claim.host,
            "at": claim.at,
            "token": claim.token,
        },
        separators=(",", ":"),
    ).encode()


def _create(path: Path, claim: Claim) -> bool:
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(fd, "wb") as handle:
        handle.write(_doc(claim))
        handle.flush()
        os.fsync(handle.fileno())
    return True


def _replace(path: Path, claim: Claim) -> None:
    tmp = path.with_name(f".body-{claim.token}")
    tmp.write_bytes(_doc(claim))
    tmp.replace(path)


def _age(path: Path, now: float) -> float:
    try:
        return now - path.stat().st_mtime
    except OSError:
        return 0.0
