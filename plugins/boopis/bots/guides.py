"""The hand-off skill: what a teammate is told about the shared kanban board.

A teammate in a room has the ``kanban`` tools but not the engine's task-worker guidance (the engine injects that only into a
worker the dispatcher started: ``agent/prompt_builder.py`` ``KANBAN_GUIDANCE``, ``agent/delegation_context.py``
``owned_kanban_task``). Nothing then tells it to look at the board first, to name a job's card the same way on every try, or to
order dependent cards with ``parents``. A retried or cut-off turn then files the same cards again, an ordered hand-off runs in
parallel (``kanban_link`` is refused once the child runs), and a bot works in the room and in a worker at once.

This file is a skill in the teammate's own ``skills/`` folder, the engine's own way to give a profile instructions. Its
``environments: [kanban]`` tag makes the engine offer it only to a profile that has the kanban toolset
(``agent/skill_utils.py`` ``skill_matches_environment``). The text is constant; the marker line says which version wrote it.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

NAME = "boopis-handoffs"
VERSION = 1
_MARK = re.compile(r"^<!-- boopis-managed: (\d+) -->$", re.MULTILINE)

TEXT = f"""\
---
name: {NAME}
description: Use before you create, link, block or hand off a kanban task, and before you start work a card may already cover. Stops duplicate cards, hand-offs that run out of order, and one bot working twice at once.
environments: [kanban]
---
<!-- boopis-managed: {VERSION} -->
# Handing work over on the board

Your turn can be cut off and tried again, and a teammate's worker may already be doing the job. Do these every time.

1. **Look before you create.** Call `kanban_list` (the assignee you would hand to, and your own cards) and read the titles. If a card for the job exists in any status but archived, use it: `kanban_comment` on it, or `kanban_unblock` it. Do this even when you remember nothing: an earlier turn of yours may have filed cards before it was stopped.
2. **Name the job in every `kanban_create`.** Pass `idempotency_key`, the same words on every attempt at the same job: `<room or job>/<step>/<what>`, lower case, for example `qa-round-2/iris/world-fixes`. The engine then returns the card that already exists instead of making a second one.
3. **Order with `parents`, never with prose.** Create the earlier card first and give its id in `parents` when you create the later one. "After iris's fixes" in a card body does not stop the dispatcher from starting both at once, and `kanban_link` is refused once the later card is running.
4. **One place for each hand-off.** When you give a card to a teammate, say in the room "filed <id> for <name>" and stop: do not also ask them in the room for the same work. If the board shows a card assigned to you, ready or running, for the job you were just asked in the room, say so and do not start it a second time: its worker is doing it.
5. **Duplicates.** `kanban_block` works only on a running or ready card. A `todo` duplicate is archived, not blocked. Leave a blocked card blocked and say why in a comment; do not file it again.
6. **Write down what you filed.** Put the ids you created in your reply ("filed t_ab12 for iris, t_cd34 for hex"), so the next turn, yours or a teammate's, sees them even if this one is cut off.
"""


def installed_version(path: Path) -> int | None:
    """The version marker of a skill file this module wrote; None for a file it did not write, or no file."""
    try:
        found = _MARK.search(path.read_text("utf-8"))
    except OSError:
        return None
    return int(found.group(1)) if found else None


def install(profile: Path) -> bool:
    """Write the hand-off skill into the teammate's ``skills/`` unless this version is there. True when it wrote.

    A file of that name that carries no marker is the user's own and is left alone."""
    target = profile / "skills" / NAME / "SKILL.md"
    if target.exists():
        have = installed_version(target)
        if have is None or have >= VERSION:
            return False
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".SKILL.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(TEXT)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return True
