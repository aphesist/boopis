"""What a cell can ask of the owner: a blank, or a form.

A blank (``harness.leave_blank``) is the plugin's own flow: ``blank.opened`` in the ledger, the same event to
viewers, and the cell goes on (docs/PROTOCOL.md section 3). **Forms are a stub** until the forms flow lands
(docs/FORMS.md): the plugin validates the request, emits ``form.opened`` to viewers and records the call,
and answers ``{form_id, status: "pending"}``. Nothing yet stores the form, accepts ``form.submit`` or
delivers an answer, so ``wait`` is refused rather than faked. contraprova has no ``form.*`` ledger types yet
(they are added upstream, docs/LEDGER.md), so the call is recorded as ``tool.called`` with the ``form_id``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ..hooks import ledger_identity
from ..session import Caller, Runtime
from ..util.ids import uuid7
from .cell import CallFailure, Cell

FORM_KINDS = frozenset(
    {"credential", "question", "approval", "permission", "signin", "setup", "connector", "choice", "plan", "feedback"}
)
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


def _has_secret(schema: Mapping[str, Any]) -> bool:
    props = schema.get("properties")
    if not isinstance(props, Mapping):
        return False
    return any(isinstance(p, Mapping) and p.get("x-secret") is True for p in props.values())  # type: ignore[union-attr]


def open_form(rt: Runtime, caller: Caller, cell: Cell, params: Mapping[str, Any]) -> dict[str, Any]:
    """The forms stub: validate, announce ``form.opened``, answer pending. Never invents an answer."""
    kind = params.get("kind")
    if kind not in FORM_KINDS:
        raise CallFailure("hx.exec.invalid", f"kind must be one of {sorted(FORM_KINDS)}")
    if params.get("wait"):
        raise CallFailure(
            "hx.exec.unsupported",
            "wait=true is not available yet: forms are announced but not stored or answered by this plugin. "
            "Call without wait and keep working on what does not depend on the answer.",
        )
    title = _text(params.get("title"), "title")
    schema = params.get("schema")
    if not isinstance(schema, Mapping):
        raise CallFailure("hx.exec.invalid", "schema must be an object (MCP elicitation's requestedSchema)")
    form_id = uuid7()
    body = _text(params.get("body") or "", "body", required=False)
    event = {
        "form_id": form_id,
        "kind": kind,
        "title": title,
        "body": body,
        "schema": dict(schema),  # type: ignore[arg-type]
        "sensitive": kind == "credential" or _has_secret(schema),  # type: ignore[arg-type]
        "origin": "agent",
    }
    rt.ctx.emit_to_session(caller.state.session_id, "form.opened", event)
    cell.forms.append({"form_id": form_id, "kind": kind, "title": title})
    return {"form_id": form_id, "status": "pending"}
