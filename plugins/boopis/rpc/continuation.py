"""Continuing one visible thread on a new engine session (ADR-0057, docs/specs/session-launch.md section 6.3).

A change of permissions across the Full access line, of folder, of skills or of toolsets cannot happen in place (the
toolsets and the system prompt are fixed at ``session.create``: prompt caching). The client creates a new engine
session with the new settings and arms it here with the parent's visible messages; the plugin renders the one block
the model reads (the client never writes model-facing text), cut to a budget, newest first, never a model-written
summary. The block rides on the new session's first user message (``pre_llm_call``'s context, as feedforward's): it
is persisted with that message and replayed on a resume, never the system prompt.

- ``continue.arm {session_id, parent_session_id, because, rows, budget?}``: before the new session's first prompt.
  Writes the link in the parent's ledger (``session.closed {reason: "continued", next_session_id}``) and, at the new
  session's first prompt, in its own ``session.opened`` (``parent_session_id``, ``continued``).
- ``continue.chain {session_id}``: the engine sessions of one thread, oldest first, walked back through the ledgers.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from ..errors import InvalidParamsError, ModeLockedError
from ..ledger import SessionLedger
from ..ledger.store import LedgerEvent
from ..util.log import get_logger

_log = get_logger("rpc.continuation")
BUDGET_DEFAULT = 16_000  # tokens (T3's number), estimated at CHARS_PER_TOKEN characters a token
BUDGET_MIN, BUDGET_MAX = 1_024, 64_000
CHARS_PER_TOKEN = 4
MAX_CHAIN = 64  # parts walked back; a longer chain is cut, never looped
MAX_BECAUSE = 8
ROLES = frozenset({"user", "assistant"})


def _sid(params: Mapping[str, Any], key: str, fallback: str | None = None) -> str:
    value = params.get(key) or fallback
    if not isinstance(value, str) or not value:
        raise InvalidParamsError(f"{key} is required")
    return value


def _read(rt: Any, session_id: str) -> list[LedgerEvent]:
    """A session's ledger events, read without making it a live session of this process."""
    path: Path = rt.ledger_path(session_id)
    if not path.exists():
        return []
    try:
        return SessionLedger(path).read()
    except Exception:  # noqa: BLE001 - an unreadable part ends the walk; it is said, never guessed past
        _log.warning("the ledger of %s could not be read", session_id, exc_info=True)
        return []


def _opened(events: Sequence[LedgerEvent]) -> Mapping[str, Any] | None:
    found = [e for e in events if e["type"] == "session.opened"]
    return found[-1]["payload"] if found else None


def chain_of(rt: Any, session_id: str) -> list[tuple[str, list[LedgerEvent]]]:
    """``[(session_id, events)]`` of the thread ``session_id`` ends, oldest first (itself last)."""
    out: list[tuple[str, list[LedgerEvent]]] = []
    seen: set[str] = set()
    sid: str | None = session_id
    while sid and sid not in seen and len(out) < MAX_CHAIN:
        seen.add(sid)
        events = rt.ledger(rt.state(sid)).read() if sid == session_id else _read(rt, sid)
        out.append((sid, events))
        opened = _opened(events)
        parent = opened.get("parent_session_id") if opened else None
        if parent is None and sid == session_id:
            link = rt.state(sid).continued
            parent = link.get("parent_session_id") if link else None
        sid = parent if isinstance(parent, str) else None
    out.reverse()
    return out


