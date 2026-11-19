"""The convenience forms (docs/FORMS.md section 4): ``ask`` and ``request_credential`` build a full form from a few
arguments. One builder each, used by the plugin tools and by exec's harness, so the two cannot drift."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

from ..errors import InvalidParamsError
from .schema import MAX_ENUM, MAX_TEXT


@dataclass(frozen=True, slots=True)
class Draft:
    """A form not yet opened: what ``FormService.open`` takes."""

    kind: str
    title: str
    body: str
    schema: dict[str, Any]
    submit: dict[str, Any] = field(default_factory=dict)
    cancel: dict[str, Any] | None = None
    effect: dict[str, Any] | None = None  # what a submit does on the plugin's side; kept by the service, never sent out


def _text(value: Any, what: str, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise InvalidParamsError(f"{what} must be {'a non-empty ' if required else 'a '}string")
    if len(value) > MAX_TEXT:
        raise InvalidParamsError(f"{what} is longer than {MAX_TEXT} characters")
    return value


def ask(args: Mapping[str, Any]) -> Draft:
    """A ``question`` form: a free-text answer, or one or several of ``options`` (plus "Other" when ``other``)."""
    question = _text(args.get("question"), "question", required=True)
    raw = args.get("options") or []
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)) or len(raw) > MAX_ENUM:
        raise InvalidParamsError(f"options must be a list of at most {MAX_ENUM} strings")
    options = [_text(o, "an option", required=True) for o in cast("Sequence[Any]", raw)]
    answer: dict[str, Any] = {"type": "string", "title": _text(args.get("header"), "header") or "Answer"}
    if options:
        answer["enum"] = options
        if args.get("multi"):
            answer["x-multi"] = True
        if args.get("other"):
            answer["x-other"] = True
    schema = {"type": "object", "properties": {"answer": answer}, "required": ["answer"]}
    return Draft("question", question, _text(args.get("reason"), "reason"), schema)


_PART = re.compile(r"[^a-z0-9_.-]+")


def _slug(text: str) -> str:
    return _PART.sub("-", text.strip().lower()).strip("-.")[:60]


def credential(args: Mapping[str, Any]) -> Draft:
    """A ``credential`` form for a provider's API key (``provider``) or a service's token (``host``). The secret field
    names its reference, so the UI knows where the host stores it; the value never reaches the agent."""
    provider = _slug(_text(args.get("provider"), "provider"))
    host = _slug(_text(args.get("host"), "host"))
    if not provider and not host:
        raise InvalidParamsError("name the provider or the host the key is for")
    ref = f"secret://provider.{provider}/api_key" if provider else f"secret://host.{host}/token"
    what = provider or host
    label = "API key" if provider else "Token"
    schema = {
        "type": "object",
        "properties": {"value": {"type": "string", "title": label, "x-secret": True, "x-secret-ref": ref}},
        "required": ["value"],
    }
    title = _text(args.get("title"), "title") or f"Add your {what} {label.lower()}"
    reason = (
        _text(args.get("reason"), "reason") or f"Needed to call {what}. It is saved in your OS keychain, not in a file."
    )
    return Draft("credential", title, reason, schema, submit={"label": "Save"})


def open_args(args: Mapping[str, Any]) -> Draft:
    """The general form: ``kind``, ``title``, ``schema`` and optional ``body``, ``submit``, ``cancel``."""
    from .schema import KINDS

    kind = args.get("kind")
    if kind not in KINDS:
        raise InvalidParamsError(f"kind must be one of {sorted(KINDS)}", data={"found": repr(kind)})
    schema = args.get("schema")
    if not isinstance(schema, Mapping):
        raise InvalidParamsError("schema must be an object (MCP elicitation's requestedSchema)")
    submit, cancel = args.get("submit") or {}, args.get("cancel")
    if not isinstance(submit, Mapping) or (cancel is not None and not isinstance(cancel, Mapping)):
        raise InvalidParamsError("submit and cancel are objects like {label: 'Save'}")
    return Draft(
        str(kind),
        _text(args.get("title"), "title", required=True),
        _text(args.get("body"), "body"),
        dict(cast("Mapping[str, Any]", schema)),
        dict(cast("Mapping[str, Any]", submit)),
        dict(cast("Mapping[str, Any]", cancel)) if cancel is not None else None,
    )


def draft_for(args: Mapping[str, Any]) -> Draft:
    """The draft a tool call or a kernel request describes. ``preset`` picks a builder; none means the general form."""
    preset = args.get("preset")
    if preset == "ask":
        return ask(args)
    if preset == "credential":
        return credential(args)
    if preset is None:
        return open_args(args)
    raise InvalidParamsError(f"unknown preset {preset!r}")
