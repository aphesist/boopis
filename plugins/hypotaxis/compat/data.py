"""The data tables of ``compat/data/*.json``, loaded once (docs/STANDARDS.md rule 6)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from functools import cache
from pathlib import Path
from typing import Any, cast

_DIR = Path(__file__).with_name("data")


@cache
def table(name: str) -> Mapping[str, Any]:
    """``compat/data/<name>.json``."""
    return cast("Mapping[str, Any]", json.loads((_DIR / f"{name}.json").read_text(encoding="utf-8")))


def limit(key: str) -> Any:
    """One value of ``limits.json``."""
    return table("limits")[key]


def hook_timeout_s(event: str) -> float:
    """The default timeout of a hook handler on ``event`` (docs/research/formats.md 1.3)."""
    timeouts = cast("Mapping[str, float]", limit("hook_timeout_s"))
    return float(timeouts.get(event, timeouts["default"]))
