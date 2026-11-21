"""Who answered each turn, and the one-turn exception to governed mode (ADR-0036).

**Who answered.** Hermes's transcript has no model column, so after a resume nothing says which model wrote which
reply. The plugin sees every model request (``post_api_request``: the real provider and model, also after a fallback),
so it keeps the turn's calls here, and the desktop binds them to the turn's stored rows when the turn completes
(``turns.bind``, with ``message.complete.persisted_turn``'s row ids). The book is one JSON line per turn, in a file
beside the session's ledger (``<ledger>.turns.jsonl``): the ledger's format is contraprova's, byte for byte, and gains
nothing for this. ``turns.models`` reads it back for a resume. A turn with no line is *unknown*; nothing is guessed.

**What the turn showed.** The same line can also carry the council's member answers and the task cards the turn raised
(ADR-0034, ADR-0035): the engine keeps neither (references are side calls, children are live state), so the desktop
sends them in the same ``turns.bind`` and ``turns.models`` returns them, and a resume draws them again. They are
optional, bounded (``MEMBER_TEXT_MAX``, ``SUMMARY_MAX``: a cut is said with ``cut: true``) and never carry the engine's
error text: a member that failed is the state word and nothing else. A line without them reads as before.

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
# What a turn's line may hold of what it showed. A resume reads the whole book, so a line stays near 100 KB at worst
# (12 members of 6000 characters, 20 tasks of about 2000): enough to read an answer or a report in full for nearly every
# turn, and a cut is never silent (``cut: true``, which the UI says in words).
MAX_MEMBERS = 12
MEMBER_TEXT_MAX = 6000
MAX_CHILDREN = 20
SUMMARY_MAX = 1500
GOAL_MAX = 400
NAME_MAX = 200
MEMBER_STATES = frozenset({"waiting", "answered", "failed"})
CHILD_STATUSES = frozenset({"queued", "running", "done", "failed", "stopped"})
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


def _text(value: Any, limit: int) -> tuple[str, bool]:
    """A string cut to ``limit`` characters, and whether it was cut. Anything else is empty."""
    if not isinstance(value, str):
        return "", False
    return (value[:limit], True) if len(value) > limit else (value, False)


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _council(value: Any) -> dict[str, Any] | None:
    """The council a turn showed, as stored: ``{members: [{model, state, text, cut?}], combiner}``. A member that did
    not answer keeps its state word only: whatever text came with it is the engine's error, never stored. ``None`` when
    the value is not a council (the turn then has none, nothing is guessed)."""
    if not isinstance(value, Mapping) or not isinstance(value.get("members"), Sequence):
        return None
    members: list[dict[str, Any]] = []
    for m in value["members"][:MAX_MEMBERS]:
        if not isinstance(m, Mapping) or not isinstance(m.get("model"), str) or not m["model"]:
            continue
        state = m.get("state")
        if state not in MEMBER_STATES:
            continue
        text, cut = _text(m.get("text"), MEMBER_TEXT_MAX) if state == "answered" else ("", False)
        item: dict[str, Any] = {"model": m["model"][:NAME_MAX], "state": state, "text": text}
        if cut or (state == "answered" and m.get("cut") is True):
            item["cut"] = True
        members.append(item)
    combiner = value.get("combiner")
    return {"members": members, "combiner": combiner[:NAME_MAX] if isinstance(combiner, str) and combiner else None}


def _children(value: Any) -> list[dict[str, Any]] | None:
    """The task cards a turn raised, as stored: ``[{model, goal, status, summary, child_session_id, tool_count,
    duration_ms, cut?}]``. ``None`` when the value is not a list."""
    if not isinstance(value, Sequence) or isinstance(value, str):
        return None
    out: list[dict[str, Any]] = []
    for c in value[:MAX_CHILDREN]:
        if not isinstance(c, Mapping) or c.get("status") not in CHILD_STATUSES:
            continue
        summary, cut = _text(c.get("summary"), SUMMARY_MAX)
        goal, goal_cut = _text(c.get("goal"), GOAL_MAX)
        session = c.get("child_session_id")
        model = c.get("model")
        item: dict[str, Any] = {
            "model": model[:NAME_MAX] if isinstance(model, str) else "",
            "goal": goal,
            "status": c["status"],
            "summary": summary,
            "child_session_id": session[:NAME_MAX] if isinstance(session, str) else "",
            "tool_count": _count(c.get("tool_count")) or 0,
            "duration_ms": _count(c.get("duration_ms")),
        }
        if cut or goal_cut or c.get("cut") is True:
            item["cut"] = True
        out.append(item)
    return out


def bind(rt: Runtime, state: SessionState, params: Mapping[str, Any]) -> dict[str, Any]:
    """``turns.bind``: the turn that just completed has these stored rows. Writes one line when the plugin saw the
    turn's model requests; otherwise the turn stays unknown. ``council`` and ``children`` are what the turn showed
    beyond its answer; a malformed one is left out and the line is still written."""
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
    council = _council(params.get("council"))
    if council is not None:
        record["council"] = council
    children = _children(params.get("children"))
    if children:
        record["children"] = children
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
