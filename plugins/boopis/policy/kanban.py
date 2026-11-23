"""``kanban_create`` from a bot: one card per job, ordered by ``parents``, in the project's folder (ADR-0050, T1).

The hand-off skill (``bots/guides.py``) asks a bot to do all three; this makes them hold whether or not the bot read it.
A step of ``policy.check``, run when the rest of the policy allows the call, for a session that runs for a bot:

- **one card per job.** A room turn can be cut off and run again, and it then files its cards again. When a room turn's
  ``kanban_create`` has no ``idempotency_key``, boopis adds one derived from the room, the discussion (a digest of the
  owner's message that opened it, ``bots.origin``), the member and the title, so the engine returns the card that
  exists instead of a second one (``hermes_cli/kanban_db.py`` ``create_task``). A key the bot passed is kept: the skill
  tells it to name the job the same way on every try, across discussions too;
- **ordered with parents.** A card whose title or body says it waits for other work ("after iris's fixes", "depends
  on", "once ... is done") and names no ``parents`` is refused, with how to file it: the dispatcher starts a card
  without parents at once, whatever its text says;
- **in the project's folder** (B35). A card made without ``workspace_kind`` runs in a scratch folder under the board,
  whatever the board's ``default_workdir``. When the call names no workspace and the board has a folder, boopis passes
  ``workspace_kind: "dir"``, and the engine gives the card the board's folder.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

from .types import Decision, SessionPolicy, ToolCall, block

_FILE = Path(__file__).with_name("bot_tiers.json")
_SLUG = re.compile(r"[^a-z0-9]+")
_WORKSPACE_KEYS = ("workspace_kind", "workspace_path", "project", "project_id")


@lru_cache(maxsize=1)
def _data() -> tuple[tuple[re.Pattern[str], ...], int]:
    raw = cast("dict[str, Any]", json.loads(_FILE.read_text(encoding="utf-8")))["kanban"]
    return tuple(re.compile(p, re.IGNORECASE) for p in raw["depends_on"]), int(raw["key_max"])


def slug(text: str) -> str:
    return _SLUG.sub("-", text.lower()).strip("-")


def derived_key(session: SessionPolicy, title: str) -> str | None:
    """``room/<room>/<discussion>/<member>/<title>`` for a room turn's card, None when the turn is not a room's."""
    o = session.origin
    if o is None or o.kind != "room":
        return None
    member = o.handle or (session.bot.name if session.bot is not None else "")
    room = slug(o.room_id or o.room) or "room"
    what = slug(title)[:80] or hashlib.sha256(title.encode("utf-8")).hexdigest()[:12]
    key = "/".join(("room", room, o.discussion or "unknown", slug(member) or "member", what))
    return key[: _data()[1]]


def waits_for(args: Mapping[str, Any]) -> str | None:
    """The words of the card that say it waits for other work, or None."""
    text = " ".join(str(args.get(k) or "") for k in ("title", "body"))
    for pattern in _data()[0]:
        found = pattern.search(text)
        if found is not None:
            return found.group(0)
    return None


def decide(call: ToolCall, session: SessionPolicy) -> Decision | None:
    """The card as boopis files it (``modify``), a refusal, or None to leave the call as it is."""
    if call.tool != "kanban_create" or session.bot is None:
        return None
    args = call.args
    if not args.get("parents"):
        words = waits_for(args)
        if words is not None:
            return block(
                f"This card says it waits for other work (“{words}”) but names no `parents`, and the dispatcher starts "
                "a card without parents at once, whatever its text says. File the earlier card first (or find it with "
                "kanban_list or kanban_show), then pass its id in `parents`. Nothing was created.",
                "kanban_parents",
                "parents",
            )
    changes: dict[str, Any] = {}
    if not str(args.get("idempotency_key") or "").strip():
        key = derived_key(session, str(args.get("title") or ""))
        if key is not None:
            changes["idempotency_key"] = key
    if not any(args.get(k) not in (None, "") for k in _WORKSPACE_KEYS) and session.board_folder is not None:
        board = args.get("board")
        if session.board_folder(board if isinstance(board, str) and board else None):
            changes["workspace_kind"] = "dir"
    if not changes:
        return None
    # the whole arguments, not the change alone: the engine merges a partial ``modify``, but the exec kernel runs what a
    # ``modify`` names (``exec/calls.py``), so a partial one would lose the title
    return Decision("modify", args={**args, **changes}, reason="kanban", rule=",".join(sorted(changes)))
