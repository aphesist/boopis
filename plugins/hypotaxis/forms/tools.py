"""The agent's side of forms: the tools ``request_input``, ``request_credential`` and ``ask`` (docs/FORMS.md section 4).

Handlers take ``(args, **kw)`` and return a JSON string; they never raise. By default a call returns at once with
``{form_id, status: "pending"}`` and the agent keeps working; when the user answers, the answer is queued as the
agent's next message. ``wait=true`` blocks (bounded) and returns the answer inline. Passing ``form_id`` alone reads
an earlier form. A secret's value never appears in any of this: the answer carries ``{saved, ref}``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any

from ..errors import HypotaxisError
from . import presets
from .model import Form
from .service import FormService

NOTE_HEADER = "[hypotaxis: the user answered a form you opened]"
PENDING_NOTE = (
    "The form is open in the user's app. Keep working on whatever does not depend on the answer: when they answer, "
    "it arrives as your next message. Never ask for a secret in chat; credential forms are the way."
)


def service(rt: Any) -> FormService:
    """The runtime's form service, made on first use."""
    if rt.forms is None:
        rt.forms = FormService(rt)
    found: FormService = rt.forms
    return found


def answer_note(form: Form) -> str:
    """The message that tells a non-waiting agent its form was answered: the answer as data, never a secret."""
    body = json.dumps(form.result or {}, ensure_ascii=False, sort_keys=True)
    return f"{NOTE_HEADER} {form.title!r} (form_id {form.form_id}): {body}"


def agent_view(form: Form, *, waited: bool = False) -> dict[str, Any]:
    """What the agent is told about a form, in whatever state it is."""
    if form.status == "open":
        out: dict[str, Any] = {"form_id": form.form_id, "status": "pending", "kind": form.kind}
        out["note"] = "Still open after waiting. It stays open; read it later with form_id." if waited else PENDING_NOTE
        return out
    return dict(form.result or {"form_id": form.form_id, "status": form.status})


def _failure(exc: HypotaxisError) -> str:
    return json.dumps({"error": exc.message, "code": exc.code, **({"data": exc.data} if exc.data else {})})


def _run(args: Mapping[str, Any], kw: Mapping[str, Any], build: Callable[[Mapping[str, Any]], presets.Draft]) -> str:
    from ..hooks import runtime

    try:
        rt = runtime()
        session_id = str(kw.get("session_id") or "")
        if not session_id:
            return json.dumps({"error": "a form needs a session", "code": "hx.config.invalid"})
        svc = service(rt)
        earlier = args.get("form_id")
        if earlier is not None:
            return json.dumps(agent_view(svc.get(str(earlier), session_id=session_id)), ensure_ascii=False)
        wait = bool(args.get("wait"))
        timeout = svc.clamp_wait(args.get("timeout_s")) if wait else 0.0
        caller = rt.caller(session_id)
        form = svc.open(session_id, caller, build(args), deliver=not wait)
        if wait:
            svc.wait(form, timeout)
        return json.dumps(agent_view(form, waited=wait), ensure_ascii=False)
    except HypotaxisError as exc:
        return _failure(exc)
    except Exception as exc:  # noqa: BLE001 - a tool handler never raises into Hermes
        return json.dumps({"error": f"form failed: {type(exc).__name__}", "code": "hx.internal_error"})


def request_input_handler(args: Mapping[str, Any], **kw: Any) -> str:
    return _run(args, kw, presets.open_args)


def request_credential_handler(args: Mapping[str, Any], **kw: Any) -> str:
    return _run(args, kw, presets.credential)


def ask_handler(args: Mapping[str, Any], **kw: Any) -> str:
    return _run(args, kw, presets.ask)
