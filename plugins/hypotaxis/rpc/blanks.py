"""``blank.fill``: the owner's answer to an open blank (docs/PROTOCOL.md section 3, docs/LEDGER.md).

A blank is opened by a cell (``harness.leave_blank``, ``exec/blanks.py``): ``blank.opened`` in the ledger and to
viewers, and the cell goes on. The answer is written as ``blank.filled`` (decided by the user), announced, and handed to
the model. Hermes's plugin context has no steering call, only ``ctx.inject_message``, which queues a user-role message
as the session's next turn and needs ``allow_gateway_injection``. So ``delivered`` says whether the model will see the
answer; when it is false the answer is still on the ledger, and the caller may send it as a normal message.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..errors import InvalidParamsError
from ..hooks import runtime
from ..ledger.store import LedgerEvent
from ..util.log import get_logger
from .checkpoints import session_id_of

MAX_ANSWER = 4000
HEADER = "[ANSWER TO YOUR OPEN QUESTION]"
_log = get_logger("rpc.blanks")


def open_blanks(events: Sequence[LedgerEvent]) -> dict[str, dict[str, Any]]:
    """The blanks still waiting for an answer, by id: opened, not filled. A lapsed blank is still open here: it
    became an end-of-turn question and can be answered."""
    waiting: dict[str, dict[str, Any]] = {}
    for event in events:
        payload = event["payload"]
        if event["type"] == "blank.opened":
            waiting[payload["blank_id"]] = payload
        elif event["type"] == "blank.filled":
            waiting.pop(payload["blank_id"], None)
    return waiting


def blank_fill(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    sid = session_id_of(params, session_id)
    blank_id, answer = params.get("blank_id"), params.get("answer")
    if not isinstance(blank_id, str) or not blank_id:
        raise InvalidParamsError("blank_id is required")
    if not isinstance(answer, str) or not answer.strip():
        raise InvalidParamsError("answer must be a non-empty string")
    if len(answer) > MAX_ANSWER:
        raise InvalidParamsError(f"answer is longer than {MAX_ANSWER} characters")
    rt = runtime()
    state = rt.state(sid)
    with state.lock:  # two answers to one blank must not both be written
        ledger = rt.ledger(state)
        blank = open_blanks(ledger.read()).get(blank_id)
        if blank is None:
            raise InvalidParamsError(f"no open blank {blank_id!r} in this session")
        event = ledger.append("blank.filled", "user", {"blank_id": blank_id, "answer": answer, "decided_by": "user"})
    stored = str(event["payload"]["answer"])  # as written (redacted), so the ledger and the viewers agree
    rt.ctx.emit_to_session(sid, "blank.filled", {"blank_id": blank_id, "answer": stored})
    return {"delivered": _hand_over(rt.ctx, str(blank.get("question", "")), stored)}


def _hand_over(ctx: Any, question: str, answer: str) -> bool:
    inject = getattr(ctx, "inject_message", None)
    if not callable(inject):
        return False
    try:
        return bool(inject(f"{HEADER}\nYou asked: {question}\nThe user answered: {answer}"))
    except Exception:  # noqa: BLE001 - not delivering is an answer, not a failure of the fill
        _log.warning("inject_message failed for a blank answer", exc_info=True)
        return False
