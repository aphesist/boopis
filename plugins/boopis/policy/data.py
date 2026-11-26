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
    roles: Mapping[str, frozenset[str]]  # the boopis tools each role of a governed session may use
    governed_only_tools: frozenset[str]  # boopis tools that mean nothing outside governed mode
    read_only_tools: frozenset[str]
    network_tools: frozenset[str]  # tools that send data to, or fetch from, the network (a URL, a query, a page)
    workspace_confined_tools: frozenset[str]  # read-only tools that, in governed mode, may only reach the workspace
    kernel_denied_tools: frozenset[str]
    shell_tools: frozenset[str]
    write_tools: frozenset[str]
    path_arguments: Mapping[str, tuple[str, ...]]
    path_object_lists: Mapping[str, tuple[str, ...]]
    aliases: Mapping[str, tuple[str, ...]]
    protected_defaults: tuple[str, ...]
    denied_read_defaults: tuple[str, ...]  # paths no tool may read (``denied_read_paths``): hard deny, never an ask
    governance_write_defaults: tuple[str, ...]  # files a bot's session may not change (B47 H2, ``policy/protections``)
    denied_read_keys: frozenset[str]  # argument names whose values are paths, folders or globs
    denied_read_text_keys: frozenset[str]  # argument names that hold prose, contents or a search pattern: never a path
    denied_read_script_keys: frozenset[str]  # argument names that hold a command line or code, read word by word
    command_wrappers: frozenset[str]
    safe_env: frozenset[str]
    read_only_commands: Mapping[str, Mapping[str, Any]]
    mod_calls: Mapping[str, Mapping[str, Any]]  # the `$` calls of mods: capability, default, subject
    mod_refused: frozenset[str]  # `$` namespaces boopis does not provide yet


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
        roles={role: frozenset(tools) for role, tools in raw["roles"].items()},
        governed_only_tools=frozenset(raw["governed_only_tools"]),
        read_only_tools=frozenset(raw["read_only_tools"]),
        network_tools=frozenset(raw["network_tools"]),
        workspace_confined_tools=frozenset(raw["workspace_confined_tools"]),
        kernel_denied_tools=frozenset(raw["kernel_denied_tools"]),
        shell_tools=frozenset(raw["shell_tools"]),
        write_tools=frozenset(raw["write_tools"]),
        path_arguments=_tuples(raw["path_arguments"]),
        path_object_lists=_tuples(raw["path_object_lists"]),
        aliases=_tuples(raw["aliases"]),
        protected_defaults=protected_patterns() + tuple(raw["protected_extra"]),
        denied_read_defaults=tuple(raw["denied_read_paths"]),
        governance_write_defaults=tuple(raw["governance_write_paths"]),
        denied_read_keys=frozenset(raw["denied_read_path_keys"]),
        denied_read_text_keys=frozenset(raw["denied_read_text_keys"]),
        denied_read_script_keys=frozenset(raw["denied_read_script_keys"]),
        command_wrappers=frozenset(raw["command_wrappers"]),
        safe_env=frozenset(raw["safe_env_assignments"]),
        read_only_commands=cast(Mapping[str, Mapping[str, Any]], raw["read_only_commands"]),
        mod_calls=cast(Mapping[str, Mapping[str, Any]], raw["mod_capabilities"]["calls"]),
        mod_refused=frozenset(raw["mod_capabilities"]["refused_namespaces"]),
    )
