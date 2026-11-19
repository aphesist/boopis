"""The numbers a mod is held to, read from ``policy/defaults.json`` (``mod_capabilities.limits``): data, not constants
(docs/STANDARDS.md rule 6). The limits that Claude Code documents (30 s, 4 MiB, 5 redirects, the 4 MiB store) are
the defaults."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

_FILE = Path(__file__).resolve().parent.parent / "policy" / "defaults.json"


@lru_cache(maxsize=1)
def _raw() -> dict[str, Any]:
    return cast("dict[str, Any]", json.loads(_FILE.read_text(encoding="utf-8"))["mod_capabilities"])


def limit(name: str) -> int:
    return int(_raw()["limits"][name])


def backoff() -> tuple[float, ...]:
    """The waits before each restart of a failed worker, in seconds. After the last, the mod is given up on."""
    return tuple(float(x) for x in _raw()["restart_backoff_s"])


def env_allowlist() -> frozenset[str]:
    return frozenset(_raw()["env_allowlist"])


def config_keys() -> frozenset[str]:
    return frozenset(_raw()["config_keys"])
