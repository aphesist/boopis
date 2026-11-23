"""The owner's new defaults, given once to the bots that already exist (owner decision, 23 November 2026; ADR-0048).

Two moves, each made once per bot and recorded, so a choice the owner makes afterwards is never overwritten:

- **tiers.** A record whose approvals are still exactly the switches boopis wrote when it made the bot (the six first
  kinds, every one on: "ask before everything") gets the default tiers of ``policy/bot_tiers.json`` written into it
  (network and commands Allow; deploys, push, spend, people, outside and delete Ask). Any other approvals were set by
  hand and stay as they are;
- **cap.** A record whose cap per run is still the first default, ``0.60``, gets ``5.00``. A cap set to anything else,
  or none, stays as it is.

The record of what was given is boopis's own file at the root, ``<root>/boopis/bot-defaults.json`` (``{schema_version,
tiers: [bot], cap: [bot]}``), the way the host records the skills and toolsets it gives once (``bot-skills.json``). A
bot is listed after it was looked at, moved or not, so it is looked at once. An archived bot is left until it is
restored. The move runs where the plugin first meets a bot: the roster read (``bots.read``) and a bot's own turn.
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
SCHEMA_VERSION = 1
#: what boopis wrote as a new bot's approvals before tiers existed: the first six kinds, every one on
FIRST_APPROVALS: Mapping[str, bool] = dict.fromkeys(("deploys", "push", "network", "spend", "people", "outside"), True)
FIRST_CAP = "0.60"
CAP = "5.00"
_LOCK = threading.Lock()


def given_path(root: Path) -> Path:
    return root / "boopis" / "bot-defaults.json"


def _load(root: Path) -> dict[str, set[str]]:
    try:
        doc = json.loads(given_path(root).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"tiers": set(), "cap": set()}
    data = cast("dict[str, Any]", doc) if isinstance(doc, dict) else {}
    out: dict[str, set[str]] = {}
    for key in ("tiers", "cap"):
        names = data.get(key)
        out[key] = {n for n in cast("list[Any]", names) if isinstance(n, str)} if isinstance(names, list) else set()
    return out


def _save(root: Path, given: Mapping[str, set[str]]) -> None:
    path = given_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"schema_version": SCHEMA_VERSION, **{k: sorted(v) for k, v in given.items()}}
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


def give(root: Path, name: str, home: Path) -> dict[str, bool]:
    """Give the bot ``name`` the defaults it has not been given yet. ``{tiers, cap}``: which ones moved now. Never
    raises: a bot whose record cannot be read or written is left, and looked at again next time."""
    moved = {"tiers": False, "cap": False}
    if homes.is_archived_name(name):
        return moved
    try:
        with _LOCK:
            given = _load(root)
            due = [k for k in ("tiers", "cap") if name not in given[k]]
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
            if "cap" in due and isinstance(settings, Mapping) and settings.get("cap") == FIRST_CAP:
                store.update(home, settings={"cap": CAP})
                moved["cap"] = True
            for key in due:
                given[key].add(name)
            _save(root, given)
    except Exception:  # noqa: BLE001 - a default not given now is given at the next look
        _log.error("the defaults were not given to %s", name, exc_info=True)
    return moved
