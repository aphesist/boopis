"""``<root>/boopis/rules.json``, as the plugin reads it (``docs/specs/rules-engine.md`` section 11).

The host is the only writer (``crates/boopis-rules``; a bot's session cannot write it, B47 H2). Every plugin copy reads
it again when it changes (its modification time and size are the cache key, like ``bot.json``).

- **No file yet**: the owner's shipped defaults apply, all enabled (revision 0). The host creates the file on its next
  start; until then the defaults must not wait for it.
- **A file that cannot be read, is not a rules file, or was written by a newer boopis**: a ``problem``. The gate then
  holds every call a rule could concern (fail closed): Settings says "Rules can't be read. Every action asks."
- Unknown keys are ignored here and kept by the host.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from .data import Tables, load

SCHEMA_VERSION = 1
FILE = ("boopis", "rules.json")


@dataclass(frozen=True, slots=True)
class Rule:
    """One rule or exception of the list."""

    id: str
    type: str  # "ask" or "exception"
    text: str
    enabled: bool = True
    source: str = "owner"  # default, owner, card, chat
    edited: bool = False  # a default whose text the owner changed: its patterns no longer apply
    bots: tuple[str, ...] | None = None  # None: every bot
    kinds: tuple[str, ...] = ()
    state: str = "active"  # exceptions: active or draft (a draft is never applied)
    excepts: tuple[str, ...] = ()  # exceptions: the rule ids (and ``row.<category>``) they except
    match: tuple[str, ...] = ()  # exceptions: policy rule texts that decide them without the reviewer
    match_cwd: str = ""

    def for_bot(self, bot: str) -> bool:
        return self.bots is None or bot in self.bots

    @property
    def is_default(self) -> bool:
        return self.source == "default" and self.id.startswith("default.")


@dataclass(frozen=True, slots=True)
class Reviewer:
    mode: str = "auto"  # auto or pinned
    provider: str = ""
    model: str = ""

    @property
    def configured(self) -> bool:
        return bool(self.provider and self.model)


@dataclass(frozen=True, slots=True)
class RulesDoc:
    revision: int = 0
    rules: tuple[Rule, ...] = ()
    reviewer: Reviewer = field(default_factory=Reviewer)
    problem: str = ""  # the file could not be trusted: the gate holds every call a rule could concern

    def asks(self, bot: str) -> tuple[Rule, ...]:
        return tuple(r for r in self.rules if r.type == "ask" and r.enabled and r.for_bot(bot))

    def exceptions(self, bot: str) -> tuple[Rule, ...]:
        return tuple(
            r for r in self.rules if r.type == "exception" and r.enabled and r.state == "active" and r.for_bot(bot)
        )

    def by_id(self, rule_id: str) -> Rule | None:
        return next((r for r in self.rules if r.id == rule_id), None)


def shipped(tables: Tables | None = None) -> RulesDoc:
    """The owner's defaults as the list a root without ``rules.json`` has."""
    t = tables or load()
    return RulesDoc(
        revision=0,
        rules=tuple(Rule(d.id, "ask", d.text, source="default", kinds=d.kinds) for d in t.defaults),
    )


def _strings(value: Any) -> tuple[str, ...]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        raise ValueError("not a list of strings")
    out = tuple(str(v) for v in cast("Sequence[Any]", value))
    if any(not isinstance(v, str) for v in cast("Sequence[Any]", value)):
        raise ValueError("not a list of strings")
    return out


def parse(doc: Any, tables: Tables | None = None) -> RulesDoc:
    """The document as the gate reads it. A document that is not a rules file is a ``problem``, never a guess."""
    t = tables or load()
    try:
        if not isinstance(doc, Mapping):
            raise ValueError("not an object")
        d = cast("Mapping[str, Any]", doc)
        version = d.get("schema_version")
        if not isinstance(version, int) or version < 1:
            raise ValueError("no schema_version")
        if version > SCHEMA_VERSION:
            return RulesDoc(problem=f"rules.json was written by a newer boopis (schema {version})")
        rules: list[Rule] = []
        for raw in cast("Sequence[Any]", d.get("rules") or ()):
            if not isinstance(raw, Mapping):
                raise ValueError("a rule that is not an object")
            r = cast("Mapping[str, Any]", raw)
            kind = r.get("type")
            text = r.get("text")
            rid = r.get("id")
            if kind not in ("ask", "exception") or not isinstance(text, str) or not isinstance(rid, str) or not rid:
                raise ValueError(f"a rule without an id, a type or a text: {rid!r}")
            bots = r.get("bots")
            default = t.default(rid)
            kinds = r.get("kinds")
            rules.append(
                Rule(
                    id=rid,
                    type=kind,
                    text=text,
                    enabled=r.get("enabled", True) is not False,
                    source=str(r.get("source") or "owner"),
                    edited=bool(r.get("edited")) or (default is not None and text != default.text),
                    bots=None if bots is None else _strings(bots),
                    kinds=_strings(kinds) if kinds is not None else (default.kinds if default else t.all_kinds),
                    state=str(r.get("state") or "active"),
                    excepts=_strings(r.get("excepts") or ()),
                    match=_strings(r.get("match") or ()),
                    match_cwd=str(r.get("match_cwd") or ""),
                )
            )
        raw_reviewer = d.get("reviewer")
        reviewer = Reviewer()
        if isinstance(raw_reviewer, Mapping):
            rv = cast("Mapping[str, Any]", raw_reviewer)
            reviewer = Reviewer(
                str(rv.get("mode") or "auto"), str(rv.get("provider") or ""), str(rv.get("model") or "")
            )
        revision = d.get("revision", 0)
        return RulesDoc(revision=revision if isinstance(revision, int) else 0, rules=tuple(rules), reviewer=reviewer)
    except (ValueError, TypeError) as exc:
        return RulesDoc(problem=f"rules.json is not a rules file: {exc}")


_CACHE: dict[str, tuple[tuple[int, int] | None, RulesDoc]] = {}
_LOCK = threading.Lock()


def path_of(root: Path) -> Path:
    return root.joinpath(*FILE)


def read(root: Path) -> RulesDoc:
    """The rules of this engine root. Never raises."""
    path = path_of(root)
    try:
        info = path.stat()
        stamp: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
    except FileNotFoundError:
        stamp = None
    except OSError as exc:
        return RulesDoc(problem=f"rules.json cannot be read: {exc.strerror or exc}")
    key = str(path)
    with _LOCK:
        hit = _CACHE.get(key)
        if hit is not None and hit[0] == stamp:
            return hit[1]
    if stamp is None:
        doc = shipped()
    else:
        try:
            doc = parse(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            doc = RulesDoc(problem=f"rules.json cannot be read: {exc}")
    with _LOCK:
        _CACHE[key] = (stamp, doc)
    return doc
