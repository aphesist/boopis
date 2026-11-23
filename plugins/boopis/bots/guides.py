"""The hand-off skill: what a teammate is told about the shared kanban board.

A teammate in a room has the ``kanban`` tools but not the engine's task-worker guidance (the engine injects that only into a
worker the dispatcher started: ``agent/prompt_builder.py`` ``KANBAN_GUIDANCE``, ``agent/delegation_context.py``
``owned_kanban_task``). Nothing then tells it to look at the board first, to name a job's card the same way on every try, or to
order dependent cards with ``parents``. A retried or cut-off turn then files the same cards again, an ordered hand-off runs in
parallel (``kanban_link`` is refused once the child runs), and a bot works in the room and in a worker at once.

This file is a skill in the teammate's own ``skills/`` folder, the engine's own way to give a profile instructions. Its
``environments: [kanban]`` tag makes the engine offer it only to a profile that has the kanban toolset
(``agent/skill_utils.py`` ``skill_matches_environment``), a worker the dispatcher started among them. The text is constant;
the marker line says which version wrote it. The host gives it to every bot when it prepares one (``bots::prepare``, at
creation and at the start-up repair), through ``bots.guide``.

What the text relies on, read in the engine (v0.23.2):
- ``kanban_list`` and ``kanban_unblock`` are hidden from a dispatcher-started worker (``tools/kanban_tools.py``
  ``_ORCHESTRATOR_TOOLS``), so a worker looks at its own card with ``kanban_show`` instead.
- ``kanban_create`` returns the card that already holds an ``idempotency_key`` unless it is archived
  (``hermes_cli/kanban_db.py`` ``create_task``).
- ``kanban_block`` takes only a running or ready card, and no tool archives one.
- A card made with ``workspace_kind: "dir"`` and no ``workspace_path`` gets the board's ``default_workdir``; with no
  ``workspace_kind`` it runs in a scratch folder under the board (``create_task``, ``kanban_db_workspace.resolve_workspace``).
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path

NAME = "boopis-handoffs"
VERSION = 4
_MARK = re.compile(r"^<!-- boopis-managed: (\d+) -->$", re.MULTILINE)

TEXT = f"""\
---
name: {NAME}
description: Use before you create, link, block or hand off a kanban task, and before you start work a card may already cover. Stops duplicate cards, hand-offs that run out of order or outside the project's folder, and one bot working twice at once.
environments: [kanban]
---
<!-- boopis-managed: {VERSION} -->
# Handing work over on the board

Your turn can be cut off and tried again, and a worker, a teammate's or your own, may already be doing the job. Do these every time.

1. **Look before you create.** In a room or a chat, call `kanban_list` (the assignee you would hand to, and your own cards) and read the titles. If a card for the job exists in any status but archived, use it: `kanban_comment` on it, or `kanban_unblock` it. Do this even when you remember nothing: an earlier turn of yours may have filed cards before it was stopped. A worker running one card has no `kanban_list`: call `kanban_show` on your own card and read its children before you create one.
2. **Name the job in every `kanban_create`.** Pass `idempotency_key`, the same words on every attempt at the same job: `<room or job>/<step>/<what>`, lower case, for example `qa-round-2/iris/world-fixes`. The engine then returns the card that already exists instead of making a second one.
3. **Order with `parents`, never with prose.** Create the earlier card first and give its id in `parents` when you create the later one. "After iris's fixes" in a card body does not stop the dispatcher from starting both at once, and `kanban_link` is refused once the later card is running.
4. **Work in the project's folder.** For work on a project's files, pass `workspace_kind: "dir"` in `kanban_create` and `workspace_path` set to that folder's absolute path (your project folder, the one you start in, or the one your instructions name). On a board that has its own folder you may leave `workspace_path` out: the card then gets the board's folder. A card made without `workspace_kind` runs in an empty scratch folder, not in the project.
5. **One place for each hand-off.** When you give a card to a teammate, say in the room "filed <id> for <name>" and stop: do not also ask them in the room for the same work. Before you start work you were asked for in a room, look at your own cards: if one for that job is todo, ready or running, say so ("t_ab12 covers it; my worker does it") and do not do it a second time.
6. **Duplicates.** `kanban_block` takes only a running or ready card, and there is no tool that archives one. On a todo duplicate, `kanban_comment` "duplicate of <id>" and tell the owner in the room; the owner archives it. Leave a blocked card blocked and say why in a comment; do not file it again.
7. **Write down what you filed.** Put the ids you created in your reply ("filed t_ab12 for iris, t_cd34 for hex"), so the next turn, yours or a teammate's, sees them even if this one is cut off.
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
