"""Which installed plugins are mods for a session: enabled in Hermes, trusted, and with ``modules`` in hooks/hooks.json.

A mod is a Claude Code plugin (docs/COMPAT.md section 9) installed under
``<home>/hypotaxis/compat/plugins/<slug>/source``.
It runs only when Hermes lists its generated plugin as enabled and the user approved its content hash, the same two
conditions that gate its hooks; a mod whose files changed since the approval does not load until approved again.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..compat.snapshot import Snapshot


def has_modules(root: Path) -> bool:
    try:
        doc: Any = json.loads((root / "hooks" / "hooks.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    modules = doc.get("modules") if isinstance(doc, dict) else None
    return isinstance(modules, list) and bool(modules)


def discover(snap: Snapshot) -> list[tuple[Path, str]]:
    """``[(plugin directory, tier)]`` for the session's mods, in the scan's (sorted) order."""
    from ..compat.trust import plugin_item

    found: list[tuple[Path, str]] = []
    for plugin in snap.scan.plugins:
        root = Path(plugin.root)
        if plugin.slug not in snap.scan.plugins_enabled or not has_modules(root):
            continue
        if snap.trust.is_trusted(plugin_item(plugin, root)):
            found.append((root, "user"))
    return found
