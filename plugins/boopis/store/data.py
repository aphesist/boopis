"""The store's data tables (``store/data/*.json``), loaded once (docs/STANDARDS.md rule 6)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from functools import cache
from pathlib import Path
from typing import Any, cast

_DIR = Path(__file__).with_name("data")


@cache
def table(name: str) -> Mapping[str, Any]:
    """``store/data/<name>.json``."""
    return cast("Mapping[str, Any]", json.loads((_DIR / f"{name}.json").read_text(encoding="utf-8")))


def limit(key: str) -> int:
    """One number of ``limits.json``."""
    return int(table("limits")[key])
