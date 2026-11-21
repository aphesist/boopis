"""Who answered each turn, and the one-turn exception to governed mode (ADR-0036).

**Who answered.** Hermes's transcript has no model column, so after a resume nothing says which model wrote which
reply. The plugin sees every model request (``post_api_request``: the real provider and model, also after a fallback),
so it keeps the turn's calls here, and the desktop binds them to the turn's stored rows when the turn completes
(``turns.bind``, with ``message.complete.persisted_turn``'s row ids). The book is one JSON line per turn, in a file
beside the session's ledger (``<ledger>.turns.jsonl``): the ledger's format is contraprova's, byte for byte, and gains
nothing for this. ``turns.models`` reads it back for a resume. A turn with no line is *unknown*; nothing is guessed.

**One ungoverned turn.** The owner's rule: an ``@model`` message in a governed session runs without governance, for that
message only. The mode and toolsets are fixed at the first prompt, so the plugin does not change them: it *arms* the
session (``mode.once``), and the next orchestrator turn is judged as ungoverned: no turn directive, the ungoverned
policy, ``ship`` without the governed gate rules. The session's mode never changes. The turn ends the exception,
whatever its outcome (``on_session_end`` fires for a completed, failed or interrupted turn); an armed session that is
never used lapses after ``ONCE_TTL_S``, and the desktop disarms it when it could not submit. Both edges are
``mode.changed`` events (``scope: turn``) in the ledger, so the audit trail shows the turn that skipped governance.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .errors import InvalidParamsError
from .util.log import get_logger

if TYPE_CHECKING:
    from .session import Runtime, SessionState

_log = get_logger("turns")
ONCE_TTL_S = 120.0  # an armed session that sends nothing for this long is governed again
MAX_BOOK = 5000
CONTEXT = (
    "[boopis] The person asked for this one message to be answered directly, outside governed mode: there is no "
    "cascade and no dispatch for it. Answer it yourself with your own tools (pack, exec, ship). The session is "
    "governed again from the next message."
)


@dataclass(slots=True)
class TurnTrack:
    """What one session's current turn has been so far (in memory; ``bind`` writes it down)."""

    armed_at: float | None = None
    active: bool = False  # the running turn is the ungoverned exception
    turn_id: str = ""
    calls: list[str] = field(default_factory=list)  # 'provider/model' of the session model's requests, in order
    route: list[str] = field(default_factory=list)  # the tiers the cascade's workers ran on, in order
    ungoverned: bool = False  # the turn being tracked was the exception (sticks until ``bind``)
    lock: threading.Lock = field(default_factory=threading.Lock)


def ref(provider: str, model: str) -> str:
    return f"{provider}/{model}" if provider else model


# ---------------------------------------------------------------- the exception


def arm(rt: Runtime, state: SessionState, armed: bool) -> bool:
    """``mode.once``: the next orchestrator turn runs ungoverned (``armed``), or the arming is withdrawn. Only a
    governed session has anything to suspend; an ungoverned one answers ``False``."""
    track = state.track
    with track.lock:
        if armed and state.mode == "governed":
            track.armed_at = time.monotonic()
            return True
        track.armed_at = None
    return False


def begin(rt: Runtime, state: SessionState, turn_id: str) -> bool:
    """A user turn of the orchestrator starts (``pre_llm_call``). True when it is the ungoverned exception."""
    track = state.track
    with track.lock:
        stale = track.active
        armed = track.armed_at is not None and time.monotonic() - track.armed_at <= ONCE_TTL_S
        track.armed_at = None
        track.active = armed and state.mode == "governed"
        track.turn_id = turn_id or track.turn_id
        if track.active:
            track.ungoverned = True
        active = track.active
    if stale:  # the last turn's end was never heard of: close its record before this one's opens
        _changed(rt, state, "ungoverned", "governed", "lost", track.turn_id)
    if active:
        _changed(rt, state, "governed", "ungoverned", "armed", turn_id)
    return active


