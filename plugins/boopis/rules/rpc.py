"""``plugin.boopis.rules.*`` (``docs/PROTOCOL.md`` section 3, capability ``rules-v1``): the rules engine's RPCs. None of
them writes ``rules.json``: the host is its only writer (its Tauri commands, from the window).

- ``rules.draft {session_id, description}``: "Always allow" on a card; the narrowest exception, written nowhere.
- ``rules.explain {bot, tool, args, cwd?}``: a dry check of one call (Settings' "Try it", the tests); makes no card. A
  reviewer call is made only with ``review: true``.
- ``rules.grant {session_id, parked_id, grant}``: the host's re-run of a parked step (section 8.3): the step may run
  once in that session. ``grant`` is a one-time owner grant, redeemed with the host (``grant.redeem``) before anything.
- ``rules.kinds {text}``: the reviewer's reading of a new rule's kinds, for the save dialog; decides and writes nothing.
- ``rules.reviewer.rank {}``: the connected models ranked by the cost of a standard check (the cheapest is the reviewer
  in ``auto`` mode); the unpriced ones listed apart.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from ..errors import InvalidParamsError, OwnerGrantRequiredError

CAPABILITY = "rules-v1"


def _runtime() -> Any:
    from ..hooks import runtime

    return runtime()


def rules_draft(params: Mapping[str, Any], *, session_id: str | None = None, **_: Any) -> dict[str, Any]:
    from .draft import draft
    from .store import read

    sid = params.get("session_id") or session_id
    description = params.get("description")
    if not isinstance(sid, str) or not sid:
        raise InvalidParamsError("session_id is required")
    if not isinstance(description, str) or not description.strip() or len(description) > 20_000:
        raise InvalidParamsError("description must be the card's text")
    doc = read(_runtime().root)
    return draft(sid, description, {r.text: r.id for r in doc.rules if r.type == "ask"})


def rules_explain(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from ..bots.rules import from_record
    from ..policy import SessionPolicy, ToolCall
    from ..policy.data import load_defaults
    from .gate import explain
    from .store import read

    bot, tool, args = params.get("bot"), params.get("tool"), params.get("args", {})
    if not isinstance(bot, str) or not bot or not isinstance(tool, str) or not tool or not isinstance(args, Mapping):
        raise InvalidParamsError("bot, tool and args are required")
    cwd = params.get("cwd")
    rt = _runtime()
    session = SessionPolicy(
        mode="ungoverned",
        cwd=cwd if isinstance(cwd, str) else "",
        bot=from_record(bot, None, None),
        hermes_root=str(rt.root),
    )
    doc = read(rt.root)
    found = explain(
        ToolCall(tool, cast("Mapping[str, Any]", args)),
        session,
        load_defaults(),
        doc,
        llm=rt.reviewer() if params.get("review") is True else None,
        redact=rt.redactor(),
    )
    return {
        "decision": "ask" if found.matched or found.held else "run",
        "rules": [{"id": i, "applies": a, "by": by} for i, (a, by) in found.verdicts.items()],
        "reviewed": found.reviewed,
        "held": found.held or None,
        "excepted": list(found.excepted),
    }


def rules_reviewer_rank(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .rank import rank

    rt = _runtime()
    book = rt.price_book(rt.load_settings().value)
    models = [(e.provider, e.model) for e in rt.roster.entries]
    return rank(book, models)


def rules_grant(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from ..hostops import HostOps, HostOpsError
    from .grants import install, parked_step

    sid, parked_id, grant = params.get("session_id"), params.get("parked_id"), params.get("grant")
    if not all(isinstance(v, str) and v for v in (sid, parked_id, grant)):
        raise InvalidParamsError("session_id, parked_id and grant are required")
    try:
        HostOps().ask("grant.redeem", {"grant": grant, "purpose": "rules.grant"}, key=f"rules.grant/{parked_id}")
    except HostOpsError as exc:
        raise OwnerGrantRequiredError(f"only the owner approves a parked step ({exc.code})") from None
    step = parked_step(_runtime().root, cast("str", parked_id))
    if step is None:
        raise InvalidParamsError("there is no such parked step")
    install(cast("str", sid), step)
    return {"ok": True, "tool": step.get("tool"), "action": step.get("action")}


def rules_kinds(params: Mapping[str, Any], **_: Any) -> dict[str, Any]:
    from .data import load
    from .kinds import read_kinds
    from .reviewer import ReviewerFailure
    from .store import read

    text = params.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 200 or "\n" in text:
        raise InvalidParamsError("text is the rule's one line, up to 200 characters")
    rt = _runtime()
    try:
        return {"kinds": read_kinds(rt.reviewer(), read(rt.root).reviewer, text, load())}
    except ReviewerFailure as exc:
        return {"kinds": None, "held": exc.reason}


HANDLERS = {
    "rules.draft": rules_draft,
    "rules.explain": rules_explain,
    "rules.reviewer.rank": rules_reviewer_rank,
    "rules.grant": rules_grant,
    "rules.kinds": rules_kinds,
}
