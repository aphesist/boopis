"""What a worker is told, and what the next tier receives after a block.

The next tier gets **the same brief**, plus a section about the previous attempt: which tier failed, the
gate's own finding, the failing output (a tail, capped) and the rejected diff. Never the transcript:
contraprova's measured policy hands over findings, not conversations (``research/contraprova.md`` 3.3).

Unlike contraprova's Claude Code plugin, where the failed attempt's changes stay in the working tree, a
boopis gate failure *restores* the workspace byte for byte, so the rejected change is shown as a diff
and is not applied. The diff is made from the journal's originals and the files as the ship wrote them,
just before the restore.
"""

from __future__ import annotations

import difflib
from collections.abc import Mapping
from dataclasses import dataclass

from .brief import Brief


@dataclass(frozen=True, slots=True)
class Failure:
    """Everything known about one blocked attempt, as the next attempt will be told."""

    tier: str
    attempt: int
    gate: str  # the blocking gate, "T0.scope", "T0.visible_tests", ...
    reason: str
    output: str = ""  # the gate's failing output (contraprova already keeps the tail of it)
    diff: str = ""  # the rejected change as a unified diff; empty when nothing was written or it is unknown
    paths: tuple[str, ...] = ()  # the paths that broke scope, for a scope block
    scope_only: bool = False


_CONTRACT = """\
You are one attempt of a governed cascade: tier {number} of {count} ({tier}), attempt {attempt}. You were chosen by the system, not by the orchestrator, and a gate outside this conversation decides whether your work stands.

Rules:
- Change only files that match the scope below. If the job cannot be done inside it, stop and say so.
- Never edit, delete, rename or skip tests, test fixtures or CI configuration, even if a test looks wrong. Say so in your report instead.
- Read with `pack`. Write only with `ship`: send every edit of your change in one call. `ship` applies the edits, runs the project's pinned gate (its tests) and decides.
- If the gate fails, every file is restored exactly, you see the failing output, and your attempt is over: do not call `ship` again. A stronger tier takes over from your findings.
- If the gate passes, the change stands and your attempt is over.
- Finish with a short report (what you changed and why, or why you could not). The gate's verdict, not your report, is what counts.

Scope (the only paths you may change): {scope}
"""


def tail(text: str, limit: int) -> str:
    """The last ``limit`` characters of ``text``: the end of a test run is where the failure is."""
    return text if len(text) <= limit else "[...]\n" + text[-limit:]


def head(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + "\n[... diff truncated]"


def unified_diff(before: Mapping[str, str], after: Mapping[str, str]) -> str:
    """One unified diff over every path in either mapping; a path missing on one side is created or deleted."""
    parts: list[str] = []
    for path in sorted({*before, *after}):
        old, new = before.get(path, ""), after.get(path, "")
        if old == new:
            continue
        parts.extend(
            difflib.unified_diff(
                old.splitlines(keepends=True),
                new.splitlines(keepends=True),
                fromfile=f"a/{path}" if path in before else "/dev/null",
                tofile=f"b/{path}" if path in after else "/dev/null",
            )
        )
        if parts and not parts[-1].endswith("\n"):
            parts[-1] += "\n\\ No newline at end of file\n"
    return "".join(parts)


def failure_section(failure: Failure, output_chars: int, diff_chars: int) -> str:
    """``## Previous attempt failed``: the findings the next attempt starts from."""
    lines = [
        "## Previous attempt failed",
        f"Tier {failure.tier}, attempt {failure.attempt}, was blocked by the gate {failure.gate}: {failure.reason}",
    ]
    if failure.scope_only:
        lines.append(
            "Nothing else was checked: the change broke the scope or touched a protected file. "
            "The work itself may be fine. Do it again inside the scope"
            + (f" (the offending paths: {', '.join(failure.paths)})." if failure.paths else ".")
        )
    lines.append(
        "The workspace was restored to exactly what it was before that attempt, so nothing from it is applied."
    )
    if failure.output.strip():
        lines += ["", "### Gate output (tail)", tail(failure.output.strip(), output_chars)]
    if failure.diff.strip():
        lines += ["", "### The rejected change (not applied)", head(failure.diff.rstrip(), diff_chars)]
    return "\n".join(lines)


def worker_context(
    brief: Brief,
    *,
    tier: str,
    number: int,
    count: int,
    attempt: int,
    previous: Failure | None,
    output_chars: int,
    diff_chars: int,
) -> str:
    """The first message's context for a worker: the rules, the brief and, after a block, the findings."""
    contract = _CONTRACT.format(
        number=number, count=count, tier=tier, attempt=attempt, scope=", ".join(brief.scope)
    ).rstrip()
    parts = [contract, "## Brief", brief.text]
    if previous is not None:
        parts.append(failure_section(previous, output_chars, diff_chars))
    return "\n\n".join(parts)


def worker_goal(brief: Brief) -> str:
    """The task line of a worker's first message."""
    return brief.goal or "Carry out the brief below."
