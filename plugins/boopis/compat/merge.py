"""Precedence and merge (docs/COMPAT.md section 10).

General rule: managed > CLI > project-local > project > user > plugin. Lists merge, scalars
override, deny > ask > allow whatever the source. Everything here is a pure function of its inputs,
sorted by a total order first, so the result does not depend on the order files were read in.

| Subject            | Rule                                                                       |
|--------------------|----------------------------------------------------------------------------|
| settings scalars   | the highest scope that sets it; a few security keys take the stricter value |
| settings lists     | union, in precedence order                                                 |
| ``env``            | per key, the highest scope wins                                            |
| permissions        | union; deny beats ask beats allow; project and local ``allow`` wait for trust |
| hooks              | additive across every source                                               |
| memory             | concatenated, never overridden; duplicates by digest are dropped            |
| named items        | by tier: managed > cli > local > project > user > plugin; same tier refuses |
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeVar

from ..util.globs import glob_match
from .data import table
from .model.items import SCOPE_RANK, Hook, Item, MemoryDoc, PermissionRule, Settings, Source
from .model.jsonval import dedupe

T = TypeVar("T", bound=Item)

#: Scopes whose files live in the repository: what a committed file may not grant itself.
REPO_SCOPES = frozenset({"project", "local", "ancestor", "nested"})
#: Scopes allowed to approve project MCP servers (a committed settings.json may not).
MCP_APPROVAL_SCOPES = frozenset({"managed", "cli", "user", "local"})


def precedence_key(source: Source, order: int = 0) -> tuple[int, int, str]:
    """Total order of sources: scope rank, then a caller-given order, then the path as a tiebreak."""
    return (SCOPE_RANK[source.scope], order, source.path)


def by_precedence(items: Iterable[T]) -> list[T]:
    """``items`` strongest first. Total, so any input order gives the same list."""
    return sorted(
        items, key=lambda i: (precedence_key(i.source, i.precedence[0] if i.precedence else 0), i.source.plugin or "")
    )


# ---------------------------------------------------------------- permissions


@dataclass(frozen=True, slots=True)
class PermissionSet:
    """Rules from every source. ``allow`` holds only trusted ones; the rest wait in ``pending_allow``."""

    deny: tuple[PermissionRule, ...] = ()
    ask: tuple[PermissionRule, ...] = ()
    allow: tuple[PermissionRule, ...] = ()
    pending_allow: tuple[PermissionRule, ...] = ()

    def texts(self, effect: str) -> tuple[str, ...]:
        rules = {"deny": self.deny, "ask": self.ask, "allow": self.allow}[effect]
        return dedupe([r.text for r in rules])


def merge_permissions(
    files: Sequence[Settings], is_trusted: Callable[[PermissionRule], bool] = lambda _r: True
) -> PermissionSet:
    """The union of every file's rules. A ``deny`` or ``ask`` applies at once. An ``allow`` from a repository
    scope waits for trust, because an allow widens (docs/COMPAT.md section 11: fail closed)."""
    buckets: dict[str, list[PermissionRule]] = {"deny": [], "ask": [], "allow": []}
    pending: list[PermissionRule] = []
    for settings in by_precedence(files):
        for rule in settings.permissions:
            if rule.effect == "allow" and rule.source.scope in REPO_SCOPES and not is_trusted(rule):
                pending.append(rule)
            else:
                buckets[rule.effect].append(rule)
    return PermissionSet(tuple(buckets["deny"]), tuple(buckets["ask"]), tuple(buckets["allow"]), tuple(pending))


# ---------------------------------------------------------------- settings


@dataclass(frozen=True, slots=True)
class Ignored:
    """A key a file set that Claude Code (and so compat) does not honour from that scope."""

    key: str
    value: str
    source: Source
    reason: str


@dataclass(frozen=True, slots=True)
class EffectiveSettings:
    permissions: PermissionSet = PermissionSet()
    env: Mapping[str, str] = field(default_factory=dict)
    env_sources: Mapping[str, Source] = field(default_factory=dict)
    model: str = ""
    default_mode: str = ""
    hooks: tuple[Hook, ...] = ()
    enabled_plugins: Mapping[str, Any] = field(default_factory=dict)
    enable_all_project_mcp_servers: bool = False
    enabled_mcpjson_servers: tuple[str, ...] = ()
    disabled_mcpjson_servers: tuple[str, ...] = ()
    claude_md_excludes: tuple[str, ...] = ()
    disable_skill_shell_execution: bool = False
    additional_directories: tuple[str, ...] = ()
    ignored: tuple[Ignored, ...] = ()


def merge_settings(
    files: Sequence[Settings], is_trusted: Callable[[PermissionRule], bool] = lambda _r: True
) -> EffectiveSettings:
    """Fold the settings files into one view (docs/COMPAT.md section 10, ``settings`` rows)."""
    ordered = by_precedence(files)  # strongest first
    ignored_table: Mapping[str, Sequence[str]] = table("limits")["settings_ignored_in_repo_files"]
    ignored: list[Ignored] = []
    model = ""
    default_mode = ""
    for s in ordered:
        if not model and s.model:
            model = s.model
        if not default_mode and s.default_mode:
            if s.source.scope in REPO_SCOPES and s.default_mode in ignored_table["permissions.defaultMode"]:
                ignored.append(
                    Ignored("permissions.defaultMode", s.default_mode, s.source, "ignored in a repository file")
                )
            else:
                default_mode = s.default_mode
    env: dict[str, str] = {}
    env_sources: dict[str, Source] = {}
    for s in reversed(ordered):  # weakest first, so a stronger scope overwrites per key
        for key, value in s.env.items():
            env[key] = value
            env_sources[key] = s.source
    approvers = [s for s in ordered if s.source.scope in MCP_APPROVAL_SCOPES]
    enable_all = next(
        (s.enable_all_project_mcp_servers for s in approvers if s.enable_all_project_mcp_servers is not None), None
    )
    plugins: dict[str, Any] = {}
    for s in reversed(ordered):
        plugins.update(s.enabled_plugins)
    return EffectiveSettings(
        permissions=merge_permissions(files, is_trusted),
        env=dict(sorted(env.items())),
        env_sources=env_sources,
        model=model,
        default_mode=default_mode,
        hooks=tuple(h for s in ordered for h in s.hooks),
        enabled_plugins=dict(sorted(plugins.items())),
        enable_all_project_mcp_servers=bool(enable_all),
        enabled_mcpjson_servers=dedupe([n for s in approvers for n in s.enabled_mcpjson_servers]),
        disabled_mcpjson_servers=dedupe([n for s in ordered for n in s.disabled_mcpjson_servers]),
        claude_md_excludes=dedupe([g for s in ordered for g in s.claude_md_excludes]),
        # a security key: the stricter value from any scope wins
        disable_skill_shell_execution=any(s.disable_skill_shell_execution for s in ordered),
        additional_directories=dedupe([d for s in ordered for d in s.additional_directories]),
        ignored=tuple(ignored),
    )


# ---------------------------------------------------------------- memory


def memory_order(doc: MemoryDoc) -> tuple[int, tuple[int, ...], str]:
    """Concatenation order: managed, user, ancestors root to cwd, project, local (docs/COMPAT.md section 10).
    Within one scope ``precedence`` orders by depth, then by file (``CLAUDE.md`` before ``.claude/CLAUDE.md``)."""
    rank = {"managed": 0, "user": 1, "ancestor": 2, "project": 3, "nested": 3, "local": 4, "plugin": 5, "cli": 1}
    return (rank[doc.source.scope], doc.precedence, doc.source.path)


def merge_memory(docs: Sequence[MemoryDoc], excludes: Sequence[str] = ()) -> tuple[list[MemoryDoc], list[MemoryDoc]]:
    """``(kept, dropped)``. Memory is concatenated, never overridden. A file matching ``claudeMdExcludes`` is
    dropped (managed ones cannot be excluded), and so is a file whose text duplicates an earlier one."""
    kept: list[MemoryDoc] = []
    dropped: list[MemoryDoc] = []
    seen: set[str] = set()
    for doc in sorted(docs, key=memory_order):
        if doc.source.scope != "managed" and any(glob_match(g, doc.source.path) for g in excludes):
            dropped.append(doc)
            continue
        digest = hashlib.sha256(doc.body.strip().encode("utf-8")).hexdigest()
        if digest in seen:
            dropped.append(doc)
            continue
        seen.add(digest)
        kept.append(doc)
    return kept, dropped


# ---------------------------------------------------------------- named items


@dataclass(frozen=True, slots=True)
class Resolution:
    """The outcome of resolving same-named items: one winner each, the shadowed, and the refused clashes."""

    winners: tuple[Item, ...] = ()
    shadowed: tuple[tuple[Item, Item], ...] = ()  # (loser, winner)
    conflicts: tuple[tuple[Item, ...], ...] = ()  # same tier, same name: refused, never guessed


def resolve_named(items: Iterable[Item], name_of: Callable[[Item], str]) -> Resolution:
    """Resolve by name: the strongest tier wins and weaker ones are shadowed. Two items of the strongest
    tier are a conflict and neither wins. A plugin's items are namespaced by the plugin, so they never clash."""
    groups: dict[str, list[Item]] = {}
    for item in items:
        key = f"{item.source.plugin}:{name_of(item)}" if item.source.plugin else name_of(item)
        groups.setdefault(key, []).append(item)
    winners: list[Item] = []
    shadowed: list[tuple[Item, Item]] = []
    conflicts: list[tuple[Item, ...]] = []
    for key in sorted(groups):
        group = sorted(groups[key], key=lambda i: (SCOPE_RANK[i.source.scope], i.source.path))
        top = [i for i in group if SCOPE_RANK[i.source.scope] == SCOPE_RANK[group[0].source.scope]]
        if len(top) > 1:
            conflicts.append(tuple(top))
            continue
        winners.append(group[0])
        shadowed.extend((loser, group[0]) for loser in group[1:])
    return Resolution(tuple(winners), tuple(shadowed), tuple(conflicts))
