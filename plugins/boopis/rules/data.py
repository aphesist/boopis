"""The rules engine's tables: the owner's default rules (``data/default-rules.json``, a copy of the shared file the host
writes ``rules.json`` from) and the pre-filter, the call kinds and the reviewer's numbers
(``policy/default_rules.json``). Loaded once (STANDARDS rule 6: data, not constants)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

_PLUGIN = Path(__file__).resolve().parent.parent
_DEFAULTS = _PLUGIN / "data" / "default-rules.json"
_TABLES = _PLUGIN / "policy" / "default_rules.json"


@dataclass(frozen=True, slots=True)
class DefaultRule:
    id: str
    text: str
    kinds: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Pattern:
    """The pre-filter of one unedited default rule (``policy/default_rules.json`` ``patterns``)."""

    commands: tuple[tuple[str, ...], ...] = ()
    hint_commands: tuple[tuple[str, ...], ...] = ()
    paths: tuple[str, ...] = ()
    write_paths: tuple[str, ...] = ()
    path_exceptions: tuple[str, ...] = ()
    tools: frozenset[str] = frozenset()
    mcp_words: tuple[str, ...] = ()
    checks: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class Tables:
    defaults_version: int
    all_kinds: tuple[str, ...]
    defaults: tuple[DefaultRule, ...]
    call_kinds: Mapping[str, str]  # tool -> kind
    browser_prefix: str
    exact_kinds: frozenset[str]
    inert: frozenset[str]
    patterns: Mapping[str, Pattern]
    summaries: Mapping[str, str]
    reviewer: Mapping[str, Any]
    draft: Mapping[str, Any]

    def default(self, rule_id: str) -> DefaultRule | None:
        return next((d for d in self.defaults if d.id == rule_id), None)


def _words(raw: Any) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(str(p).split()) for p in cast("list[Any]", raw or ()))


@lru_cache(maxsize=1)
def load() -> Tables:
    shared = cast("dict[str, Any]", json.loads(_DEFAULTS.read_text(encoding="utf-8")))
    raw = cast("dict[str, Any]", json.loads(_TABLES.read_text(encoding="utf-8")))
    kinds: dict[str, str] = {}
    for kind, tools in cast("dict[str, list[str]]", raw["call_kinds"]).items():
        for tool in tools:
            kinds[tool] = kind
    patterns = {
        rid: Pattern(
            commands=_words(spec.get("commands")),
            hint_commands=_words(spec.get("hint_commands")),
            paths=tuple(spec.get("paths", ())),
            write_paths=tuple(spec.get("write_paths", ())),
            path_exceptions=tuple(spec.get("path_exceptions", ())),
            tools=frozenset(spec.get("tools", ())),
            mcp_words=tuple(str(w).lower() for w in spec.get("mcp_words", ())),
            checks=tuple(spec.get("checks", ())),
        )
        for rid, spec in cast("dict[str, dict[str, Any]]", raw["patterns"]).items()
    }
    return Tables(
        defaults_version=int(shared["defaults_version"]),
        all_kinds=tuple(shared["kinds"]),
        defaults=tuple(
            DefaultRule(str(r["id"]), str(r["text"]), tuple(r["kinds"]))
            for r in cast("list[dict[str, Any]]", shared["rules"])
        ),
        call_kinds=kinds,
        browser_prefix=str(raw["browser_prefix"]),
        exact_kinds=frozenset(raw["exact_kinds"]),
        inert=frozenset(raw["inert"]),
        patterns=patterns,
        summaries=dict(raw["summaries"]),
        reviewer=dict(raw["reviewer"]),
        draft=dict(raw["draft"]),
    )
