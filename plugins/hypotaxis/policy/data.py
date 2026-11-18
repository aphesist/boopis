"""The policy's data tables, loaded once from ``defaults.json`` (STANDARDS rule 6: data, not constants)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

_FILE = Path(__file__).with_name("defaults.json")
_PROTECTED = Path(__file__).resolve().parent.parent / "data" / "protected.default.json"


@dataclass(frozen=True, slots=True)
class Defaults:
    own_tools: frozenset[str]
    read_only_tools: frozenset[str]
    kernel_denied_tools: frozenset[str]
    shell_tools: frozenset[str]
    write_tools: frozenset[str]
    path_arguments: Mapping[str, tuple[str, ...]]
    path_object_lists: Mapping[str, tuple[str, ...]]
    aliases: Mapping[str, tuple[str, ...]]
    protected_defaults: tuple[str, ...]
    command_wrappers: frozenset[str]
    safe_env: frozenset[str]
    read_only_commands: Mapping[str, Mapping[str, Any]]


def _tuples(raw: Mapping[str, Any]) -> dict[str, tuple[str, ...]]:
    return {k: tuple(v) for k, v in raw.items()}


def protected_patterns() -> tuple[str, ...]:
    """The shared default protected globs (``crates/hx-txn/protected.default.json``, copied by
    ``scripts/sync-shared-data.sh``). Fails if the file is missing: a policy with no protected list
    must not start."""
    raw = cast(Mapping[str, Any], json.loads(_PROTECTED.read_text(encoding="utf-8")))
    return tuple(raw["patterns"])


@lru_cache(maxsize=1)
def load_defaults() -> Defaults:
    raw = cast(Mapping[str, Any], json.loads(_FILE.read_text(encoding="utf-8")))
    return Defaults(
        own_tools=frozenset(raw["own_tools"]),
        read_only_tools=frozenset(raw["read_only_tools"]),
        kernel_denied_tools=frozenset(raw["kernel_denied_tools"]),
        shell_tools=frozenset(raw["shell_tools"]),
        write_tools=frozenset(raw["write_tools"]),
        path_arguments=_tuples(raw["path_arguments"]),
        path_object_lists=_tuples(raw["path_object_lists"]),
        aliases=_tuples(raw["aliases"]),
        protected_defaults=protected_patterns() + tuple(raw["protected_extra"]),
        command_wrappers=frozenset(raw["command_wrappers"]),
        safe_env=frozenset(raw["safe_env_assignments"]),
        read_only_commands=cast(Mapping[str, Mapping[str, Any]], raw["read_only_commands"]),
    )
