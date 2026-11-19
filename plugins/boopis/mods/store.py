"""``$.store``: a mod's JSON on disk, one file per mod under the profile home, shared by every session.

Versioned (``schema_version``), written atomically (temp file, fsync, rename), and capped at 4 MiB for the whole file,
the size Claude Code documents. Keys and values are JSON; the mod never names a path.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from ..errors import InvalidParamsError
from .limits import limit

SCHEMA_VERSION = 1
_SLUG = re.compile(r"[^A-Za-z0-9._-]")
_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def store_dir(home: Path) -> Path:
    return home / "boopis" / "mods" / "store"


def slug(plugin: str) -> str:
    return _SLUG.sub("_", plugin)[:100] or "_"


class ModStore:
    def __init__(self, home: Path, plugin: str) -> None:
        self.path = store_dir(home) / f"{slug(plugin)}.json"
        with _LOCKS_GUARD:
            self._lock = _LOCKS.setdefault(str(self.path), threading.Lock())

    def _load(self) -> dict[str, Any]:
        try:
            doc = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError):
            return {}  # an unreadable store reads as empty; the next write replaces it
        values = doc.get("values") if isinstance(doc, dict) else None
        return values if isinstance(values, dict) else {}

    def _save(self, values: dict[str, Any]) -> None:
        data = json.dumps({"schema_version": SCHEMA_VERSION, "values": values}, separators=(",", ":")).encode()
        if len(data) > limit("store_bytes"):
            raise InvalidParamsError(
                f"the store would be {len(data)} bytes; the limit is {limit('store_bytes')}",
                data={"limit": limit("store_bytes")},
            )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".store-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            Path(tmp).replace(self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    @staticmethod
    def _key(key: Any) -> str:
        if not isinstance(key, str) or not key or len(key) > limit("store_key_chars"):
            raise InvalidParamsError(f"a store key is a string of 1 to {limit('store_key_chars')} characters")
        return key

    def get(self, key: Any) -> Any:
        with self._lock:
            return self._load().get(self._key(key))

    def set(self, key: Any, value: Any) -> None:
        with self._lock:
            values = self._load()
            values[self._key(key)] = value
            self._save(values)

    def delete(self, key: Any) -> bool:
        with self._lock:
            values = self._load()
            had = values.pop(self._key(key), None) is not None
            if had:
                self._save(values)
            return had

    def keys(self) -> list[str]:
        with self._lock:
            return sorted(self._load())
