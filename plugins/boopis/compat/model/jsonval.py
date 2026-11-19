"""Typed access to untyped JSON and YAML values.

Foreign files are untrusted and arbitrary, so every reader goes through these instead of casting.
A value of the wrong type is returned as the default, never raised: the reader decides whether that
deserves a diagnostic.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast

JsonObject = Mapping[str, Any]


def as_dict(value: Any) -> dict[str, Any]:
    """``value`` as a ``dict[str, Any]`` when it is a mapping with string keys, else empty."""
    if isinstance(value, Mapping):
        return {k: v for k, v in cast("Mapping[Any, Any]", value).items() if isinstance(k, str)}
    return {}


def as_list(value: Any) -> list[Any]:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return list(cast("Sequence[Any]", value))
    return []


def as_str(value: Any, default: str = "") -> str:
    return value if isinstance(value, str) else default


def as_bool(value: Any, default: bool = False) -> bool:
    """Claude Code accepts yes/no/on/off/1/0 in frontmatter (docs/research/formats.md 1.4)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        low = value.strip().lower()
        if low in ("true", "yes", "on", "1"):
            return True
        if low in ("false", "no", "off", "0"):
            return False
    return default


def as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    return float(value) if isinstance(value, (int, float)) else None


def split_top_level(text: str) -> tuple[str, ...]:
    """``text`` split on commas and whitespace outside parentheses, so ``Bash(git add:*), Read`` is two items."""
    parts: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(depth - 1, 0)
        if depth == 0 and (char == "," or char.isspace()):
            if current:
                parts.append("".join(current))
                current = []
            continue
        current.append(char)
    if current:
        parts.append("".join(current))
    return tuple(parts)


def str_list(value: Any) -> tuple[str, ...]:
    """A list of strings, or one string split on commas and whitespace outside parentheses (Claude's
    ``allowed-tools`` forms, whose specifiers can contain spaces)."""
    if isinstance(value, str):
        return split_top_level(value)
    return tuple(item for item in as_list(value) if isinstance(item, str))


def glob_list(value: Any) -> tuple[str, ...]:
    """Path globs: a list, or one string split on commas only (a glob may contain a space)."""
    if isinstance(value, str):
        return tuple(part.strip() for part in value.split(",") if part.strip())
    return tuple(item for item in as_list(value) if isinstance(item, str))


def dedupe(items: Sequence[str]) -> tuple[str, ...]:
    """Order-preserving union."""
    seen: dict[str, None] = {}
    for item in items:
        seen.setdefault(item)
    return tuple(seen)
