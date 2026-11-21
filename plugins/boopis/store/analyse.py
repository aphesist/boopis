"""Reading a staged tree as a skill package, a plugin or a mod (docs/STORE.md 5.5 step 3). Reads and analyses; runs nothing
and writes nothing. ``discover`` returns a ``Found``; ``plan.assemble`` turns it into the ``PluginPlan``.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..compat.model.items import Plugin, Skill, Source
from ..compat.readers.plugin import read_plugin
from ..compat.readers.prompts import read_skill
from ..mods.discovery import has_modules
from .errors import StoreError

if TYPE_CHECKING:
    from ..session import Runtime

KINDS = ("skill", "plugin", "mod", "engine-plugin")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SKILL_DIR_MARKER = "SKILL.md"
_SKILL_LIMIT = 500


def slugify(text: str, fallback: str = "item") -> str:
    """``text`` as a plugin slug: lowercase letters and digits joined by single hyphens, at most 60 characters."""
    slug = _NON_ALNUM.sub("-", text.lower()).strip("-")[:60].strip("-")
    return slug or fallback


def item_name(item_id: str) -> str:
    """The name part of ``source:name`` (``owner/repo/path`` for GitHub): its last path segment."""
    name = item_id.split(":", 1)[-1].rstrip("/")
    return name.rsplit("/", 1)[-1] or name


@dataclass(frozen=True, slots=True)
class SkillFound:
    name: str  # as the package wrote it
    skill_name: str  # normalised: the directory name of the generated plugin
    description: str
    dir: Path
    frontmatter: Mapping[str, Any]
    body: str
    shell_injection: bool
    scripts: tuple[str, ...]
    problem: str = ""


@dataclass(slots=True)
class Found:
    """What the staged tree adds, as the reader found it. Not the plan: ``build_plan`` turns it into one."""

    kind: str
    slug: str
    name: str
    version: str
    description: str
    root: Path
    skills: list[SkillFound] = field(default_factory=list)
    plugin: Plugin | None = None
    manifest: Mapping[str, Any] = field(default_factory=dict)
    modules: list[dict[str, Any]] = field(default_factory=list)
    events: list[str] = field(default_factory=list)
    namespaces: list[str] = field(default_factory=list)
    dynamic: bool = False
    ignored: list[str] = field(default_factory=list)  # what a skill-only package leaves out, and says so


def _skill_name(raw: str) -> str:
    name = slugify(raw, "skill")
    return name[:64].strip("-") or "skill"


def _skill_dirs(root: Path) -> list[Path]:
    """Every folder with a ``SKILL.md`` that is not inside another skill, shallowest first. A ``SKILL.md`` at the root is
    one skill (``.`` is its folder)."""
    found: list[Path] = []
    for current, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in (".git", "node_modules"))
        here = Path(current)
        if _SKILL_DIR_MARKER in names:
            found.append(here)
            dirs[:] = []
        if len(found) >= _SKILL_LIMIT:
            break
    return found


def _skill_found(skill: Skill, root: Path, taken: set[str]) -> SkillFound:
    base = Path(skill.dir)
    frontmatter = skill.raw.get("frontmatter")
    meta: Mapping[str, Any] = frontmatter if isinstance(frontmatter, dict) else {}
    name = _skill_name(skill.name or base.name)
    problem = ""
    if not skill.description.strip():
        problem = "it has no description"
    elif name in taken:
        problem = f"another skill is already named {name}"
    if not problem:
        taken.add(name)
    scripts = sorted(
        p.relative_to(root).as_posix() for sub in ("scripts",) for p in (base / sub).rglob("*") if p.is_file()
    )
    return SkillFound(
        name=skill.name,
        skill_name=name,
        description=skill.description.strip(),
        dir=base,
        frontmatter=meta,
        body=skill.body,
        shell_injection=skill.shell_injection,
        scripts=tuple(scripts),
        problem=problem,
    )


def _skills_of_dirs(root: Path) -> list[SkillFound]:
    taken: set[str] = set()
    out: list[SkillFound] = []
    for base in _skill_dirs(root):
        skill, _diags = read_skill(base / _SKILL_DIR_MARKER, Source("store", "plugin", str(base / _SKILL_DIR_MARKER)))
        if skill is not None:
            out.append(_skill_found(skill, root, taken))
    return out


def discover(kind: str, root: Path, item_id: str, rt: Runtime | None) -> Found:
    """Read the staged tree as a ``kind``. A tree that is not that kind is ``hx.store.invalid_manifest``."""
    base = item_name(item_id)
    if kind == "skill":
        skills = _skills_of_dirs(root)
        if not skills:
            raise StoreError("hx.store.invalid_manifest", "no SKILL.md was found in the staged files")
        if not any(not s.problem for s in skills):
            raise StoreError(
                "hx.store.invalid_manifest",
                "none of the skills is valid: " + "; ".join(f"{s.skill_name} {s.problem}" for s in skills),
            )
        slug = slugify(base)
        return Found(
            kind,
            slug,
            base,
            "",
            "",
            root,
            skills=skills,
            ignored=_what_a_skill_package_leaves_out(root),
        )
    plugin, diags = read_plugin(root, Source("store", "plugin", str(root)))
    if plugin is None:
        why = "; ".join(d.message for d in diags) or "the staged files are not a plugin"
        raise StoreError("hx.store.invalid_manifest", why)
    mod = has_modules(root)
    if kind == "plugin" and mod:
        raise StoreError(
            "hx.store.invalid_manifest", "this plugin registers modules, so it is a mod; install it as a mod"
        )
    if kind == "mod" and not mod:
        raise StoreError("hx.store.invalid_manifest", "hooks/hooks.json has no `modules`, so this is not a mod")
    found = Found(
        kind,
        slugify(plugin.name),
        plugin.name,
        plugin.version,
        plugin.description,
        root,
        plugin=plugin,
        manifest=plugin.raw,
        skills=_skills_of_plugin(plugin, root),
    )
    if mod:
        _analyse_mod(rt, found)
    return found


def _skills_of_plugin(plugin: Plugin, root: Path) -> list[SkillFound]:
    taken: set[str] = set()
    return [_skill_found(s, root, taken) for s in plugin.skills]


def _what_a_skill_package_leaves_out(root: Path) -> list[str]:
    """A repository of skills may also hold plugin parts. A skill package installs only the skills; the rest stays inert."""
    plugin, _d = read_plugin(root, Source("store", "plugin", str(root)))
    if plugin is None:
        return []
    parts = [
        f"{n} {label}"
        for n, label in (
            (len(plugin.hooks), "hooks"),
            (len(plugin.mcp_servers), "servers"),
            (len(plugin.agents), "agents"),
            (len(plugin.commands), "commands"),
        )
        if n
    ]
    return parts


def _analyse_mod(rt: Runtime | None, found: Found) -> None:
    client = rt.hx_client() if rt is not None else None
    if client is None:
        raise StoreError(
            "hx.store.kind_unsupported", "the hx program is needed to read a mod's code, and was not found"
        )
    report = client.request("mods.analyze", {"dir": str(found.root)}, 60.0)
    found.modules = [dict(m) for m in report["modules"]]
    found.events = [str(e) for e in report["events"]]
    found.namespaces = [str(n) for n in report["namespaces"]]
    found.dynamic = bool(report["dynamic"])
