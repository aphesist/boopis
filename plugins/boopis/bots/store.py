"""A teammate's own store: ``<profile>/boopis/bot.json``.

What boopis knows about a teammate that Hermes has no place for: its look (the orb: shape, colour, eyes) and boopis's
settings for it. Never a Hermes key, and never in ``config.yaml``. Versioned, written atomically (temp file, fsync,
rename), one file per teammate, so it travels with the profile when Hermes renames, exports or imports it.

Reads never raise: a missing or unreadable file is "no record yet" (the UI then draws the teammate with a look derived
from its name). Keys this version does not know are kept as they are on a write.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

from ..errors import InvalidParamsError

SCHEMA_VERSION = 1
MAX_BYTES = 64 * 1024
GOVERNANCE = ("governed", "ungoverned")
WORKSPACES = ("worktree", "sandbox")
_WORD = re.compile(r"^[a-z0-9][a-z0-9 -]{0,31}$")  # an orb2 shape or eye name
_COLOUR = re.compile(r"^#[0-9a-fA-F]{6}$")
_CAP = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
# what a teammate may do: a category id (``network``) or a tool name (``mcp__fetch__fetch``, ``mcp__fetch``), mapped to
# a tier (``allow``, ``ask``, ``block``) or, as the first switches were, on (Ask) or off (Allow); ADR-0048
_APPROVAL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
TIER_WORDS = ("allow", "ask", "block")
MAX_APPROVALS = 64
_LOCKS: dict[str, threading.Lock] = {}


class _Keep:
    """The default of ``update``'s ``archived``: leave it as it is (``None`` clears it)."""


KEEP = _Keep()
_GUARD = threading.Lock()


def record_path(profile: Path) -> Path:
    return profile / "boopis" / "bot.json"


def _lock(path: Path) -> threading.Lock:
    with _GUARD:
        return _LOCKS.setdefault(str(path), threading.Lock())


def _mapping(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise InvalidParamsError(f"{where} must be an object", data={"found": repr(value)})
    return dict(cast("Mapping[str, Any]", value))


def clean_look(raw: Any) -> dict[str, str]:
    """The orb's look, each field optional on a patch: ``{shape, color, eyes}``."""
    look = _mapping(raw, "look")
    out: dict[str, str] = {}
    for key in ("shape", "eyes"):
        if key in look:
            value = look[key]
            if not isinstance(value, str) or not _WORD.match(value):
                raise InvalidParamsError(f"look.{key} is a short lower case name", data={"found": repr(value)})
            out[key] = value
    if "color" in look:
        value = look["color"]
        if not isinstance(value, str) or not _COLOUR.match(value):
            raise InvalidParamsError("look.color is a colour like #4fc9a8", data={"found": repr(value)})
        out["color"] = value.lower()
    unknown = set(look) - {"shape", "eyes", "color"}
    if unknown:
        raise InvalidParamsError("look has only shape, color and eyes", data={"found": sorted(unknown)})
    return out


def clean_settings(raw: Any) -> dict[str, str]:
    """boopis's settings for the teammate: ``{gov, cap, workspace, preset}``, each optional on a patch. ``preset``
    names a set of default tiers (``policy/bot_tiers.json``); an empty one clears it."""
    settings = _mapping(raw, "settings")
    out: dict[str, str] = {}
    if "gov" in settings:
        if settings["gov"] not in GOVERNANCE:
            raise InvalidParamsError(
                "settings.gov is 'governed' or 'ungoverned'", data={"found": repr(settings["gov"])}
            )
        out["gov"] = settings["gov"]
    if "workspace" in settings:
        if settings["workspace"] not in WORKSPACES:
            raise InvalidParamsError(
                "settings.workspace is 'worktree' or 'sandbox'", data={"found": repr(settings["workspace"])}
            )
        out["workspace"] = settings["workspace"]
    if "cap" in settings:
        cap = settings["cap"]
        if not isinstance(cap, str) or not _CAP.match(cap):
            raise InvalidParamsError("settings.cap is dollars per run, like '0.60'", data={"found": repr(cap)})
        out["cap"] = cap
    if "preset" in settings:
        from ..policy.tiers import load

        names = sorted(load().presets)
        if settings["preset"] != "" and settings["preset"] not in names:
            raise InvalidParamsError(
                f"settings.preset is one of {', '.join(names)}, or empty", data={"found": repr(settings["preset"])}
            )
        out["preset"] = settings["preset"]
    unknown = set(settings) - {"gov", "cap", "workspace", "preset"}
    if unknown:
        raise InvalidParamsError("settings has only gov, cap, workspace and preset", data={"found": sorted(unknown)})
    return out


def clean_approvals(raw: Any) -> dict[str, bool | str]:
    """What the teammate may do: ``{id: "allow"|"ask"|"block"}`` (or the old ``true|false``), merged over what is
    stored. An id is a category or a tool name."""
    approvals = _mapping(raw, "approvals")
    if len(approvals) > MAX_APPROVALS:
        raise InvalidParamsError(f"approvals has at most {MAX_APPROVALS} entries")
    for key, value in approvals.items():
        if not _APPROVAL.match(key) or not (isinstance(value, bool) or value in TIER_WORDS):
            raise InvalidParamsError(
                "approvals maps a category or tool name to allow, ask or block", data={"found": f"{key!r}: {value!r}"}
            )
    return {str(k): v if isinstance(v, bool) else str(v) for k, v in approvals.items()}


def read(profile: Path) -> tuple[dict[str, Any] | None, str | None]:
    """``(record, problem)``: the record, or ``None`` and why it could not be read (no problem: there is none)."""
    path = record_path(profile)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as exc:
        return None, f"bot.json could not be read: {exc}"
    if not isinstance(doc, dict):
        return None, "bot.json is not an object"
    record = cast("dict[str, Any]", doc)
    if not isinstance(record.get("schema_version"), int) or record["schema_version"] > SCHEMA_VERSION:
        return None, "bot.json is from a newer boopis"
    return record, None


def _write(path: Path, record: Mapping[str, Any]) -> None:
    data = json.dumps(record, separators=(",", ":"), sort_keys=True).encode()
    if len(data) > MAX_BYTES:
        raise InvalidParamsError(f"the record would be {len(data)} bytes; the limit is {MAX_BYTES}")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".bot-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        Path(tmp).replace(path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def update(
    profile: Path,
    *,
    look: Mapping[str, str] | None = None,
    settings: Mapping[str, str] | None = None,
    approvals: Mapping[str, bool | str] | None = None,
    archived: Mapping[str, Any] | _Keep | None = KEEP,
) -> dict[str, Any]:
    """Merge a patch into the record and write it. ``archived`` is left alone unless given (``None`` clears it)."""
    path = record_path(profile)
    with _lock(path):
        record, problem = read(profile)
        if record is None:
            if problem is not None and "newer boopis" in problem:
                raise InvalidParamsError(problem)  # never overwrite what a newer boopis wrote
            record = {}
        record["schema_version"] = SCHEMA_VERSION
        if look:
            record["look"] = {**cast("dict[str, str]", record.get("look") or {}), **look}
        if settings:
            record["settings"] = {**cast("dict[str, str]", record.get("settings") or {}), **settings}
        if approvals:
            record["approvals"] = {**cast("dict[str, bool | str]", record.get("approvals") or {}), **approvals}
        if not isinstance(archived, _Keep):
            if archived is None:
                record.pop("archived", None)
            else:
                record["archived"] = dict(archived)
        _write(path, record)
        return record
