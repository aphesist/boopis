"""The orchestrator's brief, read with contraprova's rules (``config/claude-code/scripts/gate.py``, ``parse_brief``).

Free text whose lines start ``scope: <comma-separated paths or globs>``, ``test: <command>`` and
``goal: <one or two sentences>``, then the approach. A line is ``^\\s*[-*]?\\s*(scope|test|goal)\\s*:\\s*(.*)$``,
case-insensitive, the first occurrence of each key wins, backticks are stripped, and the scope splits on
commas and whitespace.

**The test command is never taken from the brief.** The gate runs the project's own pinned, trusted command
(``gate.command``); a brief's ``test:`` line is read only so that the result can say it was ignored.
(Upstream has no importable parser, so the rules are restated here; they should move into contraprova.)
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_LINE = re.compile(r"^\s*[-*]?\s*(scope|test|goal)\s*:\s*(.*)$", re.IGNORECASE)
_SPLIT = re.compile(r"[,\s]+")


@dataclass(frozen=True, slots=True)
class Brief:
    """A brief that has a scope. ``text`` is what the worker is shown: the orchestrator's words without the
    ``test:`` line, which means nothing to a worker whose only check is the gate."""

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
    found: dict[str, str] = {}
    kept: list[str] = []
    for line in text.splitlines():
        match = _LINE.match(line)
        if match is None:
            kept.append(line)
            continue
        key, value = match.group(1).lower(), match.group(2).strip().strip("`")
        if key == "test" and "test" not in found:
            found["test"] = value
            continue  # not shown to the worker
        if key not in found:
            found[key] = value
        kept.append(line)
    scope = [_normalise(p) for p in _SPLIT.split(found.get("scope", "")) if p.strip().strip("`")]
    scope = [p for p in scope if p]
    problems: list[str] = []
    if not scope:
        problems.append("the brief has no 'scope:' line, so what the worker may change is unknown")
    problems += scope_problems(scope)
    if problems:
        return None, problems
    return Brief("\n".join(kept).strip(), tuple(scope), found.get("goal", ""), found.get("test") or None), []
