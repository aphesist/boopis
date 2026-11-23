"""A bot's own rules, read where the plugin runs for it.

The engine serves every profile from one gateway, and each bot's home loads its own copy of this plugin (ADR-0042). A
hook or a tool call runs in the context of the profile whose turn it is, so ``hermes_home()`` there is the bot's home
and ``<home>/boopis/bot.json`` (``store``) is its record: the cap per run, what it asks before, whether it may work on
several things at once. The root profile is the owner's own home and has no record: none of this applies to it.

The record is read again when it changes on disk (its modification time and size are the cache key), so a cap or a tier
the owner changes applies from the next check, without a restart and without touching the session's prompt or tools.

**Fail closed.** A record that cannot be read, or that a newer boopis wrote, is a ``problem``: the plugin then refuses
the bot's turns and says why (``hooks.pre_llm_call``), and every tier reads as Ask. An approval value it does not know
reads as Ask. A missing record is not a problem: the bot then runs with no cap of its own and the default tiers.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

from . import store

Tier = Literal["allow", "ask", "block"]
TIERS: tuple[Tier, ...] = ("allow", "ask", "block")
_CAP = re.compile(r"^\d{1,4}(\.\d{1,4})?$")


@dataclass(frozen=True, slots=True)
class BotRules:
    """What the record of one bot says, as the gates read it. ``approvals`` maps a category id (``network``) or a tool
    name (``mcp__fetch__fetch``, ``mcp__fetch``) to a tier; an old switch reads as Ask when on and Allow when off."""

    name: str
    cap_usd: float | None = None
    approvals: Mapping[str, Tier] = field(default_factory=dict)
    parallel: bool = False  # may hold more than one claim on work at a time (``bots.claims``)
    preset: str = ""  # a named set of default tiers (``bots/data/tiers.json``), empty for the plain defaults
    problem: str = ""  # the record could not be trusted: the bot does not run until it is fixed


_CACHE: dict[str, tuple[tuple[int, int] | None, BotRules]] = {}
_LOCK = threading.Lock()


def bot_name(home: Path, root: Path) -> str | None:
    """The bot this home is (``<root>/profiles/<name>``), or None for the root profile and anything else."""
    try:
        here, base = home.resolve(), root.resolve()
    except OSError:
        return None
    if here == base or here.parent != base / "profiles":
        return None
    return here.name


def rules_for(home: Path, root: Path) -> BotRules | None:
    """The rules of the bot whose home this is, None for the owner's own profile. Never raises."""
    name = bot_name(home, root)
    if name is None:
        return None
    path = store.record_path(home)
    try:
        info = path.stat()
        stamp: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
    except FileNotFoundError:
        stamp = None
    except OSError as exc:
        return BotRules(name, problem=f"bot.json could not be read: {exc}")
    key = str(path)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None and hit[0] == stamp:
            return hit[1]
    record, problem = store.read(home)
    rules = from_record(name, record, problem)
    with _LOCK:
        _CACHE[key] = (stamp, rules)
    return rules


def tier_of(value: Any) -> Tier:
    """A stored approval value as a tier: an old switch (on: Ask, off: Allow) or a tier word. Anything else asks."""
    if value is True:
        return "ask"
    if value is False:
        return "allow"
    return value if value in TIERS else "ask"


def from_record(name: str, record: Mapping[str, Any] | None, problem: str | None) -> BotRules:
    if problem:
        return BotRules(name, problem=problem)
    doc: Mapping[str, Any] = record or {}
    settings = doc.get("settings")
    settings = cast(Mapping[str, Any], settings) if isinstance(settings, Mapping) else {}
    cap: float | None = None
    raw_cap = settings.get("cap")
    if raw_cap is not None:
        if not isinstance(raw_cap, str) or not _CAP.match(raw_cap):
            return BotRules(name, problem=f"bot.json has a cap that is not dollars: {raw_cap!r}")
        cap = float(raw_cap)
    approvals = doc.get("approvals")
    tiers: dict[str, Tier] = (
        {str(k): tier_of(v) for k, v in cast(Mapping[str, Any], approvals).items()}
        if isinstance(approvals, Mapping)
        else {}
    )
    preset = settings.get("preset")
    return BotRules(
        name,
        cap_usd=cap,
        approvals=tiers,
        parallel=settings.get("parallel") == "on",
        preset=preset if isinstance(preset, str) else "",
    )


def forget_cache() -> None:
    """Tests: read every record again."""
    with _LOCK:
        _CACHE.clear()
