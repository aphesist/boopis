"""The orchestrator's brief, read by contraprova's own parser (``contracts.parse_brief``, vendored).

Free text whose lines start ``scope: <comma-separated paths or globs>``, ``test: <command>`` and
``goal: <one or two sentences>``, then the approach; contraprova's rules decide what counts as a line, which
occurrence wins and how the scope splits. This module only adds what the plugin needs around them: a scope is
required, entries must be project-relative, a directory means everything under it, and the size is bounded.

**The test command is never taken from the brief.** The gate runs the project's own pinned, trusted command
(``gate.command``); a brief's ``test:`` line is read only so that the result can say it was ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .._vendor.contraprova.contracts import parse_brief as cp_parse_brief


@dataclass(frozen=True, slots=True)
class Brief:
    """A brief that has a scope. ``text`` is what the worker is shown: the scope and goal lines and the approach,
    without the ``test:`` line, which means nothing to a worker whose only check is the gate."""

    text: str
    scope: tuple[str, ...]
    goal: str
    ignored_test: str | None  # what the brief's ``test:`` line said; it is never used

    @property
    def title(self) -> str:
        """A one-line name for the ledger's ``task.created``."""
        first = self.goal or next((ln.strip() for ln in self.text.splitlines() if ln.strip()), "")
        return first[:200]


def _normalise(entry: str) -> str:
    entry = entry.strip().strip("`")
    while entry.startswith("./"):
        entry = entry[2:]
    return entry + "**" if entry.endswith("/") else entry  # a directory means everything under it


def scope_problems(entries: list[str]) -> list[str]:
    """Why a scope entry is not a project-relative path or glob."""
    out: list[str] = []
    for entry in entries:
        parts = entry.replace("\\", "/").split("/")
        if entry.startswith(("/", "~")) or re.match(r"^[A-Za-z]:", entry) or ".." in parts:
            out.append(f"scope entry {entry!r} is not a project-relative path")
    return out


def parse_brief(text: str, max_chars: int) -> tuple[Brief | None, list[str]]:
    """``(brief, [])`` or ``(None, problems)``. A brief needs a ``scope:`` line with at least one entry."""
    if not text.strip():
        return None, ["the brief is empty"]
    if len(text) > max_chars:
        return None, [f"the brief is {len(text)} characters; the limit is {max_chars}. Shorten it."]
    parsed = cp_parse_brief(text)
    scope = [e for e in (_normalise(p) for p in parsed.scope or []) if e]
    problems: list[str] = []
    if not scope:
        problems.append("the brief has no 'scope:' line, so what the worker may change is unknown")
    problems += scope_problems(scope)
    if problems:
        return None, problems
    goal = parsed.goal or ""
    shown = "\n".join(
        part for part in (f"scope: {', '.join(scope)}", f"goal: {goal}" if goal else "", parsed.body) if part
    )
    return Brief(shown, tuple(scope), goal, parsed.test), []
