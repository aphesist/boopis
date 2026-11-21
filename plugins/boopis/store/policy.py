"""The per-project switch "no engine plugins and no plugin hooks" (docs/STORE.md 5.8).

Per project, stored by the plugin next to the trust record (``records.policy.json``, keyed by the trust store's project
id). Its default is *on* for a governed project and *off* for an ungoverned one; an explicit choice wins. When it is on:

- a Claude plugin's hooks are inert for the project (``compat.activation`` asks ``hooks_blocked``);
- an engine plugin cannot be loaded per project (the engine loads plugins per process), so the switch is enforced at the
  one place the plugin controls, the first prompt of a governed session: ``session_refusal`` names the enabled engine
  plugins and the two ways out, and the turn is blocked with ``hx.store.governed_refused``. Fail closed.

"Governed" for a project is the bot's default mode (the plugin's ``mode`` setting); for a session it is the session's own.
"""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..config.trust import project_id
from . import records

if TYPE_CHECKING:
    from ..session import Runtime

#: ``(plugin name) -> enabled?`` as the engine's config says, None when it cannot be read. Tests replace it.
EngineEnabled = Callable[[str], bool | None]
_OWN = frozenset(("boopis",))
_PLUGIN_DIR_MARKERS = ("plugin.yaml", "plugin.yml", "__init__.py")


def engine_enabled(name: str) -> bool | None:
    """Whether the engine lists ``name`` in ``plugins.enabled`` (its public config reader), None when unknown."""
    try:
        from hermes_cli.config import load_config_readonly  # pyright: ignore[reportMissingImports]

        plugins = load_config_readonly().get("plugins", {})
        names = plugins.get("enabled", []) if isinstance(plugins, dict) else []
        return isinstance(names, list) and name in names
    except Exception:  # noqa: BLE001 - outside the engine, or an unreadable config
        return None


def mode_is_governed() -> bool | None:
    """Whether the bot's default mode is governed; None when no runtime is bound (a plain import, a test)."""
    try:
        from ..hooks import runtime

        return runtime().load_settings().value.mode == "governed"
    except Exception:  # noqa: BLE001 - no bound plugin context
        return None


def effective(home: Path, cwd: str, *, governed: bool | None) -> dict[str, Any]:
    """The ``ProjectPolicy`` of ``cwd``: the explicit choice when there is one, else on exactly when governed."""
    entry = records.load_policy(home).get(project_id(cwd))
    explicit = entry.get("block") if isinstance(entry, dict) and isinstance(entry.get("block"), bool) else None
    is_governed = bool(governed)
    return {
        "project": os.path.realpath(cwd),
        "governed": is_governed,
        "explicit": explicit,
        "effective": explicit if explicit is not None else is_governed,
    }


def get(rt: Runtime, cwd: str) -> dict[str, Any]:
    return effective(rt.home, cwd, governed=rt.load_settings().value.mode == "governed")


def set_block(rt: Runtime, cwd: str, block: bool) -> dict[str, Any]:
    projects = records.load_policy(rt.home)
    projects[project_id(cwd)] = {
        "block": block,
        "cwd": os.path.realpath(cwd),
        "decided_at": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    }
    records.save_policy(rt.home, projects)
    return get(rt, cwd)


def hooks_blocked(home: Path, cwd: str) -> bool:
    """Whether the project's switch makes Claude plugin hooks inert. Explicit on always blocks; with no explicit choice it
    blocks exactly when the bot's default is governed, and not at all where no runtime says (a plain import)."""
    entry = effective(home, cwd, governed=mode_is_governed())
    return bool(entry["effective"])


# ---------------------------------------------------------------- engine plugins that are on


def enabled_engine_plugins(home: Path, enabled: EngineEnabled | None = None) -> list[str]:
    """The engine plugins that run in this bot's sessions: the store's own records that are enabled and not on the kill
    list, and any Python plugin folder in the bot's ``plugins/`` the engine's config enables (installed some other way).
    A name the engine says is off is left out; a name it cannot answer for counts as on (fail closed)."""
    check = enabled or engine_enabled
    gone = records.load_removed(home)
    names: dict[str, None] = {}
    for item_id, rec in records.load_items(home).items():
        if rec.get("kind") != "engine-plugin" or item_id in gone:
            continue
        receipt = rec.get("receipt") or {}
        name = str(rec.get("slug") or "")
        if name and receipt.get("enabled") and check(name) is not False:
            names[name] = None
    plugins = home / "plugins"
    if plugins.is_dir():
        for folder in sorted(p for p in plugins.iterdir() if p.is_dir()):
            if folder.name in _OWN or not any((folder / m).is_file() for m in _PLUGIN_DIR_MARKERS):
                continue
            if check(folder.name) is True:
                names[folder.name] = None
    return list(names)


def session_refusal(rt: Runtime, cwd: str, *, governed: bool, enabled: EngineEnabled | None = None) -> str | None:
    """The text that blocks a governed session's turn, or None. Governed, the project's switch on, and an enabled engine
    plugin: ``hx.store.governed_refused`` (docs/STORE.md 5.8)."""
    if not governed or not cwd:
        return None
    if not effective(rt.home, cwd, governed=True)["effective"]:
        return None
    plugins = enabled_engine_plugins(rt.home, enabled)
    if not plugins:
        return None
    return (
        f"hx.store.governed_refused: this project is governed and has engine plugins and plugin hooks turned off, "
        f"but this bot has {_names(plugins)} on, and an engine plugin runs in every session of the bot outside the "
        "sandbox where permission rules do not see it. Switch the plugin off for this bot, or turn the project's "
        "switch off, then send the message again."
    )


def _names(names: list[str]) -> str:
    safe = [re.sub(r"[^A-Za-z0-9._-]", "?", n) for n in names]
    return "the engine plugin " + safe[0] if len(safe) == 1 else "the engine plugins " + ", ".join(safe)
