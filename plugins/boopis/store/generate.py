"""The portable Agent Plugin v1 the engine loads for an installed plugin (docs/COMPAT.md section 9 step 5).

The package at ``<home>/plugins/<slug>/`` holds only ``plugin.json`` and ``skills/<name>/``: the engine then gives each skill
its native namespace ``<slug>:<name>`` and the plugin its enabled flag. Hooks, commands, agents and servers stay in the
install's ``source/`` and are read by compat, active only while the engine reports the plugin enabled and the user approved
its content. Frontmatter is normalised to the v1 rules (``name`` equals the directory, ``description`` 1 to 1024, strings only);
a skill that cannot be made valid is skipped and reported, never silently dropped. Standard library only: the frontmatter is
written as JSON strings, which are YAML double-quoted scalars.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .analyse import Found, SkillFound

SCHEMA_V1 = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
_TOP_STRINGS = ("version", "description", "homepage", "repository", "license")
_AUTHOR = ("name", "email", "url")
_SKILL_PARTS = ("scripts", "references", "assets")
_DESCRIPTION_MAX = 1024
_COMPAT_MAX = 500


@dataclass(frozen=True, slots=True)
class Generated:
    path: Path
    skills: tuple[str, ...]
    skipped: tuple[tuple[str, str], ...]


def _scalar(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _str_map(value: Any) -> dict[str, str] | None:
    if isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
        return dict(value)
    return None


def skill_text(skill: SkillFound) -> str:
    """``SKILL.md`` with its frontmatter normalised to Agent Skills v1: the fields the format names, strings only."""
    meta = skill.frontmatter
    lines = [f"name: {_scalar(skill.skill_name)}", f"description: {_scalar(skill.description[:_DESCRIPTION_MAX])}"]
    for key in ("license", "compatibility"):
        value = meta.get(key)
        if isinstance(value, str) and value and (key != "compatibility" or len(value) <= _COMPAT_MAX):
            lines.append(f"{key}: {_scalar(value)}")
    tools = meta.get("allowed-tools")
    joined = " ".join(str(t) for t in tools) if isinstance(tools, list) else tools
    if isinstance(joined, str) and joined.strip():
        lines.append(f"allowed-tools: {_scalar(joined.strip())}")
    extra = _str_map(meta.get("metadata"))
    if extra:
        lines.append("metadata:")
        lines += [f"  {_scalar(k)}: {_scalar(v)}" for k, v in sorted(extra.items())]
    return "---\n" + "\n".join(lines) + "\n---\n" + skill.body


def manifest(found: Found) -> dict[str, Any]:
    raw: Mapping[str, Any] = found.manifest
    out: dict[str, Any] = {"$schema": SCHEMA_V1, "name": found.slug}
    for key in _TOP_STRINGS:
        value = raw.get(key)
        if isinstance(value, str) and value:
            out[key] = value
    if "description" not in out and found.description:
        out["description"] = found.description
    author = raw.get("author")
    if isinstance(author, dict) and author and all(k in _AUTHOR and isinstance(v, str) for k, v in author.items()):
        out["author"] = dict(author)
    keywords = raw.get("keywords")
    if isinstance(keywords, list) and all(isinstance(k, str) for k in keywords):
        out["keywords"] = list(keywords)
    return out


def _copy_skill(skill: SkillFound, root: Path, dest: Path) -> None:
    dest.mkdir(parents=True)
    ignore = shutil.ignore_patterns(".git")
    if skill.dir == root:  # a SKILL.md at the root: take its own parts, not the whole plugin
        for part in _SKILL_PARTS:
            if (root / part).is_dir():
                shutil.copytree(root / part, dest / part, ignore=ignore, symlinks=False)
    else:
        shutil.copytree(skill.dir, dest, ignore=ignore, symlinks=False, dirs_exist_ok=True)
    (dest / "SKILL.md").write_text(skill_text(skill), encoding="utf-8")


def generate(found: Found, source: Path, out: Path) -> Generated:
    """Write the package for ``found`` (read from the *staged* tree) into ``out``, copying skill files from ``source``
    (the installed copy, whose bytes are the same). ``out`` must not exist."""
    made: list[str] = []
    skipped: list[tuple[str, str]] = []
    out.mkdir(parents=True)
    for skill in found.skills:
        if skill.problem:
            skipped.append((skill.name or skill.skill_name, skill.problem))
            continue
        relocated = SkillFound(
            skill.name,
            skill.skill_name,
            skill.description,
            source / skill.dir.relative_to(found.root),
            skill.frontmatter,
            skill.body,
            skill.shell_injection,
            skill.scripts,
        )
        _copy_skill(relocated, source, out / "skills" / skill.skill_name)
        made.append(skill.skill_name)
    (out / "plugin.json").write_text(json.dumps(manifest(found), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return Generated(out, tuple(made), tuple(skipped))
