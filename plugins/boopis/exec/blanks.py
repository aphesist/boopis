"""What a cell can ask of the owner: a blank, or a form.

A blank (``harness.leave_blank``) is the plugin's own flow: ``blank.opened`` in the ledger, the same event to
viewers, and the cell goes on (docs/PROTOCOL.md section 3). A form (``harness.request_input``, ``ask``,
``request_credential``) is the forms plumbing's (``forms/``, docs/FORMS.md): the cell gets the same answers the tools
give, ``wait=True`` blocks the call (never longer than the cell may run), and the secret never reaches the cell.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..hooks import ledger_identity
from ..session import Caller, Runtime
from ..util.ids import uuid7
from .cell import CallFailure, Cell

MAX_TEXT = 4000
MAX_ITEMS = 50


def _text(value: Any, what: str, *, required: bool = True) -> str:
    if not isinstance(value, str) or (required and not value.strip()):
        raise CallFailure("hx.exec.invalid", f"{what} must be a non-empty string")
    if len(value) > MAX_TEXT:
        raise CallFailure("hx.exec.invalid", f"{what} is longer than {MAX_TEXT} characters")
    return value


def _strings(value: Any, what: str) -> list[str]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)) or len(value) > MAX_ITEMS:
        raise CallFailure("hx.exec.invalid", f"{what} must be a list of at most {MAX_ITEMS} strings")
    items: list[str] = [_text(v, f"{what} item") for v in value]
    return items


def open_blank(rt: Runtime, caller: Caller, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
    """``blank.opened``: written to the ledger first, then announced. Returns at once with the id."""
    question = _text(params.get("question"), "question")
    options = _strings(params.get("options") or [], "options")
    blocks = _strings(params.get("blocks") or [], "blocks")
    blank_id = uuid7()
    payload = {"blank_id": blank_id, "question": question, "options": options, "blocks": blocks}
    actor, tags = ledger_identity(caller)
    rt.ledger(caller.state).append("blank.opened", actor, {**payload, **tags, "via": "exec"})
    rt.ctx.emit_to_session(caller.state.session_id, "blank.opened", payload)
    cell.blanks.append({"blank_id": blank_id, "question": question})
    return {"blank_id": blank_id, "status": "open"}


def open_form(rt: Runtime, caller: Caller, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
    """Open a form for a cell and, with ``wait``, block until it is answered. Never invents an answer."""
    from ..errors import BoopisError
    from ..forms import presets
    from ..forms.tools import agent_view, service

    svc = service(rt)
    wait = bool(params.get("wait"))
    try:
        draft = presets.draft_for(params)
        timeout = (
            min(svc.clamp_wait(params.get("timeout_s")), rt.load_settings().value.exec.max_timeout_ms / 1000)
            if wait
            else 0.0
        )
        form = svc.open(caller.state.session_id, caller, draft, deliver=not wait)
    except BoopisError as exc:
        raise CallFailure(exc.code, exc.message, exc.data) from exc
    if wait:
        svc.wait(form, timeout)
    cell.forms.append({"form_id": form.form_id, "kind": form.kind, "title": form.title})
    return agent_view(form, waited=wait)