def render(
    parent: str, because: Sequence[str], rows: Sequence[Mapping[str, str]], ships: Sequence[str], budget: int
) -> tuple[str, int, int, int]:
    """The block, and how many messages it carried and left out, and its estimated tokens. Newest messages first
    until the budget is spent (each kept ship one line, counted first); what did not fit is counted, never
    invented."""
    limit = budget * CHARS_PER_TOKEN
    ship_lines = [f"ship {s}" for s in ships]
    used = sum(len(s) + 1 for s in ship_lines)
    kept: list[str] = []
    for row in reversed(rows):
        line = f"{row['role']}: {row['text']}"
        if used + len(line) + 1 > limit:
            break
        kept.append(line)
        used += len(line) + 1
    kept.reverse()
    omitted = len(rows) - len(kept)
    reason = "; ".join(because).replace('"', "'")
    head = f'<boopis-continued v="1" from="{parent}" because="{reason}">'
    body = [
        "This conversation continues an earlier session of the same thread; its settings changed, so it goes on in a "
        "new session. What was said there, oldest first:"
    ]
    if omitted:
        body.append(f"({omitted} earlier messages are not included; they stay in the thread above.)")
    body.extend(kept)
    if ship_lines:
        body.append("Changes kept there:")
        body.extend(ship_lines)
    text = "\n".join([head, *body, "</boopis-continued>"])
    return text, len(kept), omitted, max(1, len(text) // CHARS_PER_TOKEN)


def continue_arm(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    from ..hooks import runtime
    from .checkpoints import checkpoints_of, folder_of

    sid = _sid(params, "session_id", session_id)
    parent = _sid(params, "parent_session_id")
    if parent == sid:
        raise InvalidParamsError("a session cannot continue itself")
    because = params.get("because")
    if not isinstance(because, list) or not because or not all(isinstance(b, str) and b for b in because):
        raise InvalidParamsError("because must be a non-empty list of strings")
    rows_in = params.get("rows")
    if not isinstance(rows_in, list):
        raise InvalidParamsError("rows must be a list of {role, text}")
    rows: list[dict[str, str]] = []
    for i, row in enumerate(cast("list[Any]", rows_in)):
        if not isinstance(row, Mapping):
            raise InvalidParamsError(f"rows[{i}] must be an object")
        r = cast("Mapping[str, Any]", row)
        if r.get("role") not in ROLES or not isinstance(r.get("text"), str):
            raise InvalidParamsError(f"rows[{i}] must have role user or assistant and a text")
        rows.append({"role": str(r["role"]), "text": str(r["text"])})
    budget = params.get("budget", BUDGET_DEFAULT)
    if isinstance(budget, bool) or not isinstance(budget, int):
        raise InvalidParamsError("budget must be an integer number of tokens")
    budget = min(max(budget, BUDGET_MIN), BUDGET_MAX)
    rt = runtime()
    state = rt.state(sid)
    parent_events = _read(rt, parent) if parent != sid else []
    kept = checkpoints_of(parent_events)
    ships = [f"{c['ship_id']}: changed {', '.join(c['files'])}" for c in kept]
    text, carried, omitted, tokens = render(parent, [str(b) for b in because][:MAX_BECAUSE], rows, ships, budget)
    with state.lock:
        if state.locked:
            raise ModeLockedError(
                "the session has had its first prompt; a continuation is armed before it", data={"session_id": sid}
            )
        state.continued = {
            "parent_session_id": parent,
            "because": [str(b) for b in because][:MAX_BECAUSE],
            "messages_carried": carried,
            "messages_omitted": omitted,
            "tokens_est": tokens,
            "cwd": folder_of("", parent_events),
            "base_commit": kept[-1]["commit"] if kept else None,
        }
        state.continue_block = text
    _close_parent(rt, parent, sid)
    return {"armed": True, "messages_carried": carried, "messages_omitted": omitted, "tokens_est": tokens}


def _close_parent(rt: Any, parent: str, next_id: str) -> None:
    """``session.closed {reason: "continued", next_session_id}`` in the parent's ledger, once it has one."""
    events = _read(rt, parent)
    if not events or _opened(events) is None:
        return
    if any(e["type"] == "session.closed" and e["payload"].get("next_session_id") == next_id for e in events):
        return
    live = rt.state(parent)
    rt.ledger(live).append(
        "session.closed", "plugin", {"session_id": parent, "reason": "continued", "next_session_id": next_id}
    )


def continue_chain(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    from ..hooks import runtime

    sid = _sid(params, "session_id", session_id)
    rt = runtime()
    chain: list[dict[str, Any]] = []
    for part, events in chain_of(rt, sid):
        opened = _opened(events)
        found = [e for e in events if e["type"] == "session.opened"]
        cont = opened.get("continued") if opened else None
        chain.append(
            {
                "session_id": part,
                "opened_at": found[-1]["ts"] if found else None,
                "because": list(cast("Mapping[str, Any]", cont).get("because", []))
                if isinstance(cont, Mapping)
                else [],
                "cwd": opened.get("cwd") if opened else None,
            }
        )
    return {"chain": chain}
