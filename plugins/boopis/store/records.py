"""What the store remembers, in the bot's home, next to compat's trust record (docs/STORE.md 5.9, 5.8).

``<home>/boopis/store/``:
- ``records.json``: one entry per installed item (kind ``skill``, ``plugin``, ``mod`` or ``engine-plugin``): its
  ``InstallReceipt``, the plugin slug, and one version kept back for rollback (docs/STORE.md 5.7);
- ``removed.json``: the kill list the host last pushed (``store.removed.set``), replaced as a whole;
- ``policy.json``: the explicit per-project switch (``store.policy.set``), keyed by the project id of the trust store.

Mode 0600, atomic, and a missing or unreadable file means nothing is recorded (fail closed on what is trusted, never an
invented record). Nothing here is read by any other layer: the host merges these receipts with its own (``store_installed``).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, cast

from ..util.log import get_logger

SCHEMA = 1
_log = get_logger("store.records")


def store_dir(home: Path) -> Path:
    return home / "boopis" / "store"


def _read(path: Path, key: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        _log.warning("store file unreadable; treated as empty: %s", path)
        return {}
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        _log.warning("store file has an unknown schema; treated as empty: %s", path)
        return {}
    value = cast("dict[str, Any]", data).get(key)
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _write(path: Path, key: str, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".store-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump({"schema": SCHEMA, key: value}, f, indent=2, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


# ---------------------------------------------------------------- installed items


def load_items(home: Path) -> dict[str, dict[str, Any]]:
    return cast("dict[str, dict[str, Any]]", _read(store_dir(home) / "records.json", "items"))


def save_items(home: Path, items: dict[str, dict[str, Any]]) -> None:
    _write(store_dir(home) / "records.json", "items", items)


# ---------------------------------------------------------------- the kill list


def load_removed(home: Path) -> dict[str, dict[str, str]]:
    """``item id -> {reason, by}`` as the host last pushed it."""
    return cast("dict[str, dict[str, str]]", _read(store_dir(home) / "removed.json", "removed"))


def save_removed(home: Path, removed: dict[str, dict[str, str]]) -> None:
    _write(store_dir(home) / "removed.json", "removed", removed)


def killed_slugs(home: Path) -> frozenset[str]:
    """The plugin slugs of installed items that are on the kill list: their hooks and servers are inert."""
    gone = load_removed(home)
    return frozenset(
        str(rec.get("slug")) for item_id, rec in load_items(home).items() if item_id in gone and rec.get("slug")
    )


# ---------------------------------------------------------------- the project switch


def load_policy(home: Path) -> dict[str, dict[str, Any]]:
    return cast("dict[str, dict[str, Any]]", _read(store_dir(home) / "policy.json", "projects"))


def save_policy(home: Path, projects: dict[str, dict[str, Any]]) -> None:
    _write(store_dir(home) / "policy.json", "projects", projects)