def end(rt: Runtime, state: SessionState, reason: str) -> None:
    """The turn is over (``on_session_end``: completed, failed or interrupted): governed again."""
    track = state.track
    with track.lock:
        was = track.active
        track.active = False
    if was:
        _changed(rt, state, "ungoverned", "governed", reason, track.turn_id)


def _changed(rt: Runtime, state: SessionState, old: str, new: str, reason: str, turn_id: str) -> None:
    payload: dict[str, Any] = {"from": old, "to": new, "scope": "turn", "reason": reason}
    if new == "ungoverned":
        payload["gate"] = "skipped"
        payload["cascade"] = "skipped"
    if turn_id:
        payload["turn_id"] = turn_id
    try:
        rt.ledger(state).append("mode.changed", "plugin", payload)
    except Exception:  # noqa: BLE001 - an audit write that fails is logged loudly; it never runs a turn twice
        _log.error("mode.changed not recorded", exc_info=True)


# ---------------------------------------------------------------- who answered


def note_call(state: SessionState, *, provider: str, model: str, worker: str = "") -> None:
    """One model request of the turn: the session's own model, or a cascade worker's tier."""
    track = state.track
    with track.lock:
        if worker:
            if not track.route or track.route[-1] != worker:
                track.route.append(worker)
        elif model:
            track.calls.append(ref(provider, model))


def _ids(value: Any, name: str) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise InvalidParamsError(f"{name} must be a list of row ids")
    out: list[int] = []
    for v in value:
        if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
            raise InvalidParamsError(f"{name} must hold positive integers", data={"found": repr(v)})
        out.append(v)
    return out


def bind(rt: Runtime, state: SessionState, params: Mapping[str, Any]) -> dict[str, Any]:
    """``turns.bind``: the turn that just completed has these stored rows. Writes one line when the plugin saw the
    turn's model requests; otherwise the turn stays unknown."""
    row_ids = _ids(params.get("row_ids"), "row_ids")
    user_row = params.get("user_row_id")
    if user_row is not None and (isinstance(user_row, bool) or not isinstance(user_row, int) or user_row <= 0):
        raise InvalidParamsError("user_row_id must be a positive integer", data={"found": repr(user_row)})
    if user_row is not None and user_row not in row_ids:
        row_ids = [user_row, *row_ids]
    track = state.track
    with track.lock:
        calls, route, ungov, turn_id = list(track.calls), list(track.route), track.ungoverned, track.turn_id
        track.calls.clear()
        track.route.clear()
        track.ungoverned = track.active
    if not row_ids or not (calls or route):
        return {"recorded": False}
    answered = calls[-1] if calls else route[-1]
    record: dict[str, Any] = {
        "turn_id": turn_id,
        "model": answered,
        "route": route,
        "ungoverned": ungov,
        "user_row_id": user_row,
        "row_ids": row_ids,
        "at": time.time(),
    }
    try:
        path = book_path(rt, state)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError:
        _log.error("the turn's model was not recorded", exc_info=True)
        return {"recorded": False}
    return {"recorded": True}


def book_path(rt: Runtime, state: SessionState) -> Any:
    ledger = rt.ledger_path(state.session_id, state.settings)
    return ledger.with_name(ledger.name.removesuffix(".jsonl") + ".turns.jsonl")


def models(rt: Runtime, state: SessionState) -> dict[str, Any]:
    """``turns.models``: every recorded turn of the session, oldest first. Lines that do not parse are skipped."""
    out: list[dict[str, Any]] = []
    try:
        text = book_path(rt, state).read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"turns": []}
    except OSError:
        _log.error("the turn book could not be read", exc_info=True)
        return {"turns": []}
    for line in text.splitlines():
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict) and isinstance(item.get("model"), str) and isinstance(item.get("row_ids"), list):
            out.append(item)
    return {"turns": out[-MAX_BOOK:]}
