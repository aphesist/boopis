"""The owner's defaults, given once to the bots that already exist (owner decisions, 23 November 2026; ADR-0050).

Two moves, each made once per bot and recorded, so a choice the owner makes afterwards is never overwritten:

- **tiers.** A record whose approvals are still exactly the switches boopis wrote when it made the bot (the six first
  kinds, every one on: "ask before everything") gets the default tiers of ``policy/bot_tiers.json`` written into it
  (network and commands Allow; deploys, push, spend, people, outside and delete Ask). Any other approvals were set by
  hand and stay as they are;
- **cap.** No bot has a limit unless the owner sets one. A cap that is still a default boopis wrote is removed: the
  first default, ``0.60``, and the ``5.00`` an earlier build of this move wrote (a bot that build looked at, still on
  ``5.00``). A cap set to anything else stays as it is.

The record of what was given is boopis's own file at the root, ``<root>/boopis/bot-defaults.json`` (``{schema_version,
tiers: [bot], caps: [bot], cap: [bot]}``), the way the host records the skills and toolsets it gives once
(``bot-skills.json``). ``tiers`` and ``caps`` list the bots each move looked at, moved or not, so each bot is looked at
once; ``cap`` is what the earlier build's move looked at, kept to tell the ``5.00`` it wrote from one set by hand. An
archived bot is left until it is restored. The move runs where the plugin first meets a bot: the roster read
(``bots.read``) and a bot's own turn.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from ..util.log import get_logger
from . import homes, store

_log = get_logger("bots.defaults")
SCHEMA_VERSION = 2
#: what boopis wrote as a new bot's approvals before tiers existed: the first six kinds, every one on
FIRST_APPROVALS: Mapping[str, bool] = dict.fromkeys(("deploys", "push", "network", "spend", "people", "outside"), True)
FIRST_CAP = "0.60"  # what boopis wrote as a new bot's cap before limits were the owner's to set
EARLIER_CAP = "5.00"  # what the earlier build of this move wrote (its record: ``cap``)
KEYS = ("tiers", "caps", "cap")
_LOCK = threading.Lock()


def given_path(root: Path) -> Path:
    return root / "boopis" / "bot-defaults.json"


def _load(root: Path) -> dict[str, set[str]]:
    try:
        doc = json.loads(given_path(root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        doc = {}
    data = cast("dict[str, Any]", doc) if isinstance(doc, dict) else {}
    out: dict[str, set[str]] = {}
    for key in KEYS:
        names = data.get(key)
        out[key] = {n for n in cast("list[Any]", names) if isinstance(n, str)} if isinstance(names, list) else set()
    return out


def _save(root: Path, given: Mapping[str, set[str]]) -> None:
    path = given_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"schema_version": SCHEMA_VERSION, **{k: sorted(given[k]) for k in KEYS}}
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".bot-defaults-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def default_tiers() -> dict[str, str]:
    from ..policy.tiers import load

    return dict(load().default)


def _default_cap(cap: Any, earlier: bool) -> bool:
    """A cap boopis wrote, not the owner: the first default, or the earlier build's ``5.00`` on a bot it looked at."""
    return cap == FIRST_CAP or (earlier and cap == EARLIER_CAP)


def give(root: Path, name: str, home: Path) -> dict[str, bool]:
    """Give the bot ``name`` the defaults it has not been given yet. ``{tiers, cap}``: which ones moved now (``cap``: a
    default cap was removed). Never raises: a bot whose record cannot be read or written is left, and looked at again
    next time."""
    moved = {"tiers": False, "cap": False}
    if homes.is_archived_name(name):
        return moved
    try:
        with _LOCK:
            given = _load(root)
            due = [k for k in ("tiers", "caps") if name not in given[k]]
            if not due:
                return moved
            record, problem = store.read(home)
            if problem is not None:
                return moved  # unreadable or newer: nothing is written, nothing is recorded
            doc: Mapping[str, Any] = record or {}
            if "tiers" in due and doc.get("approvals") == dict(FIRST_APPROVALS):
                store.update(home, approvals=default_tiers())
                moved["tiers"] = True
            settings = doc.get("settings")
            cap = settings.get("cap") if isinstance(settings, Mapping) else None
            if "caps" in due and _default_cap(cap, name in given["cap"]):
                store.update(home, settings={"cap": ""})
                moved["cap"] = True
            for key in due:
                given[key].add(name)
            _save(root, given)
    except Exception:  # noqa: BLE001 - a default not given now is given at the next look
        _log.error("the defaults were not given to %s", name, exc_info=True)
    return moved
