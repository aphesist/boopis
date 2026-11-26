""" "Always allow" drafts the narrowest exception (``docs/specs/rules-engine.md`` section 10). Writes nothing.

The UI sends the card's text (the plugin never learns the engine's ``prompt_id``); the plugin finds that session's
pending call whose card text matches (kept in memory a few minutes, ``rules.gate``), and returns a draft: one line of
text naming the program, the target and the folder, a deterministic ``match`` in the policy's rule grammar when the
call allows one (a terminal line: ``Bash(<the exact line>)``; a file tool: ``Write(<path>)``; an MCP tool: its name),
``match_cwd``, ``excepts`` (the matched rule ids) and ``bots`` (this bot). A card that is not found (a kanban or cron
worker's own process) gets a draft from its text alone, with no ``match``. The owner edits it and the host saves it; or
nothing is saved. The text is written here from the call, never by a model: the narrowest wording is the call itself.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .data import load
from .gate import Pending, pending_for

_RULE_LINE = re.compile(r"^Rule: “(.*)”$")
_BOT_LINE = re.compile(r"^(?P<bot>[A-Za-z0-9_.-]{1,64}) asks: ")


def _norm(text: str) -> str:
    return " ".join(text.split())


def _match_of(p: Pending) -> tuple[list[str], str]:
    command = p.args.get("command")
    if p.tool == "terminal" and isinstance(command, str) and command.strip() and "\n" not in command:
        return [f"Bash({_norm(command)})"], p.cwd
    path = p.args.get("path")
    if p.tool in ("write_file", "patch") and isinstance(path, str) and path:
        return [f"Write({path})" if p.tool == "write_file" else f"Edit({path})"], p.cwd
    if p.tool.startswith("mcp__"):
        return [p.tool], ""
    return [], ""


def _text_of(p: Pending, cut: int) -> str:
    command = p.args.get("command")
    folder = f" in {p.cwd}" if p.cwd else ""
    if isinstance(command, str) and command.strip():
        text = f"{p.bot} may run {_norm(command)}{folder}."
    elif isinstance(p.args.get("path"), str):
        text = f"{p.bot} may use {p.tool} on {p.args['path']}."
    else:
        text = f"{p.bot} may use {p.tool}{folder}."
    return text if len(text) <= cut else text[: cut - 1] + "…"


def draft(session_id: str, description: str, doc_rules: Mapping[str, str]) -> dict[str, Any]:
    """The draft for the card whose text is ``description``. ``doc_rules`` maps each rule's text to its id (to read a
    card raised elsewhere)."""
    t = load()
    cut = int(t.draft["max_text"])
    want = _norm(description)
    found = next((p for p in reversed(pending_for(session_id)) if _norm(p.message) == want), None)
    if found is None:  # the engine may cut or redact the text: the first line and the rule lines are enough
        lines = [line.strip() for line in description.splitlines() if line.strip()]
        head = lines[0] if lines else ""
        found = next((p for p in reversed(pending_for(session_id)) if _norm(p.summary) == _norm(head)), None)
    if found is not None:
        match, cwd = _match_of(found)
        out: dict[str, Any] = {
            "text": _text_of(found, cut),
            "excepts": list(found.rules),
            "bots": [found.bot],
        }
        if match:
            out["match"] = match
            if cwd:
                out["match_cwd"] = cwd
        return out
    lines = [line.strip() for line in description.splitlines() if line.strip()]
    bot = _BOT_LINE.match(lines[0]) if lines else None
    excepts = [doc_rules[m.group(1)] for line in lines if (m := _RULE_LINE.match(line)) and m.group(1) in doc_rules]
    action = lines[1] if len(lines) > 1 else ""
    who = bot.group("bot") if bot else "This bot"
    text = f"{who} may {action}." if action else f"{who} may do this."
    return {
        "text": text if len(text) <= cut else text[: cut - 1] + "…",
        "excepts": excepts,
        "bots": [bot.group("bot")] if bot else [],
    }
