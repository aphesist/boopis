"""What a mod asks the user: a permission, and the question `$.ui.ask` puts.

Both are forms (docs/FORMS.md) with the origin ``{kind: mod, plugin}``, so the card says whose request it is.
A permission is a ``permission`` form with two choices; closing it, cancelling it or letting it expire denies (fail
closed). The question is a ``choice`` form.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from ..errors import InvalidParamsError
from ..forms.presets import Draft
from .limits import limit

if TYPE_CHECKING:
    from .service import ModService, ModSession


def origin(plugin: str) -> dict[str, Any]:
    return {"kind": "mod", "plugin": plugin}


def _answer(
    svc: ModService, session: ModSession, draft: Draft, plugin: str, timeout_s: float
) -> Mapping[str, Any] | None:
    from ..forms.tools import service

    forms = service(svc.rt)
    form = forms.open(session.session_id, svc.rt.caller(session.session_id), draft, origin=origin(plugin))
    forms.wait(form, timeout_s)
    if form.status == "open":  # nobody answered in time: the form stays on screen, the call does not wait for ever
        forms.cancel(form.form_id, session_id=session.session_id)
        return None
    result = form.result or {}
    values = result.get("values")
    return values if form.status == "submitted" and isinstance(values, Mapping) else None


def ask_permission(
    svc: ModService, session: ModSession, plugin: str, call: str, subject: str, decision: Any
) -> str | None:
    """``"once"`` or ``"session"`` when the user allowed it, None when not. ``decision`` is the policy's ``approve``."""
    schema = {
        "type": "object",
        "properties": {
            "scope": {
                "type": "string",
                "title": "How long",
                "enum": ["once", "session"],
                "default": "once",
            }
        },
        "required": ["scope"],
    }
    draft = Draft(
        "permission",
        decision.message or f"{plugin} asks to use {call}",
        f"The mod {plugin} is asking for this. It is not part of Claude Code's prompt: boopis asks because the mod "
        f"runs in your session.",
        schema,
        submit={"label": "Allow"},
        cancel={"label": "Deny"},
    )
    values = _answer(svc, session, draft, plugin, float(limit("ask_timeout_s")))
    if values is None:
        return None
    return "session" if values.get("scope") == "session" else "once"


def ask_choice(svc: ModService, session: ModSession, plugin: str, args: Mapping[str, Any]) -> Any:
    """``$.ui.ask(question, { options, header, multi })``: the chosen label (an array with ``multi``), null if
    dismissed."""
    question = args.get("question")
    if not isinstance(question, str) or not question.strip() or len(question) > limit("text_chars"):
        raise InvalidParamsError("ask needs a question")
    raw = args.get("options") or []
    if not isinstance(raw, list) or len(raw) > 100:
        raise InvalidParamsError("options must be a list of at most 100 labels")
    options = [str(o.get("label") if isinstance(o, Mapping) else o) for o in raw]
    answer: dict[str, Any] = {"type": "string", "title": str(args.get("header") or "Answer")}
    if options:
        answer["enum"] = options
        if args.get("multi"):
            answer["x-multi"] = True
    schema = {"type": "object", "properties": {"answer": answer}, "required": ["answer"]}
    values = _answer(svc, session, Draft("choice", question, "", schema), plugin, float(limit("ask_timeout_s")))
    return None if values is None else values.get("answer")
